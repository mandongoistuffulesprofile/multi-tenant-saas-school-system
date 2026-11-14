// Package grading is the single source of truth for Kenya's CBC performance
// scales. It distinguishes the 4-band classroom rubric (PP1-Grade 3, and
// KPSEA/Grade 3 national reporting) from the 8-point sub-level scale used for
// Upper Primary and Junior School internal assessment and KJSEA reporting.
package grading

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
)

type Scale string

const (
	ScaleFourBand   Scale = "FOUR_BAND"
	ScaleEightPoint Scale = "EIGHT_POINT"
)

// Level is one rung of a scale. MinPercent is inclusive; the next higher
// level starts immediately after it.
type Level struct {
	Code        string  `json:"code"`
	Band        string  `json:"band"`
	Achievement int     `json:"achievement_level"`
	Points      int     `json:"points"`
	MinPercent  float64 `json:"min_percent"`
	Descriptor  string  `json:"descriptor"`
}

type ScaleDefinition struct {
	Scale       Scale   `json:"scale"`
	Label       string  `json:"label"`
	MinPoints   int     `json:"min_points"`
	MaxPoints   int     `json:"max_points"`
	LevelCount  int     `json:"level_count"`
	Levels      []Level `json:"levels"`
	Description string  `json:"description"`
}

var fourBand = ScaleDefinition{
	Scale:       ScaleFourBand,
	Label:       "4-Band Classroom Rubric",
	MinPoints:   1,
	MaxPoints:   4,
	LevelCount:  4,
	Description: "EE, ME, AE, BE. Classroom assessment for PP1-Grade 3 and KPSEA/Grade 3 reporting.",
	Levels: []Level{
		{Code: "EE", Band: "EE", Achievement: 4, Points: 4, MinPercent: 80, Descriptor: "Exceeding Expectations"},
		{Code: "ME", Band: "ME", Achievement: 3, Points: 3, MinPercent: 50, Descriptor: "Meeting Expectations"},
		{Code: "AE", Band: "AE", Achievement: 2, Points: 2, MinPercent: 30, Descriptor: "Approaching Expectations"},
		{Code: "BE", Band: "BE", Achievement: 1, Points: 1, MinPercent: 0, Descriptor: "Below Expectations"},
	},
}

var eightPoint = ScaleDefinition{
	Scale:       ScaleEightPoint,
	Label:       "KNEC 8-Point Sub-Level Scale",
	MinPoints:   1,
	MaxPoints:   8,
	LevelCount:  8,
	Description: "EE1-BE2. Upper Primary and Junior School internal assessment and KJSEA reporting.",
	Levels: []Level{
		{Code: "EE1", Band: "EE", Achievement: 8, Points: 8, MinPercent: 90, Descriptor: "Exceptional"},
		{Code: "EE2", Band: "EE", Achievement: 7, Points: 7, MinPercent: 75, Descriptor: "Very Good"},
		{Code: "ME1", Band: "ME", Achievement: 6, Points: 6, MinPercent: 58, Descriptor: "Good"},
		{Code: "ME2", Band: "ME", Achievement: 5, Points: 5, MinPercent: 41, Descriptor: "Fair"},
		{Code: "AE1", Band: "AE", Achievement: 4, Points: 4, MinPercent: 31, Descriptor: "Needs Improvement"},
		{Code: "AE2", Band: "AE", Achievement: 3, Points: 3, MinPercent: 21, Descriptor: "Below Average"},
		{Code: "BE1", Band: "BE", Achievement: 2, Points: 2, MinPercent: 11, Descriptor: "Well Below Average"},
		{Code: "BE2", Band: "BE", Achievement: 1, Points: 1, MinPercent: 0, Descriptor: "Minimal"},
	},
}

// Official returns an independent copy of a scale definition so callers cannot
// mutate the package defaults.
func Official(scale Scale) ScaleDefinition {
	base := fourBand
	if scale == ScaleEightPoint {
		base = eightPoint
	}
	out := base
	out.Levels = append([]Level(nil), base.Levels...)
	return out
}

// AllLevels returns the union of both scales, highest first.
func AllLevels() []Level {
	out := make([]Level, 0, 12)
	out = append(out, Official(ScaleEightPoint).Levels...)
	out = append(out, Official(ScaleFourBand).Levels...)
	return out
}

