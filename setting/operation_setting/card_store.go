package operation_setting

import (
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const CardStoreOptionKey = "card_store_setting.config"

type CardStoreAmount struct {
	Amount float64 `json:"amount"` // Redemption code face value in system USD.
	URL    string  `json:"url"`
}

type CardStoreConfig struct {
	Enabled       bool              `json:"enabled"`
	StoreURL      string            `json:"store_url"`
	AmountOptions []CardStoreAmount `json:"amount_options"`
}

func isCardStoreURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || len(value) > 2048 ||
		(parsed.Scheme != "https" && parsed.Scheme != "http") ||
		parsed.Hostname() == "" || parsed.User != nil {
		return false
	}
	if port := parsed.Port(); port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number > 65535 {
			return false
		}
	}
	return true
}

func ParseCardStoreConfig(value string) (CardStoreConfig, error) {
	var config CardStoreConfig
	if err := common.UnmarshalJsonStr(value, &config); err != nil || strings.TrimSpace(value) == "null" {
		return config, errors.New("Invalid card store configuration")
	}
	config.StoreURL = strings.TrimSpace(config.StoreURL)
	if (config.Enabled || config.StoreURL != "") && !isCardStoreURL(config.StoreURL) {
		return config, errors.New("Card store links must be valid HTTP or HTTPS URLs.")
	}
	if len(config.AmountOptions) > 24 {
		return config, errors.New("Configure up to 24 quick amounts.")
	}
	amounts := make(map[float64]bool, len(config.AmountOptions))
	for i := range config.AmountOptions {
		option := &config.AmountOptions[i]
		if math.IsNaN(option.Amount) || math.IsInf(option.Amount, 0) || option.Amount <= 0 || option.Amount > 1e9 {
			return config, errors.New("Card store amounts must be greater than 0 and no more than 1,000,000,000 USD.")
		}
		if amounts[option.Amount] {
			return config, errors.New("Quick amounts must be unique.")
		}
		amounts[option.Amount] = true
		option.URL = strings.TrimSpace(option.URL)
		if option.URL != "" && !isCardStoreURL(option.URL) {
			return config, errors.New("Card store links must be valid HTTP or HTTPS URLs.")
		}
	}
	if config.AmountOptions == nil {
		config.AmountOptions = []CardStoreAmount{}
	}
	return config, nil
}

func GetCardStoreConfig() CardStoreConfig {
	common.OptionMapRWMutex.RLock()
	value, configured := common.OptionMap[CardStoreOptionKey]
	legacyURL := strings.TrimSpace(common.OptionMap["TopUpLink"])
	common.OptionMapRWMutex.RUnlock()

	if configured {
		config, err := ParseCardStoreConfig(value)
		if err == nil {
			for i := range config.AmountOptions {
				if config.AmountOptions[i].URL == "" {
					config.AmountOptions[i].URL = config.StoreURL
				}
			}
			return config
		}
		// Invalid persisted settings must not restore a disabled legacy shop.
		return CardStoreConfig{AmountOptions: []CardStoreAmount{}}
	}
	return CardStoreConfig{
		Enabled:       isCardStoreURL(legacyURL),
		StoreURL:      legacyURL,
		AmountOptions: []CardStoreAmount{},
	}
}
