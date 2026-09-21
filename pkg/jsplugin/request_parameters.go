package jsplugin

import (
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strconv"
)

// A plugin's models accept whatever fields its vendor defines, which no host
// table can know. Declaring them here is what lets a catalogue describe a
// request accurately instead of falling back to a generic shape for the
// modality. The declaration is display metadata: the plugin still validates
// every request itself, and nothing here reaches billing.

const (
	maxRequestParameters            = 64
	maxRequestParameterNameRunes    = 64
	maxRequestParameterRangeRunes   = 64
	maxRequestParameterEnumValues   = 32
	maxRequestParameterDefaultRunes = 64
)

var requestParameterNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.\[\]-]*$`)

var requestParameterTypes = []string{"string", "integer", "number", "boolean", "enum", "array", "object"}

// RequestParameter describes one field a model accepts, for display only.
type RequestParameter struct {
	Name        string        `json:"name"`
	Type        string        `json:"type"`
	Required    bool          `json:"required,omitempty"`
	Default     string        `json:"default,omitempty"`
	Range       string        `json:"range,omitempty"`
	Enum        []string      `json:"enum,omitempty"`
	Description LocalizedText `json:"description,omitempty"`
}

// RequestProfile replaces the plugin's default request parameters for its
// models, the same way a usage profile replaces its usage metadata.
type RequestProfile struct {
	Models     []string           `json:"models"`
	Parameters []RequestParameter `json:"parameters"`
}

// RequestParametersForModels returns the parameters of the first candidate a
// profile declares, mirroring UsageForModels so callers resolve a model the
// same way for both. An unprofiled model uses the plugin defaults.
func (m Meta) RequestParametersForModels(models ...string) []RequestParameter {
	for _, model := range models {
		folded := asciiFold(model)
		for _, profile := range m.RequestProfiles {
			for _, declared := range profile.Models {
				if asciiFold(declared) == folded {
					return profile.Parameters
				}
			}
		}
	}
	return m.RequestParameters
}

func cloneRequestParameters(parameters []RequestParameter) []RequestParameter {
	cloned := append([]RequestParameter(nil), parameters...)
	for index := range cloned {
		cloned[index].Enum = append([]string(nil), cloned[index].Enum...)
		if cloned[index].Description != nil {
			cloned[index].Description = maps.Clone(cloned[index].Description)
		}
	}
	return cloned
}

func decodeRequestParameters(value any) ([]RequestParameter, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("plugin meta requestParameters must be an array")
	}
	if len(items) > maxRequestParameters {
		return nil, fmt.Errorf("plugin meta requestParameters must not exceed %d entries", maxRequestParameters)
	}
	parameters := make([]RequestParameter, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("plugin meta requestParameters[%d] must be an object", index)
		}
		for key := range object {
			switch key {
			case "name", "type", "required", "default", "range", "enum", "description":
			default:
				return nil, fmt.Errorf("plugin meta requestParameters[%d] has unknown field %q", index, key)
			}
		}
		parameter, err := decodeRequestParameter(object)
		if err != nil {
			return nil, fmt.Errorf("plugin meta requestParameters[%d]: %w", index, err)
		}
		if _, duplicate := seen[parameter.Name]; duplicate {
			return nil, fmt.Errorf("plugin meta requestParameters has duplicate parameter %q", parameter.Name)
		}
		seen[parameter.Name] = struct{}{}
		parameters = append(parameters, parameter)
	}
	return parameters, nil
}

func decodeRequestParameter(object map[string]any) (RequestParameter, error) {
	parameter := RequestParameter{}
	var err error
	if parameter.Name, err = stringMetaField(object, "name"); err != nil {
		return RequestParameter{}, err
	}
	if parameter.Name == "" || len([]rune(parameter.Name)) > maxRequestParameterNameRunes {
		return RequestParameter{}, fmt.Errorf("parameter name must be 1-%d characters", maxRequestParameterNameRunes)
	}
	if !requestParameterNamePattern.MatchString(parameter.Name) {
		return RequestParameter{}, fmt.Errorf("parameter name must match %s", requestParameterNamePattern)
	}
	if parameter.Type, err = stringMetaField(object, "type"); err != nil {
		return RequestParameter{}, err
	}
	if !slices.Contains(requestParameterTypes, parameter.Type) {
		return RequestParameter{}, fmt.Errorf("parameter type must be one of %v", requestParameterTypes)
	}
	if required, exists := object["required"]; exists {
		flag, ok := required.(bool)
		if !ok {
			return RequestParameter{}, fmt.Errorf("parameter required must be a boolean")
		}
		parameter.Required = flag
	}
	if parameter.Default, err = requestParameterDefault(object); err != nil {
		return RequestParameter{}, err
	}
	if len([]rune(parameter.Default)) > maxRequestParameterDefaultRunes {
		return RequestParameter{}, fmt.Errorf("parameter default must not exceed %d characters", maxRequestParameterDefaultRunes)
	}
	if parameter.Range, err = stringMetaField(object, "range"); err != nil {
		return RequestParameter{}, err
	}
	if len([]rune(parameter.Range)) > maxRequestParameterRangeRunes {
		return RequestParameter{}, fmt.Errorf("parameter range must not exceed %d characters", maxRequestParameterRangeRunes)
	}
	if enum, exists := object["enum"]; exists {
		parameter.Enum, err = strictStringSlice(map[string]any{"enum": enum}, "enum")
		if err != nil {
			return RequestParameter{}, err
		}
		if len(parameter.Enum) == 0 || len(parameter.Enum) > maxRequestParameterEnumValues {
			return RequestParameter{}, fmt.Errorf("parameter enum must hold 1-%d values", maxRequestParameterEnumValues)
		}
		seen := make(map[string]struct{}, len(parameter.Enum))
		for _, option := range parameter.Enum {
			if option == "" {
				return RequestParameter{}, fmt.Errorf("parameter enum values must not be empty")
			}
			if _, duplicate := seen[option]; duplicate {
				return RequestParameter{}, fmt.Errorf("parameter enum has duplicate value %q", option)
			}
			seen[option] = struct{}{}
		}
	}
	if parameter.Type == "enum" && len(parameter.Enum) == 0 {
		return RequestParameter{}, fmt.Errorf("an enum parameter must declare its values")
	}
	parameter.Description, err = localizedTextMetaField(object, "description", maxUsageFieldDescriptionRunes)
	if err != nil {
		return RequestParameter{}, err
	}
	return parameter, nil
}

func decodeRequestProfiles(value any) ([]RequestProfile, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("plugin meta requestProfiles must be an array")
	}
	profiles := make([]RequestProfile, 0, len(items))
	for index, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("plugin meta requestProfiles[%d] must be an object", index)
		}
		for key := range object {
			if key != "models" && key != "parameters" {
				return nil, fmt.Errorf("plugin meta requestProfiles[%d] has unknown field %q", index, key)
			}
		}
		models, err := strictStringSlice(object, "models")
		if err != nil {
			return nil, fmt.Errorf("plugin meta requestProfiles[%d]: %w", index, err)
		}
		if len(models) == 0 {
			return nil, fmt.Errorf("plugin meta requestProfiles[%d] must declare at least one model", index)
		}
		parameters, err := decodeRequestParameters(object["parameters"])
		if err != nil {
			return nil, fmt.Errorf("plugin meta requestProfiles[%d]: %w", index, err)
		}
		profiles = append(profiles, RequestProfile{Models: models, Parameters: parameters})
	}
	return profiles, nil
}

// validateRequestParameterMeta checks what decoding cannot: that every profile
// names declared models, and that a model belongs to at most one profile.
func validateRequestParameterMeta(meta *Meta) error {
	declared := make(map[string]struct{}, len(meta.Models))
	for _, model := range meta.Models {
		declared[asciiFold(model)] = struct{}{}
	}
	profiled := make(map[string]int, len(meta.Models))
	for index, profile := range meta.RequestProfiles {
		for _, model := range profile.Models {
			folded := asciiFold(model)
			if _, ok := declared[folded]; !ok {
				return fmt.Errorf("plugin meta requestProfiles[%d] names undeclared model %q", index, model)
			}
			if previous, ok := profiled[folded]; ok {
				return fmt.Errorf("plugin meta model %q appears in requestProfiles[%d] and [%d]", model, previous, index)
			}
			profiled[folded] = index
		}
	}
	return nil
}

// requestParameterDefault accepts the scalar a plugin author naturally writes
// and keeps the display string the catalogue renders. A default is shown, never
// compared, so the string is the whole contract.
func requestParameterDefault(object map[string]any) (string, error) {
	value, exists := object["default"]
	if !exists || value == nil {
		return "", nil
	}
	switch typed := value.(type) {
	case string:
		return typed, nil
	case bool:
		return strconv.FormatBool(typed), nil
	case int64:
		return strconv.FormatInt(typed, 10), nil
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), nil
	default:
		return "", fmt.Errorf("parameter default must be a string, number or boolean")
	}
}
