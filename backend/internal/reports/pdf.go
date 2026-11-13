package reports

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
	"time"
)

// ReportCardPDF is the printable model of a published report card. It is kept
// separate from the API DTO so the renderer stays pure and unit-testable.
type ReportCardResultPDF struct {
	LearningAreaName string
	AssessmentType   string
	Score           string
	LevelCode       string
	Comment         string
}

type ReportCardPDF struct {
	SchoolName    string
	SchoolAddress string
	SchoolMotto   string
	LearnerName   string
	AdmissionNo   string
	GradeLabel    string
	TermLabel     string
	YearLabel     string
	OverallGrade  string
	TotalScore    float64
	MaxScore      float64
	Percentage    float64
	Position      int
	ClassComment  string
	HeadComment   string
	Status        string
	GeneratedAt   time.Time
	Indicators    []ReportCardResultPDF
}

// Render builds a single-page A4 PDF using only the standard library: the
// production image is distroless static with no font files or PDF toolchain,
// so embedding a dependency (or an external binary) would add weight and
// failure modes for a document made of text and rules.
func (r ReportCardPDF) Render() []byte {
	content := r.contentStream()

	pdf := &pdfWriter{}
	pdf.object("<< /Type /Catalog /Pages 2 0 R >>")
	pdf.object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	pdf.object("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
		"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>")
	pdf.streamObject(content)
	pdf.object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	pdf.object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
	pdf.object(fmt.Sprintf("<< /Title (%s) /Producer (Shule Yetu) /CreationDate (D:%s) >>",
		pdfEscape(r.LearnerName+" report card"), r.GeneratedAt.Format("20060102150405")))
	return pdf.bytes()
}

// contentStream lays the document out top-down in PDF user units (1pt).
func (r ReportCardPDF) contentStream() string {
	var b strings.Builder
	y := 800.0
	write := func(font string, size float64, text string) {
		b.WriteString(fmt.Sprintf("BT /%s %.1f Tf %.1f %.1f Td (%s) Tj ET\n",
			font, size, 56.0, y, pdfEscape(text)))
		y -= size + 8
	}
	rule := func() {
		b.WriteString(fmt.Sprintf("0.6 w 56 %.1f m 539 %.1f l S\n", y+4, y+4))
		y -= 16
	}

	write("F2", 16, orDefault(r.SchoolName, "School"))
	if r.SchoolAddress != "" {
		write("F1", 9, r.SchoolAddress)
	}
	if r.SchoolMotto != "" {
		write("F1", 9, r.SchoolMotto)
	}
	y -= 4
	rule()
	write("F2", 13, "LEARNER REPORT CARD")
	y -= 4

	term := strings.TrimSpace(strings.Join(nonEmpty(r.TermLabel, r.YearLabel), " · "))
	if term != "" {
		write("F1", 10, term)
	}
	rule()

	write("F2", 11, orDefault(r.LearnerName, "Learner"))
	write("F1", 10, "Admission No: "+orDefault(r.AdmissionNo, "—")+"     Grade: "+orDefault(r.GradeLabel, "—"))
	y -= 6

	rows := [][2]string{
		{"Overall grade", orDefault(r.OverallGrade, "—")},
		{"Total score", scoreText(r.TotalScore, r.MaxScore)},
		{"Percentage", fmt.Sprintf("%.1f%%", r.Percentage)},
		{"Position in class", positionText(r.Position)},
		{"Status", orDefault(r.Status, "—")},
	}
	for _, row := range rows {
		b.WriteString(fmt.Sprintf("BT /F1 10 Tf 56 %.1f Td (%s) Tj ET\n", y, pdfEscape(row[0])))
		b.WriteString(fmt.Sprintf("BT /F2 10 Tf 220 %.1f Td (%s) Tj ET\n", y, pdfEscape(row[1])))
		y -= 18
	}
	y -= 6
	rule()

	if len(r.Indicators) > 0 {
		write("F2", 10, "Learning area performance")
		y -= 4
		for _, ind := range r.Indicators {
			b.WriteString(fmt.Sprintf("BT /F1 9 Tf 56 %.1f Td (%s) Tj ET\n", y, pdfEscape(ind.LearningAreaName)))
			b.WriteString(fmt.Sprintf("BT /F1 9 Tf 220 %.1f Td (%s) Tj ET\n", y, pdfEscape(ind.AssessmentType)))
			b.WriteString(fmt.Sprintf("BT /F2 9 Tf 290 %.1f Td (%s) Tj ET\n", y, pdfEscape(ind.Score)))
			b.WriteString(fmt.Sprintf("BT /F1 9 Tf 350 %.1f Td (%s) Tj ET\n", y, pdfEscape(ind.LevelCode)))
			y -= 14
		}
		y -= 6
		rule()
	}

	write("F2", 10, "Class teacher's remark")
	write("F1", 10, orDefault(r.ClassComment, "—"))
	y -= 4
	write("F2", 10, "Head teacher's remark")
	write("F1", 10, orDefault(r.HeadComment, "—"))

	y = 120
	rule()
	write("F1", 8, "Generated "+r.GeneratedAt.Format("2 January 2006 15:04")+
		" · This document is issued by "+orDefault(r.SchoolName, "the school")+".")
	write("F1", 8, "Signature ______________________            School stamp ______________________")
	return b.String()
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			out = append(out, v)
		}
	}
	return out
}

func orDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func scoreText(total, max float64) string {
	if total == 0 && max == 0 {
		return "—"
	}
	return fmt.Sprintf("%.1f / %.1f", total, max)
}

func positionText(position int) string {
	if position <= 0 {
		return "—"
	}
	return fmt.Sprintf("%d", position)
}

// pdfEscape protects the PDF string syntax: brackets and backslashes end a
// literal string, and control characters are not valid in the default font.
func pdfEscape(text string) string {
	var b strings.Builder
	for _, r := range text {
		switch r {
		case '(', ')', '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n', '\r':
			b.WriteByte(' ')
		default:
			if r < 32 {
				b.WriteByte(' ')
				continue
			}
			b.WriteRune(r)
		}
	}
	return b.String()
}

type pdfWriter struct {
	buf     bytes.Buffer
	offsets []int
}

func (w *pdfWriter) object(body string) {
	w.offsets = append(w.offsets, w.buf.Len())
	w.buf.WriteString(fmt.Sprintf("%d 0 obj\n%s\nendobj\n", len(w.offsets), body))
}

func (w *pdfWriter) streamObject(content string) {
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write([]byte(content))
	_ = zw.Close()

	w.offsets = append(w.offsets, w.buf.Len())
	w.buf.WriteString(fmt.Sprintf("%d 0 obj\n<< /Length %d /Filter /FlateDecode >>\nstream\n",
		len(w.offsets), compressed.Len()))
	w.buf.Write(compressed.Bytes())
	w.buf.WriteString("\nendstream\nendobj\n")
}

func (w *pdfWriter) bytes() []byte {
	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n")
	out.Write(w.buf.Bytes())

	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n", len(w.offsets)+1)
	out.WriteString("0000000000 65535 f \n")
	for _, offset := range w.offsets {
		fmt.Fprintf(&out, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n",
		len(w.offsets)+1, len(w.offsets), xref)
	return out.Bytes()
}
