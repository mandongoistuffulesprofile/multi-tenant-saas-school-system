package reports

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"strings"
	"time"
)

// ReportCardPDF is the printable model of a report card. It is kept separate
// from the API DTO so the renderer stays pure and unit-testable.
//
// Learning-area rows come from the frozen snapshot of a published card (or the
// live rows of a draft). National KNEC results are rendered on their own page,
// inside a border, and never contribute a percentage, total or rank.
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
	Results       []ReportCardResult
	National      []SnapshotNational
	ShowAggregate bool
	ShowPosition  bool
	ScaleLabel    string
}

// Render builds an A4 PDF using only the standard library: the production
// image is distroless static with no font files or PDF toolchain, so embedding
// a dependency (or an external binary) would add weight and failure modes for
// a document made of text and rules.
//
// A card with national results is two pages: the school report followed by the
// separate KNEC page. A card without them stays a single page.
func (r ReportCardPDF) Render() []byte {
	contents := []string{r.contentStream()}
	if len(r.National) > 0 {
		contents = append(contents, r.nationalContentStream())
	}

	n := len(contents)
	font1 := 3 + 2*n
	font2 := font1 + 1

	kids := make([]string, n)
	for i := range contents {
		kids[i] = fmt.Sprintf("%d 0 R", 3+2*i)
	}

	pdf := &pdfWriter{}
	pdf.object("<< /Type /Catalog /Pages 2 0 R >>")
	pdf.object(fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), n))
	for i, content := range contents {
		pdf.object(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "+
			"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>",
			font1, font2, 4+2*i))
		pdf.streamObject(content)
	}
	pdf.object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	pdf.object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
	pdf.object(fmt.Sprintf("<< /Title (%s) /Producer (Shule Yetu) /CreationDate (D:%s) >>",
		pdfEscape(r.LearnerName+" report card"), r.GeneratedAt.Format("20060102150405")))
	return pdf.bytes()
}

// contentStream lays the school report out top-down in PDF user units (1pt).
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
	y -= 2

	// Learning-area table. Each captured assessment is a row; the learning
	// area is printed once per group so the table stays compact.
	if len(r.Results) > 0 {
		write("F2", 10, "LEARNING AREAS")
		b.WriteString(fmt.Sprintf("BT /F2 8 Tf 56 %.1f Td (Learning area) Tj ET\n", y))
		b.WriteString(fmt.Sprintf("BT /F2 8 Tf 245 %.1f Td (Strand / assessment) Tj ET\n", y))
		b.WriteString(fmt.Sprintf("BT /F2 8 Tf 400 %.1f Td (Level) Tj ET\n", y))
		b.WriteString(fmt.Sprintf("BT /F2 8 Tf 450 %.1f Td (Descriptor) Tj ET\n", y))
		y -= 6
		rule()

		previousArea := ""
		printed := 0
		for _, result := range r.Results {
			if y < 235 || printed >= 22 {
				write("F1", 8, "... continued on the school copy")
				break
			}
			area := result.LearningAreaName
			if area == previousArea {
				area = ""
			}
			previousArea = result.LearningAreaName
			detail := strings.TrimSpace(result.Strand)
			if result.AssessmentType != "" {
				assessment := result.AssessmentType
				if result.AssessmentWindow != "" {
					assessment += " · " + result.AssessmentWindow
				}
				if detail != "" {
					detail += " · "
				}
				detail += assessment
			}
			level := result.LevelCode
			if level == "" {
				level = "—"
			}
			b.WriteString(fmt.Sprintf("BT /F1 8 Tf 56 %.1f Td (%s) Tj ET\n", y, pdfEscape(truncateText(area, 34))))
			b.WriteString(fmt.Sprintf("BT /F1 8 Tf 245 %.1f Td (%s) Tj ET\n", y, pdfEscape(truncateText(detail, 27))))
			b.WriteString(fmt.Sprintf("BT /F2 8 Tf 400 %.1f Td (%s) Tj ET\n", y, pdfEscape(level)))
			b.WriteString(fmt.Sprintf("BT /F1 8 Tf 450 %.1f Td (%s) Tj ET\n", y, pdfEscape(truncateText(result.Descriptor, 23))))
			y -= 13
			printed++
		}
	} else {
		y -= 6
		write("F1", 10, "No assessment results have been captured for this term.")
	}

	y -= 4
	rule()

	// Aggregate/rank are opt-in. Without them the card still reads cleanly:
	// it reports achievement levels, not a mean grade.
	if r.ShowAggregate {
		rows := [][2]string{
			{"Overall grade", orDefault(r.OverallGrade, "—")},
			{"Total score", scoreText(r.TotalScore, r.MaxScore)},
			{"Percentage", fmt.Sprintf("%.1f%%", r.Percentage)},
		}
		for _, row := range rows {
			b.WriteString(fmt.Sprintf("BT /F1 10 Tf 56 %.1f Td (%s) Tj ET\n", y, pdfEscape(row[0])))
			b.WriteString(fmt.Sprintf("BT /F2 10 Tf 220 %.1f Td (%s) Tj ET\n", y, pdfEscape(row[1])))
			y -= 18
		}
	} else {
		write("F1", 9, "Achievement levels only. No total, percentage, mean grade or rank is reported.")
	}
	if r.ShowPosition && r.Position > 0 {
		b.WriteString(fmt.Sprintf("BT /F1 10 Tf 56 %.1f Td (Position in class) Tj ET\n", y))
		b.WriteString(fmt.Sprintf("BT /F2 10 Tf 220 %.1f Td (%s) Tj ET\n", y, positionText(r.Position)))
		y -= 18
	}
	write("F1", 9, "Status: "+orDefault(r.Status, "—"))

	y -= 8
	rule()
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

