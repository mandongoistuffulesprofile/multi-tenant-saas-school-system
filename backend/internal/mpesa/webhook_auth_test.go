package mpesa

import "testing"

// Daraja callbacks carry no cryptographic signature, so the only thing standing
// between a forged POST and a credited learner is this check. It must fail
// closed when unconfigured and reject a caller that presents the wrong token or
// comes from outside the allowlist. Every callback route uses this one function.
func TestCallbackAuthorised(t *testing.T) {
	t.Run("nothing configured rejects every callback", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if CallbackAuthorised("41.90.1.1", "anything") {
			t.Fatal("an unconfigured server accepted a callback; it must fail closed")
		}
	})

	t.Run("token must match when configured", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "")
		if CallbackAuthorised("41.90.1.1", "") {
			t.Fatal("accepted a callback with no X-Webhook-Token")
		}
		if CallbackAuthorised("41.90.1.1", "guessed") {
			t.Fatal("accepted a callback with the wrong token")
		}
		if !CallbackAuthorised("41.90.1.1", "safaricom-shared-secret") {
			t.Fatal("rejected a callback with the configured token")
		}
	})

	t.Run("allowlist rejects other sources", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200, 196.201.214.206")
		if CallbackAuthorised("41.90.1.1", "") {
			t.Fatal("accepted a callback from an address outside MPESA_ALLOWED_IPS")
		}
		if !CallbackAuthorised("196.201.214.206", "") {
			t.Fatal("rejected a callback from an allowlisted address")
		}
	})

	t.Run("both configured requires the token too", func(t *testing.T) {
		t.Setenv("MPESA_WEBHOOK_TOKEN", "safaricom-shared-secret")
		t.Setenv("MPESA_ALLOWED_IPS", "196.201.214.200")
		if CallbackAuthorised("196.201.214.200", "") {
			t.Fatal("an allowlisted address bypassed the token requirement")
		}
	})
}

func TestClientIPFromRemoteAddr(t *testing.T) {
	cases := map[string]string{
		"196.201.214.200:5000": "196.201.214.200",
		"[2001:db8::1]:443":    "2001:db8::1",
		"196.201.214.200":      "196.201.214.200",
	}
	for in, want := range cases {
		if got := ClientIPFromRemoteAddr(in); got != want {
			t.Errorf("ClientIPFromRemoteAddr(%q) = %q, want %q", in, got, want)
		}
	}
}
