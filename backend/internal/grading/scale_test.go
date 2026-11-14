package grading

import "testing"

func TestOfficialEightPointBoundaries(t *testing.T) {
	cases := []struct {
		percent float64
		want    string
		points  int
	}{
		{100, "EE1", 8}, {90, "EE1", 8}, {89.99, "EE2", 7}, {75, "EE2", 7},
		{74.99, "ME1", 6}, {58, "ME1", 6}, {57.99, "ME2", 5}, {41, "ME2", 5},
		{40.99, "AE1", 4}, {31, "AE1", 4}, {30.99, "AE2", 3}, {21, "AE2", 3},
		{20.99, "BE1", 2}, {11, "BE1", 2}, {10.99, "BE2", 1}, {0, "BE2", 1},
	}
	for _, tc := range cases {
		got := LevelForPercent(ScaleEightPoint, tc.percent)
		if got.Code != tc.want || got.Points != tc.points {
			t.Errorf("percent %.2f = %s/%d, want %s/%d", tc.percent, got.Code, got.Points, tc.want, tc.points)
		}
	}
}

func TestFourBandBoundaries(t *testing.T) {
	cases := []struct {
		percent float64
		want    string
	}{
		{100, "EE"}, {80, "EE"}, {79.99, "ME"}, {50, "ME"},
		{49.99, "AE"}, {30, "AE"}, {29.99, "BE"}, {0, "BE"},
	}
	for _, tc := range cases {
		if got := LevelForPercent(ScaleFourBand, tc.percent); got.Code != tc.want {
			t.Errorf("percent %.2f = %s, want %s", tc.percent, got.Code, tc.want)
		}
	}
}

func TestScaleSelectionByGradeBand(t *testing.T) {
	cases := map[string]Scale{
		"EYE": ScaleFourBand, "LOWER_PRIMARY": ScaleFourBand,
		"UPPER_PRIMARY": ScaleEightPoint, "JSS": ScaleEightPoint,
	}
	for band, want := range cases {
		if got := ScaleForLevelBand(band); got != want {
			t.Errorf("band %s = %s, want %s", band, got, want)
		}
	}
	if ScaleForAssessmentType("KJSEA") != ScaleEightPoint {
		t.Error("KJSEA must use the 8-point scale")
	}
	if ScaleForAssessmentType("KPSEA") != ScaleFourBand {
		t.Error("KPSEA must use the 4-band scale")
	}
}

func TestPointsAndDescriptors(t *testing.T) {
	for _, code := range []string{"EE1", "EE2", "ME1", "ME2", "AE1", "AE2", "BE1", "BE2"} {
		points, ok := PointsFor(code)
		if !ok || points < 1 || points > 8 {
			t.Fatalf("%s points = %d, ok = %v", code, points, ok)
		}
		if DescriptorFor(code) == "" {
			t.Fatalf("%s has no descriptor", code)
		}
		if BandOf(code) == "" {
			t.Fatalf("%s has no band", code)
		}
	}
	if _, ok := PointsFor("ZZ"); ok {
		t.Fatal("unknown code accepted")
	}
}

func TestConfigResolvesAndAppliesCutoffs(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.ResolveScale("JSS") != ScaleEightPoint {
		t.Fatal("JSS should resolve to 8-point")
	}
	cfg.Scale = string(ScaleFourBand)
	if cfg.ResolveScale("JSS") != ScaleFourBand {
		t.Fatal("admin override ignored")
	}

	override := DefaultConfig()
	override.Cutoffs = map[string]float64{
		"EE1": 95, "EE2": 80, "ME1": 60, "ME2": 45,
		"AE1": 35, "AE2": 25, "BE1": 15, "BE2": 0,
		"EE": 80, "ME": 50, "AE": 30, "BE": 0,
	}
	def, err := override.Definition(ScaleEightPoint)
	if err != nil {
		t.Fatalf("definition: %v", err)
	}
	if def.Levels[0].MinPercent != 95 {
		t.Fatalf("EE1 cutoff = %v, want 95", def.Levels[0].MinPercent)
	}
	if got := override.LevelForPercent(ScaleEightPoint, 94); got.Code != "EE2" {
		t.Fatalf("94%% = %s, want EE2 under override", got.Code)
	}
}

func TestConfigValidationRejectsBadCutoffs(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Cutoffs = map[string]float64{
		"EE1": 50, "EE2": 80, "ME1": 60, "ME2": 45,
		"AE1": 35, "AE2": 25, "BE1": 15, "BE2": 0,
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("non-monotonic cutoffs accepted")
	}
	cfg.Cutoffs = map[string]float64{"EE1": 120}
	if err := cfg.Validate(); err == nil {
		t.Fatal("out-of-range cutoff accepted")
	}
}
