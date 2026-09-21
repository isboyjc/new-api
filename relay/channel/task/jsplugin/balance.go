package jsplugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/service"
)

// A vendor that exposes an account balance needs a credential and a response
// shape only its plugin knows, so the plugin builds the request and reads the
// answer. The host contributes the transport, the channel proxy and the bounds.
//
// Every failure path returns an error. A channel whose balance reads as zero is
// disabled by the batch refresh, so "cannot tell" must never look like "empty".
const (
	balanceRequestTimeout  = 15 * time.Second
	maxBalanceResponseSize = 1 << 20
)

var errBalanceUnsupported = errors.New("task plugin does not report a balance")

// FetchBalance reads the upstream balance in US dollars.
func (a *TaskAdaptor) FetchBalance(channel *model.Channel) (float64, error) {
	if channel == nil {
		return 0, errors.New("channel is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), balanceRequestTimeout)
	defer cancel()
	if !a.hasHook(ctx, "buildBalanceRequest") || !a.hasHook(ctx, "parseBalance") {
		return 0, errBalanceUnsupported
	}

	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		return 0, errors.New("channel base URL is not configured")
	}
	proxy := strings.TrimSpace(channel.GetSetting().Proxy)
	hookContext, err := a.balanceContext(channel, baseURL, proxy)
	if err != nil {
		return 0, err
	}

	value, err := a.plugin.Engine.Call(ctx, "buildBalanceRequest", hookContext)
	if err != nil {
		return 0, fmt.Errorf("plugin balance request failed: %w", err)
	}
	if value == nil {
		// The plugin declines, normally because the channel holds no account
		// credential. Reported as unsupported rather than as an empty balance.
		return 0, errBalanceUnsupported
	}
	var descriptor requestDescriptor
	if err = convert(value, &descriptor); err != nil {
		return 0, errors.New("plugin returned an invalid balance request")
	}
	if strings.TrimSpace(descriptor.URL) == "" {
		return 0, errBalanceUnsupported
	}
	if err = pluginruntime.ValidateRequestURL(descriptor.URL, baseURL, a.plugin.Meta.AllowedHosts); err != nil {
		return 0, err
	}

	body, err := a.doBalanceRequest(ctx, descriptor, proxy)
	if err != nil {
		return 0, err
	}
	parsed, err := a.plugin.Engine.Call(ctx, "parseBalance", hookContext, body)
	if err != nil {
		return 0, fmt.Errorf("plugin balance response rejected: %w", err)
	}
	result, ok := parsed.(map[string]any)
	if !ok {
		return 0, errors.New("plugin balance hook must return an object")
	}
	balance, numeric := usageNumber(result["balance"], false)
	if !numeric || balance < 0 {
		return 0, errors.New("plugin returned an invalid balance")
	}
	// Reading is this layer's job; the caller owns persistence.
	return balance, nil
}

// balanceContext gives the hooks the channel credentials and base URL without
// the request-scoped fields a submit context carries.
func (a *TaskAdaptor) balanceContext(channel *model.Channel, baseURL, proxy string) (map[string]any, error) {
	hookContext := map[string]any{"baseUrl": baseURL}
	if err := a.applyUpstreamCredentials(hookContext, channel.Type, channel.Key, proxy); err != nil {
		return nil, err
	}
	return hookContext, nil
}

func (a *TaskAdaptor) doBalanceRequest(ctx context.Context, descriptor requestDescriptor, proxy string) (any, error) {
	method := strings.ToUpper(strings.TrimSpace(descriptor.Method))
	if method == "" {
		method = http.MethodGet
	}
	if method != http.MethodGet && method != http.MethodPost {
		return nil, errors.New("plugin balance request must use GET or POST")
	}
	request, err := http.NewRequestWithContext(ctx, method, descriptor.URL, nil)
	if err != nil {
		return nil, err
	}
	for name, value := range descriptor.Headers {
		request.Header.Set(name, fmt.Sprint(value))
	}
	client := service.GetHttpClient()
	if proxy != "" {
		client, err = service.GetHttpClientWithProxy(proxy)
		if err != nil {
			return nil, err
		}
	}
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxBalanceResponseSize))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream returned HTTP %d for the balance request", response.StatusCode)
	}
	var decoded any
	if err = common.Unmarshal(payload, &decoded); err != nil {
		return nil, errors.New("upstream returned an unreadable balance response")
	}
	return decoded, nil
}