// ScaleForLevelBand maps the grades.level_band values to the default scale.
// EYE and LOWER_PRIMARY use the 4-band classroom rubric; UPPER_PRIMARY and JSS
// use the 8-point sub-level scale.
func ScaleForLevelBand(levelBand string) Scale {
	switch strings.ToUpper(strings.TrimSpace(levelBand)) {
	case "EYE", "LOWER_PRIMARY":
		return ScaleFourBand
	case "UPPER_PRIMARY", "JSS", "JUNIOR_SCHOOL", "JUNIOR_SECONDARY":
		return ScaleEightPoint
	default:
		return ScaleFourBand
	}
}

// ScaleForAssessmentType picks the scale for national reporting: KPSEA and the
// Grade 3 national assessment use the 4 capacity bands; KJSEA uses the official
// 8-point sub-level scale.
func ScaleForAssessmentType(assessmentType string) Scale {
	switch strings.ToUpper(strings.TrimSpace(assessmentType)) {
	case "KJSEA":
		return ScaleEightPoint
	default:
		return ScaleFourBand
	}
}

// NormalizeCode trims and upper-cases a level code.
func NormalizeCode(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}

// IsKnownLevel reports whether the code belongs to either official scale.
func IsKnownLevel(code string) bool {
	_, _, ok := lookup(NormalizeCode(code))
	return ok
}

// BandOf returns the parent 4-band code for any 4- or 8-point code.
func BandOf(code string) string {
	_, band, _ := lookup(NormalizeCode(code))
	return band
}

// PointsFor returns the official points for a level code.
func PointsFor(code string) (int, bool) {
	points, _, ok := lookup(NormalizeCode(code))
	return points, ok
}

func lookup(code string) (points int, band string, ok bool) {
	for _, l := range eightPoint.Levels {
		if l.Code == code {
			return l.Points, l.Band, true
		}
	}
	for _, l := range fourBand.Levels {
		if l.Code == code {
			return l.Points, l.Band, true
		}
	}
	return 0, "", false
}

// DescriptorFor returns the official descriptor for a level code.
func DescriptorFor(code string) string {
	code = NormalizeCode(code)
	for _, l := range AllLevels() {
		if l.Code == code {
			return l.Descriptor
		}
	}
	return ""
}

// LevelForPercent maps a percentage to the highest level whose minimum it
// meets. Boundaries are inclusive at the minimum.
func LevelForPercent(scale Scale, percent float64) Level {
	levels := Official(scale).Levels
	for _, l := range levels {
		if percent >= l.MinPercent {
			return l
		}
	}
	return levels[len(levels)-1]
}

// LevelForPercent applies the tenant's cutoff overrides for this scale.
func (c Config) LevelForPercent(scale Scale, percent float64) Level {
	def, err := c.Definition(scale)
	if err != nil {
		return LevelForPercent(scale, percent)
	}
	for _, l := range def.Levels {
		if percent >= l.MinPercent {
			return l
		}
	}
	return def.Levels[len(def.Levels)-1]
}

// LevelForPoints maps official points back to the scale's level code.
func LevelForPoints(scale Scale, points int) (Level, bool) {
	for _, l := range Official(scale).Levels {
		if l.Points == points {
			return l, true
		}
	}
	return Level{}, false
}

// ---------------------------------------------------------------------------
// Tenant configuration
// ---------------------------------------------------------------------------

// Config is the tenant-editable grading configuration stored in
// school_settings under the key "grading_config".
type Config struct {
	// Scale is AUTO, FOUR_BAND or EIGHT_POINT. AUTO resolves per grade band.
	Scale string `json:"scale"`
	// ShowAggregate controls the optional total/percentage summary. Default off
	// so out-of-the-box cards satisfy the MoE "no mean grade" rule.
	ShowAggregate bool `json:"show_aggregate"`
	// ShowPosition controls class ranking. Default off; MoE/KNEC prohibit it.
	ShowPosition bool `json:"show_position"`
	// Cutoffs overrides MinPercent per level code for internal assessments.
	Cutoffs map[string]float64 `json:"cutoffs,omitempty"`
}

func DefaultConfig() Config {
	return Config{Scale: "AUTO", ShowAggregate: false, ShowPosition: false}
}

