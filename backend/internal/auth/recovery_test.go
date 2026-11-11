package auth

import (
	"strings"
	"testing"
)

func TestNormalizeAnswer(t *testing.T) {
	cases := map[string]string{
		"  Nairobi  ":        "nairobi",
		"Mary   Anne":        "mary anne",
		"\tGreen\tField \n":  "green field",
		"":                   "",
		"  ":                 "",
		"St. Mary's Primary": "st. mary's primary",
	}
	for input, want := range cases {
		if got := normalizeAnswer(input); got != want {
			t.Errorf("normalizeAnswer(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestValidateRecoveryAnswers(t *testing.T) {
	valid := []recoveryAnswerInput{
		{QuestionID: 2, Answer: "  Riverside  "},
		{QuestionID: 5, Answer: "Rex"},
		{QuestionID: 8, Answer: "Toyota"},
	}
	got, msg := validateRecoveryAnswers(valid)
	if msg != "" {
		t.Fatalf("valid answers rejected: %s", msg)
	}
	if got[2] != "riverside" {
		t.Fatalf("answer was not normalised: %q", got[2])
	}

	duplicate := append([]recoveryAnswerInput{}, valid...)
	duplicate[2].QuestionID = 5
	if _, msg := validateRecoveryAnswers(duplicate); msg == "" {
		t.Fatal("duplicate questions were accepted")
	}

	missingID := append([]recoveryAnswerInput{}, valid...)
	missingID[0].QuestionID = 0
	if _, msg := validateRecoveryAnswers(missingID); msg == "" {
		t.Fatal("missing question id was accepted")
	}

	short := append([]recoveryAnswerInput{}, valid...)
	short[1].Answer = "x"
	if _, msg := validateRecoveryAnswers(short); msg == "" {
		t.Fatal("one-character answer was accepted")
	}

	if _, msg := validateRecoveryAnswers(valid[:2]); msg == "" {
		t.Fatal("fewer than three questions were accepted")
	}
}

func TestGenerateRecoveryCode(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 25; i++ {
		code, err := generateRecoveryCode()
		if err != nil {
			t.Fatalf("generateRecoveryCode: %v", err)
		}
		if len(code) != 11 || code[5] != '-' {
			t.Fatalf("code %q is not in XXXXX-XXXXX form", code)
		}
		normalized := normalizeRecoveryCode(code)
		if len(normalized) != 10 {
			t.Fatalf("normalised code %q has length %d, want 10", normalized, len(normalized))
		}
		for _, r := range normalized {
			if !strings.ContainsRune(recoveryCodeAlphabet, r) {
				t.Fatalf("code %q contains disallowed character %q", code, r)
			}
		}
		if seen[normalized] {
			t.Fatalf("duplicate code generated: %q", code)
		}
		seen[normalized] = true
	}

	if normalizeRecoveryCode(" abcd-efgh ") != "ABCDEFGH" {
		t.Fatal("normalizeRecoveryCode did not strip separators and uppercase")
	}
}
