package knec

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/grading"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// NationalResult is an official KNEC band as imported by the school. It is
// intentionally band-only: there is no percentage, total, mean or position to
// leak into the school report card.
type NationalResult struct {
	ResultID       string `json:"result_id"`
	LearnerID      string `json:"learner_id"`
	LearnerName    string `json:"learner_name,omitempty"`
	AdmissionNo    string `json:"admission_number,omitempty"`
	AssessmentType string `json:"assessment_type"`
	AssessmentYear int    `json:"assessment_year"`
	LearningAreaID string `json:"learning_area_id,omitempty"`
	SubjectName    string `json:"subject_name,omitempty"`
	SubjectCode    string `json:"subject_code,omitempty"`
	RawBand        string `json:"raw_band"`
	Band           string `json:"band"`
	Descriptor     string `json:"descriptor"`
	Points         int    `json:"points,omitempty"`
	Revision       int    `json:"revision"`
	Source         string `json:"source"`
	ImportedAt     string `json:"imported_at"`
}

// ListNationalResults returns imported official results. Superseded revisions
// are hidden; the current revision is what a report card prints.
func (h *Handler) ListNationalResults(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	learnerID := strings.TrimSpace(c.Query("learner_id"))
	assessmentType := strings.ToUpper(strings.TrimSpace(c.Query("assessment_type")))
	year := strings.TrimSpace(c.Query("year"))

	query := `
		SELECT n.result_id::text, n.learner_id::text,
		       TRIM(COALESCE(l.first_name,'') || ' ' || COALESCE(l.last_name,'')),
		       COALESCE(l.admission_number, ''),
		       n.assessment_type, n.assessment_year,
		       COALESCE(n.learning_area_id::text, ''), COALESCE(la.name, ''),
		       COALESCE(n.subject_code, ''), n.raw_band, COALESCE(n.points, 0),
		       n.revision, n.source, n.imported_at::text
		FROM national_assessment_results n
		JOIN learners l ON l.learner_id = n.learner_id AND l.tenant_id = n.tenant_id
		LEFT JOIN learning_areas la ON la.area_id = n.learning_area_id
		WHERE n.tenant_id = $1 AND n.superseded_by IS NULL`
	args := []interface{}{tenantID}
	argIndex := 2
	if learnerID != "" {
		query += " AND n.learner_id = $2"
		args = append(args, learnerID)
		argIndex = 3
	}
	if assessmentType != "" {
		query += " AND n.assessment_type = $" + itoa(argIndex)
		args = append(args, assessmentType)
		argIndex++
	}
	if year != "" {
		query += " AND n.assessment_year = $" + itoa(argIndex)
		args = append(args, year)
		argIndex++
	}
	query += " ORDER BY n.assessment_year DESC, l.last_name, l.first_name, la.sort_order"

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	results := make([]NationalResult, 0)
	for rows.Next() {
		var r NationalResult
		if err := rows.Scan(&r.ResultID, &r.LearnerID, &r.LearnerName, &r.AdmissionNo,
			&r.AssessmentType, &r.AssessmentYear, &r.LearningAreaID, &r.SubjectName,
			&r.SubjectCode, &r.RawBand, &r.Points, &r.Revision, &r.Source, &r.ImportedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		r.RawBand = grading.NormalizeCode(r.RawBand)
		r.Band = grading.BandOf(r.RawBand)
		r.Descriptor = grading.DescriptorFor(r.RawBand)
		results = append(results, r)
	}
	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, results)
}

type nationalImportItem struct {
	LearnerID       string `json:"learner_id"`
	AdmissionNumber string `json:"admission_number"`
	LearningAreaID  string `json:"learning_area_id"`
	SubjectCode     string `json:"subject_code"`
	RawBand         string `json:"raw_band" binding:"required"`
}

type nationalImportRequest struct {
	AssessmentType string              `json:"assessment_type" binding:"required"`
	AssessmentYear int                 `json:"assessment_year" binding:"required"`
	Results        []nationalImportItem `json:"results" binding:"required"`
}

