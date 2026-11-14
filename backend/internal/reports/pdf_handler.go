package reports

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// GetReportCardPDF streams a printable report card. The print page in the SPA
// is a review surface; this endpoint is what a school hands to a parent, so it
// is generated server-side from the stored card and cannot be edited in the
// browser before saving.
func indicatorWindow(window string) string {
	if strings.TrimSpace(window) == "" {
		return ""
	}
	return " (" + window + ")"
}

func (h *Handler) GetReportCardPDF(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	cardID := c.Param("card_id")
	if cardID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "BAD_REQUEST", "message": "card_id is required"})
		return
	}

	var card ReportCard
	var admission, gradeLabel, schoolName, termLabel, yearLabel string
	err := tx.QueryRow(
		`SELECT rc.card_id, rc.tenant_id, rc.run_id, rc.learner_id,
			TRIM(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')) AS learner_name,
			rc.card_number, rc.academic_year_id, rc.term_id, rc.grade_id,
			rc.overall_grade, rc.total_score, rc.max_score, rc.percentage, rc.position,
			rc.comment, rc.head_teacher_comment, rc.status, rc.pdf_ref, rc.published_at,
			rc.published_by, rc.created_by, rc.created_at, rc.updated_at,
			COALESCE(l.admission_number,''),
			COALESCE(g.grade_label, rc.grade_id),
			COALESCE(s.school_name,''),
			COALESCE(t.term_label,''),
			COALESCE(ay.year_label,'')
		 FROM report_cards rc
		 LEFT JOIN learners l ON l.learner_id = rc.learner_id AND l.tenant_id = rc.tenant_id
		 LEFT JOIN grades g ON g.grade_id = rc.grade_id
		 LEFT JOIN academic_years ay ON ay.year_id = rc.academic_year_id AND ay.tenant_id = rc.tenant_id
		 LEFT JOIN terms t ON t.term_id = rc.term_id AND t.tenant_id = rc.tenant_id
		 LEFT JOIN schools s ON s.tenant_id = rc.tenant_id
		 WHERE rc.tenant_id = $1 AND rc.card_id = $2`,
		tenantID, cardID,
	).Scan(&card.CardID, &card.TenantID, &card.RunID, &card.LearnerID, &card.LearnerName,
		&card.CardNumber, &card.AcademicYearID, &card.TermID, &card.GradeID,
		&card.OverallGrade, &card.TotalScore, &card.MaxScore, &card.Percentage,
		&card.Position, &card.Comment, &card.HeadTeacherComment, &card.Status,
		&card.PDFRef, &card.PublishedAt, &card.PublishedBy, &card.CreatedBy,
		&card.CreatedAt, &card.UpdatedAt,
		&admission, &gradeLabel, &schoolName, &termLabel, &yearLabel)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
		return
	}

	// Parents/guardians may only download cards of learners linked to them.
	roles, _ := c.Get(middleware.ContextRoles)
	if roleList, ok := roles.([]string); ok {
		for _, r := range roleList {
			if r != middleware.RoleParent && r != middleware.RoleGuardian {
				continue
			}
			linked, linkErr := h.linkedLearnerIDs(tx, c.GetString("user_id"))
			if linkErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to load linked learners"})
				return
			}
			if !linked[card.LearnerID] {
				c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Report card not found"})
				return
			}
			h.logReportAudit(c, "REPORT_CARD_PDF_DOWNLOAD", "report_card", card.CardID,
				map[string]any{"learner_id": card.LearnerID})
			break
		}
	}

	document := ReportCardPDF{
		SchoolName:   schoolName,
		LearnerName:  strings.TrimSpace(card.LearnerName),
		AdmissionNo:  admission,
		GradeLabel:   gradeLabel,
		TermLabel:    termLabel,
		YearLabel:    yearLabel,
		OverallGrade: card.OverallGrade,
		TotalScore:   card.TotalScore,
		MaxScore:     card.MaxScore,
		Percentage:   card.Percentage,
		Position:     card.Position,
		ClassComment: card.Comment,
		HeadComment:  card.HeadTeacherComment,
		Status:       card.Status,
		GeneratedAt:  time.Now(),
	}

	// Attach the real CBC indicator rows from the card results so the printed
	// card shows the actual learning-area performance rather than an empty
	// summary block.
	if card.Results != nil {
		for _, r := range card.Results {
			document.Indicators = append(document.Indicators, ReportCardResultPDF{
				LearningAreaName: r.LearningAreaName,
				AssessmentType:   fmt.Sprintf("%s%s", r.AssessmentType, indicatorWindow(r.AssessmentWindow)),
				Score:            scoreText(r.RawScore, r.MaxScore),
				LevelCode:        r.LevelCode,
				Comment:          r.Comment,
			})
		}
	}

	name := strings.TrimSpace(card.CardNumber)
	if name == "" {
		name = card.CardID
	}
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", "report-card-"+name+".pdf"))
	c.Header("Cache-Control", "private, no-store")
	c.Data(http.StatusOK, "application/pdf", document.Render())
}
