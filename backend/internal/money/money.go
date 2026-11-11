// Package money provides fixed-point decimal helpers for all monetary values.
// All KES amounts use shopspring/decimal.Decimal which round-trips cleanly
// against PostgreSQL NUMERIC columns without float drift.
package money

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"
)

// Decimal is the canonical money type. Use it for every amount, total, fee,
// rate, outstanding, allocation, and reconciliation value.
type Decimal = decimal.Decimal

// New returns a Decimal from a whole-or-decimal string/number. It is safe to
// call with "", nil, float64, json.Number, or any numeric string.
func New(v any) Decimal {
	switch x := v.(type) {
	case nil:
		return decimal.NewFromFloat(0)
	case decimal.Decimal:
		return x
	case float64:
		return decimal.NewFromFloat(x)
	case float32:
		return decimal.NewFromFloat(float64(x))
	case json.Number:
		return mustParse(x.String())
	case string:
		return mustParse(x)
	case int:
		return decimal.NewFromInt(int64(x))
	case int64:
		return decimal.NewFromInt(x)
	default:
		return decimal.NewFromFloat(0)
	}
}

func mustParse(s string) decimal.Decimal {
	s = strings.TrimSpace(s)
	if s == "" {
		return decimal.NewFromFloat(0)
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		// Fall back to float parse for loose inputs (e.g. "1,234.56").
		if f, ferr := strconv.ParseFloat(s, 64); ferr == nil {
			return decimal.NewFromFloat(f)
		}
		return decimal.NewFromFloat(0)
	}
	return d
}

// Zero is the additive identity for money.
func Zero() decimal.Decimal { return decimal.NewFromFloat(0) }

// Add returns a + b.
func Add(a, b decimal.Decimal) decimal.Decimal { return a.Add(b) }

// Sub returns a - b.
func Sub(a, b decimal.Decimal) decimal.Decimal { return a.Sub(b) }

// Mul returns a * b.
func Mul(a, b decimal.Decimal) decimal.Decimal { return a.Mul(b) }

// Quo returns a / b rounded to the given precision.
func Quo(a, b decimal.Decimal, precision int32) decimal.Decimal {
	if b.IsZero() {
		return decimal.NewFromFloat(0)
	}
	return a.DivRound(b, precision)
}

// Max returns the larger of a and b.
func Max(a, b decimal.Decimal) decimal.Decimal {
	if a.GreaterThan(b) {
		return a
	}
	return b
}

// Clamp returns a bounded to [lo, hi].
func Clamp(v, lo, hi decimal.Decimal) decimal.Decimal {
	if v.LessThan(lo) {
		return lo
	}
	if v.GreaterThan(hi) {
		return hi
	}
	return v
}

// ToCents returns the value as integer cents (KES * 100), truncating.
func ToCents(v decimal.Decimal) int64 {
	return v.Mul(decimal.NewFromInt(100)).IntPart()
}

// FromCents builds a Decimal from integer cents.
func FromCents(cents int64) decimal.Decimal {
	return decimal.NewFromInt(cents).Div(decimal.NewFromInt(100))
}

// FormatKES renders the value as "1,234.56" for display.
func FormatKES(v decimal.Decimal) string {
	return v.StringFixed(2)
}

// MarshalJSON emits the numeric value as a JSON number (no string quoting),
// preserving full precision.
func MarshalJSON(d decimal.Decimal) ([]byte, error) {
	return []byte(d.String()), nil
}

// UnmarshalJSON accepts number or string inputs into a *decimal.Decimal.
func UnmarshalJSON(b []byte, d *decimal.Decimal) error {
	*d = New(string(b))
	return nil
}

// FormatMoneyf formats a Decimal with two decimals for error/log messages.
func FormatMoneyf(v decimal.Decimal) string {
	return v.StringFixed(2)
}

// FloatString is a helper that returns the decimal as a fixed-point string.
func FloatString(v decimal.Decimal, prec int) string {
	return v.StringFixed(int32(prec))
}