// nationalContentStream renders the official KNEC page. It is deliberately a
// separate, bordered page and contains raw bands only — never a percentage,
// total, mean or rank.
func (r ReportCardPDF) nationalContentStream() string {
	var b strings.Builder
	// Border around the whole official block.
	b.WriteString("0.9 w 40 60 515 720 re S\n")

	y := 790.0
	write := func(font string, size float64, text string) {
		b.WriteString(fmt.Sprintf("BT /%s %.1f Tf 60 %.1f Td (%s) Tj ET\n",
			font, size, y, pdfEscape(text)))
		y -= size + 8
	}
	rule := func() {
		b.WriteString(fmt.Sprintf("0.6 w 60 %.1f m 535 %.1f l S\n", y+4, y+4))
		y -= 16
	}

	write("F2", 15, "NATIONAL ASSESSMENT RESULTS (KNEC)")
	write("F1", 9, orDefault(r.SchoolName, "School"))
	write("F1", 9, "Learner: "+orDefault(r.LearnerName, "—")+"     Admission No: "+orDefault(r.AdmissionNo, "—"))
	write("F1", 9, "Grade: "+orDefault(r.GradeLabel, "—")+"     Year: "+orDefault(r.YearLabel, "—"))
	y -= 2
	rule()
	write("F1", 8, "Official KNEC bands only. Percentages, totals, means and ranks are not reported.")
	y -= 4

	b.WriteString(fmt.Sprintf("BT /F2 9 Tf 60 %.1f Td (Subject) Tj ET\n", y))
	b.WriteString(fmt.Sprintf("BT /F2 9 Tf 330 %.1f Td (Band) Tj ET\n", y))
	b.WriteString(fmt.Sprintf("BT /F2 9 Tf 400 %.1f Td (Descriptor) Tj ET\n", y))
	y -= 6
	rule()

	for _, result := range r.National {
		if y < 180 {
			write("F1", 8, "... additional national results are listed in the KNEC portal.")
			break
		}
		subject := result.SubjectName
		if strings.TrimSpace(subject) == "" {
			subject = result.SubjectCode
		}
		if result.AssessmentType != "" {
			subject = strings.TrimSpace(subject + " (" + result.AssessmentType + ")")
		}
		b.WriteString(fmt.Sprintf("BT /F1 9 Tf 60 %.1f Td (%s) Tj ET\n", y, pdfEscape(truncateText(subject, 44))))
		b.WriteString(fmt.Sprintf("BT /F2 9 Tf 330 %.1f Td (%s) Tj ET\n", y, pdfEscape(result.RawBand)))
		b.WriteString(fmt.Sprintf("BT /F1 9 Tf 400 %.1f Td (%s) Tj ET\n", y, pdfEscape(truncateText(result.Descriptor, 24))))
		y -= 16
	}

	y -= 10
	rule()
	write("F2", 9, "This page is a copy of official national results and is locked from school comments.")
	write("F1", 8, "Generated "+r.GeneratedAt.Format("2 January 2006 15:04")+
		" · Issued by "+orDefault(r.SchoolName, "the school")+".")
	write("F1", 8, "School stamp ______________________")
	return b.String()
}

func truncateText(text string, max int) string {
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= max {
		return string(runes)
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
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
