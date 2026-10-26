package school

import (
	"testing"
)

func TestNormalizeNEMIS(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"trim and uppercase", "  nEmIs-07  ", "NEMIS-07"},
		{"strip spaces", "N E M I S  12", "NEMIS12"},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		if got := normalizeNEMIS(tc.in); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}