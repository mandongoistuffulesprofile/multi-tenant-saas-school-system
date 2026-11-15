package main

import (
	"strings"
	"testing"
)

func TestCredentialLookupOnlyMatchesPhoneWhenSupplied(t *testing.T) {
	t.Run("email only", func(t *testing.T) {
		query, args := credentialLookup("admin@demo.test", "")
		if strings.Contains(query, "phone_number") {
			t.Fatalf("email-only lookup still probes phone_number: %s", query)
		}
		if len(args) != 1 || args[0] != "admin@demo.test" {
			t.Fatalf("args = %#v, want just the email", args)
		}
	})

	t.Run("phone and email", func(t *testing.T) {
		query, args := credentialLookup("parent@demo.test", "254700000003")
		if !strings.Contains(query, "phone_number = $1") {
			t.Fatalf("expected phone branch, got: %s", query)
		}
		if !strings.Contains(query, "email = $2") {
			t.Fatalf("expected email branch, got: %s", query)
		}
		if len(args) != 2 || args[0] != "254700000003" || args[1] != "parent@demo.test" {
			t.Fatalf("args = %#v, want phone then email", args)
		}
	})
}
