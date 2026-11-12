package academic

import "testing"

func testGrades() []Grade {
	return []Grade{
		{GradeID: "G1", GradeLabel: "Grade 1", LevelBand: "LOWER_PRIMARY"},
		{GradeID: "PP1", GradeLabel: "PP1", LevelBand: "EYE"},
		{GradeID: "G9", GradeLabel: "Grade 9", LevelBand: "JSS"},
		{GradeID: "PP2", GradeLabel: "PP2", LevelBand: "EYE"},
		{GradeID: "G2", GradeLabel: "Grade 2", LevelBand: "LOWER_PRIMARY"},
	}
}

// TestRolloverMapsPP1ToPP2 pins the Kenyan ladder: PP1's successor is PP2, not
// Grade 1, and the mapping must not depend on the order grades were returned.
func TestRolloverMapsPP1ToPP2(t *testing.T) {
	next, ok := NextGrade(testGrades(), "PP1")
	if !ok {
		t.Fatal("PP1 has no next grade, want PP2")
	}
	if next.GradeID != "PP2" || next.GradeLabel != "PP2" {
		t.Fatalf("PP1 -> %s (%s), want PP2", next.GradeID, next.GradeLabel)
	}

	next, ok = NextGrade(testGrades(), "PP2")
	if !ok || next.GradeID != "G1" {
		t.Fatalf("PP2 -> %s, want G1", next.GradeID)
	}

	if _, ok := NextGrade(testGrades(), "G9"); ok {
		t.Fatal("G9 has a successor, want terminal/graduating")
	}
}

// TestRolloverRequiresExplicitApply is the safety contract: a request that
// does not explicitly opt in must never promote a learner.
func TestRolloverRequiresExplicitApply(t *testing.T) {
	trueVal := true
	falseVal := false

	cases := []struct {
		name   string
		apply  *bool
		dryRun *bool
		want   bool
	}{
		{name: "no flags", want: false},
		{name: "apply true", apply: &trueVal, want: true},
		{name: "apply false", apply: &falseVal, want: false},
		{name: "dry_run false", dryRun: &falseVal, want: true},
		{name: "dry_run true", dryRun: &trueVal, want: false},
		{name: "apply false with dry_run false stays a preview", apply: &falseVal, dryRun: &falseVal, want: false},
		{name: "apply true with dry_run true applies", apply: &trueVal, dryRun: &trueVal, want: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ShouldApply(tc.apply, tc.dryRun); got != tc.want {
				t.Fatalf("ShouldApply(apply=%v, dry_run=%v) = %v, want %v",
					tc.apply, tc.dryRun, got, tc.want)
			}
		})
	}
}

// TestRolloverPlanCounts checks that the preview totals per grade, per stream
// and in aggregate match the source enrolments.
func TestRolloverPlanCounts(t *testing.T) {
	sources := []SourceGroup{
		{GradeID: "PP1", GradeLabel: "PP1", StreamID: "east", Learners: 4},
		{GradeID: "PP1", GradeLabel: "PP1", StreamID: "west", Learners: 6},
		{GradeID: "G9", GradeLabel: "Grade 9", StreamID: "east", Learners: 3},
	}
	plan := BuildPlan(testGrades(), sources)

	if plan.TotalLearners != 13 {
		t.Fatalf("total learners = %d, want 13", plan.TotalLearners)
	}
	if plan.Promoted != 10 {
		t.Fatalf("promoted = %d, want 10", plan.Promoted)
	}
	if plan.Graduating != 3 {
		t.Fatalf("graduating = %d, want 3", plan.Graduating)
	}
	if len(plan.Moves) != 2 {
		t.Fatalf("moves = %d, want 2 (one per source grade)", len(plan.Moves))
	}

	pp1 := plan.Moves[0]
	if pp1.FromGradeID != "PP1" || pp1.ToGradeID != "PP2" {
		t.Fatalf("first move %s -> %s, want PP1 -> PP2", pp1.FromGradeID, pp1.ToGradeID)
	}
	if pp1.Learners != 10 || pp1.Streams != 2 {
		t.Fatalf("PP1 move = %d learners in %d streams, want 10 in 2", pp1.Learners, pp1.Streams)
	}
	if plan.Moves[1].ToGradeID != "" {
		t.Fatalf("G9 move targets %s, want graduation", plan.Moves[1].ToGradeID)
	}
}
