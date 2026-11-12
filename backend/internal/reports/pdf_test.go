package reports

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"time"
)

func sampleCard() ReportCardPDF {
	return ReportCardPDF{
		SchoolName:   "Alliance Primary School",
		LearnerName:  "Wanjiku (Otieno) Kamau",
		AdmissionNo:  "ADM-001",
		GradeLabel:   "Grade 5",
		TermLabel:    "Term 1",
		YearLabel:    "2026",
		OverallGrade: "B+",
		TotalScore:   642,
		MaxScore:     800,
		Percentage:   80.25,
		Position:     4,
		ClassComment: "Steady improvement in mathematics.",
		HeadComment:  "Keep up the good work.",
		Status:       "PUBLISHED",
		GeneratedAt:  time.Date(2026, 11, 12, 9, 30, 0, 0, time.UTC),
	}
}

func TestRenderProducesValidPDFEnvelope(t *testing.T) {
	pdf := sampleCard().Render()

	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("missing PDF header: %q", pdf[:8])
	}
	if !bytes.HasSuffix(pdf, []byte("%%EOF\n")) {
		t.Fatal("missing EOF marker")
	}
	for _, marker := range []string{"/Type /Catalog", "/Type /Page", "startxref", "trailer"} {
		if !bytes.Contains(pdf, []byte(marker)) {
			t.Errorf("missing %s", marker)
		}
	}

	// startxref must point at the xref table, and every offset in the table
	// must land on an "N 0 obj" header — this catches a broken builder that
	// still looks like a PDF to a text scan.
	text := string(pdf)
	idx := strings.LastIndex(text, "startxref")
	var xrefOffset int
	if _, err := fmt.Sscanf(text[idx:], "startxref\n%d", &xrefOffset); err != nil {
		t.Fatalf("startxref: %v", err)
	}
	if !strings.HasPrefix(text[xrefOffset:], "xref") {
		t.Fatalf("startxref points at %q", text[xrefOffset:xrefOffset+8])
	}
}

func TestRenderEscapesUnsafeText(t *testing.T) {
	card := sampleCard()
	card.LearnerName = "A (B) \\ C\nNewline"
	card.SchoolName = "St. Mary's"
	pdf := string(card.Render())

	if strings.Contains(pdf, "(A (B)") {
		t.Error("parenthesis was not escaped")
	}
	if strings.Contains(pdf, "C\nNewline") {
		t.Error("newline leaked into a PDF string")
	}
}

func TestRenderHandlesEmptyCard(t *testing.T) {
	pdf := ReportCardPDF{GeneratedAt: time.Now()}.Render()
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) || !bytes.Contains(pdf, []byte("/Type /Page")) {
		t.Fatal("empty card did not render a document")
	}
	if bytes.Contains(pdf, []byte("/Length 0")) {
		t.Fatal("content stream is empty")
	}
}

func TestPositionText(t *testing.T) {
	if got := positionText(0); got != "—" {
		t.Errorf("position 0 = %q", got)
	}
	if got := positionText(3); got != "3" {
		t.Errorf("position 3 = %q", got)
	}
}
