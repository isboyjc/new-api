package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCardStoreRejectsInvalidSettingsBeforePersistence(t *testing.T) {
	for _, value := range []string{
		`null`,
		`[]`,
		`{"enabled":true,"store_url":"javascript:alert(1)"}`,
		`{"enabled":true,"store_url":""}`,
		`{"enabled":true,"store_url":"https://user:password@shop.example.com"}`,
		`{"enabled":true,"store_url":"https://shop.example.com","amount_options":[{"amount":0,"url":"https://shop.example.com/item"}]}`,
		`{"enabled":true,"store_url":"https://shop.example.com","amount_options":[{"amount":10,"url":"data:text/html,test"}]}`,
		`{"enabled":true,"store_url":"https://shop.example.com","amount_options":[{"amount":10,"url":"https://shop.example.com/a"},{"amount":10,"url":"https://shop.example.com/b"}]}`,
	} {
		t.Run(value, func(t *testing.T) {
			body, err := common.Marshal(OptionUpdateRequest{Key: operation_setting.CardStoreOptionKey, Value: value})
			require.NoError(t, err)
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			ctx.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(string(body)))
			UpdateOption(ctx)
			assert.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.False(t, payload.Success)
		})
	}
}

func TestCardStoreRejectsLinksBrowsersCannotOpen(t *testing.T) {
	for _, link := range []string{
		"https://shop.example.com:70000",
		"https://[not-an-ip]/shop",
		"https:shop.example.com",
	} {
		t.Run(link, func(t *testing.T) {
			value, err := common.Marshal(operation_setting.CardStoreConfig{
				Enabled:  true,
				StoreURL: link,
			})
			require.NoError(t, err)
			_, err = operation_setting.ParseCardStoreConfig(string(value))
			require.Error(t, err, "unusable shop links must be rejected before saving")
		})
	}
}

func TestCardStoreTopupInfoPreservesGatewayAndCompliance(t *testing.T) {
	oldPayment := *operation_setting.GetPaymentSetting()
	oldMethods := operation_setting.PayMethods
	common.OptionMapRWMutex.Lock()
	oldOptions := common.OptionMap
	common.OptionMap = map[string]string{"TopUpLink": "https://legacy.example.com"}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		*operation_setting.GetPaymentSetting() = oldPayment
		operation_setting.PayMethods = oldMethods
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldOptions
		common.OptionMapRWMutex.Unlock()
	})
	operation_setting.PayMethods = []map[string]string{{"name": "Existing gateway", "type": "alipay"}}
	payment := operation_setting.GetPaymentSetting()
	payment.ComplianceConfirmed = true
	payment.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion

	cases := []struct {
		name      string
		raw       string
		confirmed bool
		enabled   bool
		url       string
		count     int
		links     []string
	}{
		{"legacy fallback", "", true, true, "https://legacy.example.com", 0, nil},
		{"dedicated product links", `{"enabled":true,"store_url":"https://shop.example.com","amount_options":[{"amount":10.5,"url":"https://shop.example.com/ten"},{"amount":50,"url":"https://shop.example.com/fifty"}]}`, true, true, "https://shop.example.com", 2, []string{"https://shop.example.com/ten", "https://shop.example.com/fifty"}},
		{"blank product link inherits main shop", `{"enabled":true,"store_url":" https://shop.example.com ","amount_options":[{"amount":5,"url":"   "},{"amount":50,"url":"https://shop.example.com/fifty"}]}`, true, true, "https://shop.example.com", 2, []string{"https://shop.example.com", "https://shop.example.com/fifty"}},
		{"explicit disabled overrides legacy", `{"enabled":false,"store_url":"https://shop.example.com","amount_options":[]}`, true, false, "", 0, nil},
		{"invalid stored config fails closed", `{"enabled":true,"store_url":"javascript:alert(1)"}`, true, false, "", 0, nil},
		{"unconfirmed hides card store", `{"enabled":true,"store_url":"https://shop.example.com","amount_options":[]}`, false, false, "", 0, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			delete(common.OptionMap, operation_setting.CardStoreOptionKey)
			if tc.raw != "" {
				common.OptionMap[operation_setting.CardStoreOptionKey] = tc.raw
			}
			common.OptionMapRWMutex.Unlock()
			payment.ComplianceConfirmed = tc.confirmed
			response := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(response)
			GetTopUpInfo(ctx)
			var payload struct {
				Success bool `json:"success"`
				Data    struct {
					CardStore        operation_setting.CardStoreConfig `json:"card_store"`
					TopupLink        string                            `json:"topup_link"`
					EnableRedemption bool                              `json:"enable_redemption"`
					PayMethods       []map[string]string               `json:"pay_methods"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.Equal(t, tc.enabled, payload.Data.CardStore.Enabled)
			assert.Equal(t, tc.url, payload.Data.TopupLink)
			assert.Len(t, payload.Data.CardStore.AmountOptions, tc.count)
			for i, link := range tc.links {
				require.Greater(t, len(payload.Data.CardStore.AmountOptions), i)
				assert.Equal(t, link, payload.Data.CardStore.AmountOptions[i].URL)
			}
			if tc.raw != "" {
				common.OptionMapRWMutex.RLock()
				persisted := common.OptionMap[operation_setting.CardStoreOptionKey]
				common.OptionMapRWMutex.RUnlock()
				assert.Equal(t, tc.raw, persisted, "resolving purchase URLs must not overwrite stored defaults")
			}
			assert.Equal(t, tc.confirmed, payload.Data.EnableRedemption)
			if tc.confirmed {
				assert.Contains(t, payload.Data.PayMethods, operation_setting.PayMethods[0])
			}
			for _, method := range payload.Data.PayMethods {
				assert.NotEqual(t, "card_store", method["type"])
			}
		})
	}
}
