package mpesa

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// Daraja callbacks carry no cryptographic signature, so the only thing standing
// between a forged POST and a credited learner is this check. It must fail
// closed when unconfigured and reject a caller that presents the wrong token or
// comes from outside the allowlist.
func TestCallbackAuthorisation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := &Service{}

	request := func(remoteAddr string, headers map[string]string) *gin.Context {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		req := httptest.NewRequest(http.MethodPost, "/webhooks/mpesa/c2b", nil)
		req.RemoteAddr = remoteAddr
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		c.Request = req
		return c
	}

	t.Run("nothing configured rejects every callback", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if svc.authorised(request("41.90.1.1:5000", map[string]string{"X-Webhook-Token": "anything"})) {
			t.Fatal("an unconfigured server accepted a callback; it must fail closed")
		}
	})

	t.Run("token must match when configured", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if svc.authorised(request("41.90.1.1:5000", nil)) {
			t.Fatal("accepted a callback with no X-Webhook-Token")
		}
		if svc.authorised(request("41.90.1.1:5000", map[string]string{"X-Webhook-Token": "guessed"})) {
			t.Fatal("accepted a callback with the wrong token")
		}
		if !svc.authorised(request("41.90.1.1:5000", map[string]string{"X-Webhook-Token": "safaricom-shared-secret"})) {
			t.Fatal("rejected a callback with the configured token")
		}
	})

	t.Run("allowlist rejects other sources", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200, 196.201.214.206")
		if svc.authorised(request("41.90.1.1:5000", nil)) {
			t.Fatal("accepted a callback from an address outside MPESA_ALLOWED_IPS")
		}
		if !svc.authorised(request("196.201.214.206:5000", nil)) {
			t.Fatal("rejected a callback from an allowlisted address")
		}
	})

	t.Run("both configured requires the token too", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200")
		if svc.authorised(request("196.201.214.200:5000", nil)) {
			t.Fatal("an allowlisted address bypassed the token requirement")
		}
	})
}