// ResolveScale returns the concrete scale for a grade band under this config.
func (c Config) ResolveScale(levelBand string) Scale {
	switch strings.ToUpper(strings.TrimSpace(c.Scale)) {
	case string(ScaleFourBand):
		return ScaleFourBand
	case string(ScaleEightPoint):
		return ScaleEightPoint
	default:
		return ScaleForLevelBand(levelBand)
	}
}

// Definition returns the scale with any tenant cutoff overrides applied.
func (c Config) Definition(scale Scale) (ScaleDefinition, error) {
	def := Official(scale)
	if len(c.Cutoffs) == 0 {
		return def, nil
	}
	seen := make(map[string]float64, len(c.Cutoffs))
	for code, min := range c.Cutoffs {
		code = NormalizeCode(code)
		seen[code] = min
	}
	for i := range def.Levels {
		if min, ok := seen[def.Levels[i].Code]; ok {
			def.Levels[i].MinPercent = min
		}
	}
	if err := validateLevels(def.Levels); err != nil {
		return def, err
	}
	return def, nil
}

func validateLevels(levels []Level) error {
	if len(levels) == 0 {
		return fmt.Errorf("grading: scale has no levels")
	}
	// Levels are declared highest-first; enforce that order rather than
	// sorting, otherwise an inverted cutoff table (EE2 above EE1) would pass.
	if levels[0].MinPercent > 100 || levels[0].MinPercent < 0 {
		return fmt.Errorf("grading: top cutoff must be between 0 and 100")
	}
	if levels[len(levels)-1].MinPercent != 0 {
		return fmt.Errorf("grading: lowest level (%s) must start at 0", levels[len(levels)-1].Code)
	}
	for i := 1; i < len(levels); i++ {
		if levels[i].MinPercent >= levels[i-1].MinPercent {
			return fmt.Errorf("grading: cutoffs must decrease from %s (%v) to %s (%v)",
				levels[i-1].Code, levels[i-1].MinPercent, levels[i].Code, levels[i].MinPercent)
		}
	}
	return nil
}

// Validate rejects a configuration that would produce ambiguous bands.
func (c Config) Validate() error {
	switch strings.ToUpper(strings.TrimSpace(c.Scale)) {
	case "", "AUTO", string(ScaleFourBand), string(ScaleEightPoint):
	default:
		return fmt.Errorf("grading: scale must be AUTO, FOUR_BAND or EIGHT_POINT")
	}
	for code, min := range c.Cutoffs {
		if !IsKnownLevel(code) {
			return fmt.Errorf("grading: unknown level code %q", code)
		}
		if min < 0 || min > 100 {
			return fmt.Errorf("grading: cutoff for %s must be between 0 and 100", code)
		}
	}
	if len(c.Cutoffs) > 0 {
		for _, scale := range []Scale{ScaleFourBand, ScaleEightPoint} {
			if _, err := c.Definition(scale); err != nil {
				return err
			}
		}
	}
	return nil
}

// LoadConfig reads the tenant override, falling back to compliant defaults.
func LoadConfig(tx *sqlx.Tx, tenantID string) (Config, error) {
	cfg := DefaultConfig()
	if tx == nil {
		return cfg, fmt.Errorf("grading: no tenant transaction")
	}
	var raw []byte
	err := tx.QueryRow(
		`SELECT setting_value FROM school_settings WHERE tenant_id = $1 AND setting_key = 'grading_config'`,
		tenantID).Scan(&raw)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return cfg, nil
		}
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return DefaultConfig(), nil
	}
	if cfg.Scale == "" {
		cfg.Scale = "AUTO"
	}
	return cfg, nil
}

// SaveConfig persists the tenant override.
func SaveConfig(tx *sqlx.Tx, tenantID, userID string, cfg Config) error {
	if tx == nil {
		return fmt.Errorf("grading: no tenant transaction")
	}
	if err := cfg.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = tx.Exec(
		`INSERT INTO school_settings (tenant_id, setting_key, setting_value, updated_by)
		 VALUES ($1, 'grading_config', $2::jsonb, NULLIF($3, '')::uuid)
		 ON CONFLICT (tenant_id, setting_key)
		 DO UPDATE SET setting_value = EXCLUDED.setting_value,
		               version = school_settings.version + 1,
		               updated_by = EXCLUDED.updated_by,
		               updated_at = now()`,
		tenantID, string(raw), userID)
	return err
}
