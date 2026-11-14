package reports

import (
	"bytes"
	"testing"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/grading"
)

func TestAssignPositionsHandlesTiesAndSkipsMissingAggregates(t *testing.T) {
	a := &CardSnapshot{Aggregate: &SnapshotAggregate{Points: 30}}
	b := &CardSnapshot{Aggregate: &SnapshotAggregate{Points: 30}}
	c := &CardSnapshot{Aggregate: &SnapshotAggregate{Points: 24}}
	d := &CardSnapshot{}

	AssignPositions([]*CardSnapshot{a, b, c, d})

	if a.Position != 1 || b.Position != 1 {
		t.Fatalf("tied leaders should both be first, got %d and %d", a.Position, b.Position)
	}
	if c.Position != 3 {
		t.Fatalf("third place should be 3, got %d", c.Position)
	}
	if d.Position != 0 {
		t.Fatalf("card without aggregate must not be ranked, got %d", d.Position)
	}
}

func TestAggregateAreasIgnoresUnassessedAreas(t *testing.T) {
	areas := []SnapshotArea{
		{Code: "MAT", LevelCode: "EE1", Points: 8},
		{Code: "ENG", LevelCode: "ME1", Points: 6},
		{Code: "SCI"}, // no captured result
	}
	agg := aggregateAreas(areas, grading.Official(grading.ScaleEightPoint))
	if agg.Points != 14 || agg.MaxPoints != 16 {
		t.Fatalf("aggregate = %d/%d, want 14/16", agg.Points, agg.MaxPoints)
	}
	if agg.Percentage != 87.5 {
		t.Fatalf("percentage = %v, want 87.5", agg.Percentage)
	}
}

func TestApplyHeadlineLevelPrefersSummative(t *testing.T) {
	area := &SnapshotArea{Results: []SnapshotResult{
		{AssessmentType: "FORMATIVE", LevelCode: "EE1", Band: "EE", Descriptor: "Exceptional", Points: 8},
		{AssessmentType: "SUMMATIVE", LevelCode: "ME2", Band: "ME", Descriptor: "Fair", Points: 5},
	}}
	applyHeadlineLevel(area)
	if area.LevelCode != "ME2" || area.Points != 5 {
		t.Fatalf("headline = %s/%d, want ME2/5", area.LevelCode, area.Points)
	}
}

func TestNationalPageIsSeparate(t *testing.T) {
	card := sampleCard()
	card.National = []SnapshotNational{{
		AssessmentType: "KJSEA",
		AssessmentYear: 2026,
		SubjectName:    "Mathematics",
		RawBand:        "ME1",
		Band:           "ME",
		Descriptor:     "Good",
	}}
	pdf := card.Render()
	if !bytes.Contains(pdf, []byte("/Count 2")) {
		t.Fatal("expected a two-page PDF when national results are present")
	}
	if bytes.Count(pdf, []byte("/Type /Page ")) != 2 {
		t.Fatalf("expected exactly two page objects, got %d", bytes.Count(pdf, []byte("/Type /Page ")))
	}
}
