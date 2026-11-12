package imports

import "testing"

func testGrades() map[string]string {
	return map[string]string{
		"pp1":     "PP1",
		"pp2":     "PP2",
		"grade 1": "G1",
	}
}

// TestImportCountsDuplicatesSeparatelyFromInvalid is the contract the import
// screen relies on: a learner that already exists is a duplicate (not an
// error to fix), a row missing required fields is invalid, and neither is
// counted as importable.
func TestImportCountsDuplicatesSeparatelyFromInvalid(t *testing.T) {
	existing := map[string]bool{"ADM-001": true}
	csvText := `admission_number,first_name,middle_name,last_name,grade_label,stream_name,guardian_phone
ADM-001,Existing,Pupil,Learner,Grade 1,East,0700000001
ADM-002,Grace,Wanjiku,Kamau,PP1,East,0700000002
ADM-002,Grace,Wanjiku,Kamau,PP1,East,0700000002
ADM-003,,Missing,Name,PP1,East,0700000003
ADM-004,Unknown,Grade,Pupil,Grade 77,West,0700000004
ADM-005,Brian,Otieno,Odhiambo,PP2,West,0700000005`

	preview, err := PreviewCSV(csvText, existing, testGrades())
	if err != nil {
		t.Fatalf("PreviewCSV: %v", err)
	}

	if preview.TotalRows != 6 {
		t.Fatalf("total rows = %d, want 6", preview.TotalRows)
	}
	if preview.Importable != 2 {
		t.Fatalf("importable = %d, want 2 (ADM-002 first and ADM-005)", preview.Importable)
	}
	if preview.Duplicates != 2 {
		t.Fatalf("duplicates = %d, want 2 (ADM-001 existing, ADM-002 repeated)", preview.Duplicates)
	}
	if preview.Invalid != 2 {
		t.Fatalf("invalid = %d, want 2 (missing first name, unknown grade)", preview.Invalid)
	}

	var statuses []string
	for _, row := range preview.Rows {
		statuses = append(statuses, row.AdmissionNumber+":"+row.Status)
	}
	want := []string{
		"ADM-001:DUPLICATE",
		"ADM-002:IMPORTABLE",
		"ADM-002:DUPLICATE",
		"ADM-003:INVALID",
		"ADM-004:INVALID",
		"ADM-005:IMPORTABLE",
	}
	for i := range want {
		if statuses[i] != want[i] {
			t.Fatalf("row %d = %s, want %s", i, statuses[i], want[i])
		}
	}
}

// TestImportAuditDetails records the applied batch's outcome, including the
// duplicate and invalid counts the import screen showed the operator.
func TestImportAuditDetails(t *testing.T) {
	preview := Preview{TotalRows: 6, Importable: 2, Duplicates: 2, Invalid: 2}
	details := ImportAuditDetails(preview, 2)

	want := map[string]any{
		"rows_created": 2,
		"total_rows":   6,
		"duplicates":   2,
		"invalid":      2,
	}
	for key, expected := range want {
		if details[key] != expected {
			t.Fatalf("audit detail %q = %v, want %v", key, details[key], expected)
		}
	}
}

// TestPreviewAcceptsAnyColumnOrder keeps the import screen usable with the
// export layouts schools already keep in spreadsheets.
func TestPreviewAcceptsAnyColumnOrder(t *testing.T) {
	csvText := `last_name,admission_number,grade_label,first_name
Kamau,ADM-100,PP2,Grace`
	preview, err := PreviewCSV(csvText, map[string]bool{}, testGrades())
	if err != nil {
		t.Fatalf("PreviewCSV: %v", err)
	}
	if preview.Importable != 1 || preview.Invalid != 0 || preview.Duplicates != 0 {
		t.Fatalf("preview = %+v, want one importable row", preview)
	}
	if len(preview.learners) != 1 {
		t.Fatalf("parsed learners = %d, want 1", len(preview.learners))
	}
	got := preview.learners[0]
	if got.FirstName != "Grace" || got.LastName != "Kamau" || got.GradeLabel != "PP2" {
		t.Fatalf("parsed row = %+v, want Grace Kamau PP2", got)
	}
}
