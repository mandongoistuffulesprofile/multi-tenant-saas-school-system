package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// STKCallbackHandler writes money-affecting rows, and it has its own copy of the
// authorisation check (webhookAuthorised) rather than sharing the mpesa one.
// Both must fail closed: an unauthenticated callback must never reach the inbox.
func TestWebhookAuthorisedRejectsForgedCallbacks(t *testing.T) {
	req := func(remoteAddr string, headers map[string]string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/mpesa/stk-callback", nil)
		r.RemoteAddr = remoteAddr
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		return r
	}

	t.Run("unconfigured rejects", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if webhookAuthorised(req("196.201.214.200:5000", nil)) {
			t.Fatal("an unconfigured server accepted a callback; it must fail closed")
		}
	})

	t.Run("wrong or missing token rejects", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if webhookAuthorised(req("196.201.214.200:5000", nil)) {
			t.Fatal("accepted a callback with no X-Webhook-Token")
		}
		if webhookAuthorised(req("196.201.214.200:5000", map[string]string{"X-Webhook-Token": "guessed"})) {
			t.Fatal("accepted a callback with the wrong token")
		}
		if !webhookAuthorised(req("196.201.214.200:5000", map[string]string{"X-Webhook-Token": "safaricom-shared-secret"})) {
			t.Fatal("rejected a callback with the configured token")
		}
	})

	t.Run("allowlist rejects other sources", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200")
		if webhookAuthorised(req("41.90.1.1:5000", nil)) {
			t.Fatal("accepted a callback from an address outside MPESA_ALLOWED_IPS")
		}
		if !webhookAuthorised(req("196.201.214.200:5000", nil)) {
			t.Fatal("rejected a callback from an allowlisted address")
		}
	})
}