// ImportNationalResults appends official KNEC bands. Re-importing a changed
// band creates revision N+1 and supersedes the previous row; nothing is
// overwritten and nothing can be deleted. The import enforces the scale for
// the assessment type: KPSEA/Grade 3 are 4-band, KJSEA is 8-point.
func (h *Handler) ImportNationalResults(c *gin.Context) {
	var req nationalImportRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	assessmentType := strings.ToUpper(strings.TrimSpace(req.AssessmentType))
	if assessmentType == "" {
		assessmentType = "KPSEA"
	}
	if !validNationalType(assessmentType) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "assessment_type", Code: "INVALID_VALUE", Message: "must be KPSEA, KJSEA or GRADE3"},
		})
		return
	}
	if req.AssessmentYear < 2000 || req.AssessmentYear > 2100 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "assessment_year", Code: "INVALID_VALUE", Message: "must be a four-digit year"},
		})
		return
	}
	if len(req.Results) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "results", Code: "REQUIRED", Message: "at least one result is required"},
		})
		return
	}

	expectedScale := grading.ScaleForAssessmentType(assessmentType)
	imported, skipped := 0, 0
	revisions := make([]gin.H, 0)

	for index, item := range req.Results {
		learnerID, err := resolveLearner(tx, tenantID, item.LearnerID, item.AdmissionNumber)
		if err != nil {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "results", Code: "INVALID_LEARNER",
					Message: "row " + itoa(index+1) + ": learner not found in this school"},
			})
			return
		}
		rawBand := grading.NormalizeCode(item.RawBand)
		if !grading.IsKnownLevel(rawBand) {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "results", Code: "INVALID_BAND",
					Message: "row " + itoa(index+1) + ": raw_band must be EE/ME/AE/BE or EE1-BE2"},
			})
			return
		}
		if !bandMatchesScale(rawBand, expectedScale) {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "results", Code: "WRONG_SCALE",
					Message: "row " + itoa(index+1) + ": " + assessmentType + " uses the " + scaleLabel(expectedScale) + " scale"},
			})
			return
		}

		subjectCode := strings.TrimSpace(item.SubjectCode)
		var areaID interface{}
		if strings.TrimSpace(item.LearningAreaID) != "" {
			areaID = item.LearningAreaID
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM learning_areas WHERE area_id = $1)`,
				item.LearningAreaID).Scan(&exists); err != nil || !exists {
				validation.BadRequest(c, "Invalid request", []validation.FieldError{
					{Field: "results", Code: "INVALID_AREA",
						Message: "row " + itoa(index+1) + ": learning_area_id does not exist"},
				})
				return
			}
		}
		// If only a subject code was supplied, resolve it to a learning area
		// so the card prints the human-readable subject name.
		if areaID == nil && subjectCode != "" {
			var resolved string
			if err := tx.QueryRow(
				`SELECT area_id::text FROM learning_areas
				 WHERE UPPER(code) = UPPER($1) LIMIT 1`, subjectCode).Scan(&resolved); err == nil {
				areaID = resolved
			}
		}

		var points interface{}
		if expectedScale == grading.ScaleEightPoint {
			if p, ok := grading.PointsFor(rawBand); ok {
				points = p
			}
		}

		// Find the current (non-superseded) result for the same key.
		var oldID string
		var oldRevision int
		var oldBand string
		err = tx.QueryRow(
			`SELECT result_id::text, revision, raw_band
			 FROM national_assessment_results
			 WHERE tenant_id = $1 AND learner_id = $2 AND assessment_type = $3
			   AND assessment_year = $4
			   AND COALESCE(learning_area_id::text, '') = COALESCE($5::text, '')
			   AND COALESCE(subject_code, '') = $6
			   AND superseded_by IS NULL
			 ORDER BY revision DESC LIMIT 1`,
			tenantID, learnerID, assessmentType, req.AssessmentYear, areaID, subjectCode,
		).Scan(&oldID, &oldRevision, &oldBand)
		if err != nil && err != sql.ErrNoRows {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if err == nil && grading.NormalizeCode(oldBand) == rawBand {
			skipped++
			continue
		}

		revision := 1
		if oldID != "" {
			revision = oldRevision + 1
		}
		var newID string
		err = tx.QueryRow(
			`INSERT INTO national_assessment_results
			 (tenant_id, learner_id, assessment_type, assessment_year, learning_area_id,
			  subject_code, raw_band, points, source, revision, imported_by, locked_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'KNEC_IMPORT', $9, NULLIF($10, '')::uuid, now())
			 RETURNING result_id::text`,
			tenantID, learnerID, assessmentType, req.AssessmentYear, areaID,
			nullableString(subjectCode), rawBand, points, revision, userID,
		).Scan(&newID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if oldID != "" {
			if _, err := tx.Exec(
				`UPDATE national_assessment_results SET superseded_by = $1 WHERE result_id = $2`,
				newID, oldID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
		}
		imported++
		revisions = append(revisions, gin.H{
			"learner_id": learnerID,
			"result_id":  newID,
			"raw_band":   rawBand,
			"revision":   revision,
		})
	}

	h.logKNECAudit(c, "KNEC_RESULTS_IMPORT", map[string]any{
		"assessment_type": assessmentType,
		"assessment_year": req.AssessmentYear,
		"imported":        imported,
		"skipped":         skipped,
	})
	c.JSON(http.StatusOK, gin.H{
		"assessment_type": assessmentType,
		"assessment_year": req.AssessmentYear,
		"imported":        imported,
		"skipped":         skipped,
		"revisions":       revisions,
	})
}

func (h *Handler) logKNECAudit(c *gin.Context, action string, meta map[string]any) {
	audit.TenantAction(middleware.TxFromGin(c), c, action, "national_assessment_results", "", meta)
}

func validNationalType(value string) bool {
	switch value {
	case "KPSEA", "KJSEA", "GRADE3":
		return true
	}
	return false
}

func bandMatchesScale(band string, scale grading.Scale) bool {
	isSubLevel := len(band) == 3
	if scale == grading.ScaleEightPoint {
		return isSubLevel
	}
	return !isSubLevel
}

func scaleLabel(scale grading.Scale) string {
	if scale == grading.ScaleEightPoint {
		return "8-point"
	}
	return "4-band"
}

func resolveLearner(tx *sqlx.Tx, tenantID, learnerID, admissionNumber string) (string, error) {
	if strings.TrimSpace(learnerID) != "" {
		var id string
		err := tx.QueryRow(
			`SELECT learner_id::text FROM learners WHERE tenant_id = $1 AND learner_id = $2`,
			tenantID, learnerID).Scan(&id)
		return id, err
	}
	var id string
	err := tx.QueryRow(
		`SELECT learner_id::text FROM learners
		 WHERE tenant_id = $1 AND admission_number = $2 LIMIT 1`,
		tenantID, strings.TrimSpace(admissionNumber)).Scan(&id)
	return id, err
}

func nullableString(value string) interface{} {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
