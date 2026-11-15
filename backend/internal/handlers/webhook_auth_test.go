package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Both callback routes write money-affecting rows and must refuse a forged
// request before touching the database. They share one authorisation
// implementation (mpesa.CallbackAuthorised, which has its own unit tests); these
// tests prove the routes actually call it, on the real handlers.
func TestCallbackRoutesRejectForgedRequests(t *testing.T) {
	handlers := map[string]func(*APIHandlers, http.ResponseWriter, *http.Request){
		"stk": (*APIHandlers).STKCallbackHandler,
		"c2b": (*APIHandlers).DarajaC2BCallbackHandler,
	}

	request := func(remoteAddr string, headers map[string]string) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/mpesa/callback", nil)
		r.RemoteAddr = remoteAddr
		for k, v := range headers {
			r.Header.Set(k, v)
		}
		return r
	}

	t.Run("unconfigured rejects", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		for name, handler := range handlers {
			w := httptest.NewRecorder()
			handler(&APIHandlers{}, w, request("196.201.214.200:5000", nil))
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s: unconfigured server returned %d, want 401", name, w.Code)
			}
		}
	})

	t.Run("wrong or missing token rejects", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		for name, handler := range handlers {
			for _, headers := range []map[string]string{nil, {"X-Webhook-Token": "guessed"}} {
				w := httptest.NewRecorder()
				handler(&APIHandlers{}, w, request("196.201.214.200:5000", headers))
				if w.Code != http.StatusUnauthorized {
					t.Fatalf("%s: forged token returned %d, want 401", name, w.Code)
				}
			}
		}
	})

	t.Run("address outside the allowlist rejects", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200")
		for name, handler := range handlers {
			w := httptest.NewRecorder()
			handler(&APIHandlers{}, w, request("41.90.1.1:5000", nil))
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s: non-allowlisted caller returned %d, want 401", name, w.Code)
			}
		}
	})

	// The point of the check is that an authorised callback gets past it, so a
	// rejection-only suite would pass even if it rejected everything. With valid
	// credentials the handler moves on and fails later on the missing tenant,
	// which is a different error.
	t.Run("authorised callback gets past authorisation", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		for name, handler := range handlers {
			w := httptest.NewRecorder()
			handler(&APIHandlers{}, w, request("41.90.1.1:5000", map[string]string{
				"X-Webhook-Token": "safaricom-shared-secret",
			}))
			if w.Code == http.StatusUnauthorized {
				t.Fatalf("%s: rejected a callback with valid credentials", name)
			}
		}
	})
}
