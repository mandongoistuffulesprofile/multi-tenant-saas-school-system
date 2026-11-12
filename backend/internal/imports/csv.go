// Package imports implements the learner CSV import. It parses and classifies
// the file first, so an operator can preview exactly what a dry run would do
// before any learner or enrolment row is written.
package imports

import (
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/audit"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Row statuses. A row is either importable, a duplicate of a learner that
// already exists (or appears earlier in the file), or invalid.
const (
	StatusImportable = "IMPORTABLE"
	StatusDuplicate  = "DUPLICATE"
	StatusInvalid    = "INVALID"
)

// LearnerRow is one parsed CSV record.
type LearnerRow struct {
	Line            int
	AdmissionNumber string
	FirstName       string
	MiddleName      string
	LastName        string
	GradeLabel      string
	StreamName      string
	GuardianPhone   string
}

// RowResult reports what the preview decided for one row.
type RowResult struct {
	Line            int      `json:"line"`
	AdmissionNumber string   `json:"admission_number"`
	Status          string   `json:"status"`
	Reasons         []string `json:"reasons,omitempty"`
}

// Preview is the dry-run summary. Duplicates and invalid rows are counted
// separately: a duplicate is a row the import will not create because the
// learner already exists, whereas an invalid row has to be corrected first.
type Preview struct {
	TotalRows  int         `json:"total_rows"`
	Importable int         `json:"importable"`
	Duplicates int         `json:"duplicates"`
	Invalid    int         `json:"invalid"`
	Rows       []RowResult `json:"rows"`
	// learners carries the parsed IMPORTABLE records so the apply step uses
	// exactly the rows the preview classified.
	learners []LearnerRow
}

// Header names accepted in the first CSV record. Any order is fine.
var headerAliases = map[string]string{
	"admission_number": "admission_number",
	"admission_no":     "admission_number",
	"adm_no":           "admission_number",
	"first_name":       "first_name",
	"middle_name":      "middle_name",
	"last_name":        "last_name",
	"surname":          "last_name",
	"grade_label":      "grade_label",
	"grade":            "grade_label",
	"stream_name":      "stream_name",
	"stream":           "stream_name",
	"guardian_phone":   "guardian_phone",
	"phone":            "guardian_phone",
}

const (
	colAdmission = iota
	colFirstName
	colMiddleName
	colLastName
	colGrade
	colStream
	colGuardian
	columnCount
)

// PreviewCSV parses the file and classifies every data row.
//
// existingAdmissions holds upper-cased admission numbers already stored for
// the tenant; knownGrades maps lower-cased grade labels to grade IDs.
//
// Duplicate detection runs before field validation because a duplicate is the
// more specific answer: the operator does not need to fix a row that will not
// be inserted at all.
func PreviewCSV(text string, existingAdmissions map[string]bool, knownGrades map[string]string) (Preview, error) {
	reader := csv.NewReader(strings.NewReader(text))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true

	records := make([][]string, 0, 64)
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return Preview{}, fmt.Errorf("parse CSV: %w", err)
		}
		records = append(records, record)
	}
	if len(records) == 0 {
		return Preview{}, errors.New("CSV is empty")
	}

	index := map[string]int{
		"admission_number": colAdmission,
		"first_name":       colFirstName,
		"middle_name":      colMiddleName,
		"last_name":        colLastName,
		"grade_label":      colGrade,
		"stream_name":      colStream,
		"guardian_phone":   colGuardian,
	}
	first := records[0]
	if looksLikeHeader(first) {
		index = headerIndex(first)
		records = records[1:]
	}

	preview := Preview{Rows: make([]RowResult, 0, len(records))}
	seen := map[string]bool{}

	for i, record := range records {
		line := i + 2 // data starts on line 2 when a header is present
		row := LearnerRow{Line: line}
		cell := func(name string) string {
			if pos, ok := index[name]; ok && pos >= 0 && pos < len(record) {
				return strings.TrimSpace(record[pos])
			}
			return ""
		}
		row.AdmissionNumber = cell("admission_number")
		row.FirstName = cell("first_name")
		row.MiddleName = cell("middle_name")
		row.LastName = cell("last_name")
		row.GradeLabel = cell("grade_label")
		row.StreamName = cell("stream_name")
		row.GuardianPhone = cell("guardian_phone")

		// A completely blank line is not a learner and not an error.
		if isEmptyRow(row) {
			continue
		}

		preview.TotalRows++
		key := strings.ToUpper(row.AdmissionNumber)
		result := RowResult{Line: line, AdmissionNumber: row.AdmissionNumber}

		switch {
		case key != "" && (existingAdmissions[key] || seen[key]):
			result.Status = StatusDuplicate
			result.Reasons = []string{"admission number already exists for this school"}
			preview.Duplicates++
		default:
			reasons := validateRow(row, knownGrades)
			if len(reasons) > 0 {
				result.Status = StatusInvalid
				result.Reasons = reasons
				preview.Invalid++
			} else {
				result.Status = StatusImportable
				preview.Importable++
				preview.learners = append(preview.learners, row)
			}
			if key != "" {
				seen[key] = true
			}
		}
		preview.Rows = append(preview.Rows, result)
	}
	return preview, nil
}

func looksLikeHeader(record []string) bool {
	for _, raw := range record {
		normalized := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff")))
		if _, ok := headerAliases[normalized]; ok {
			return true
		}
	}
	return false
}

func headerIndex(record []string) map[string]int {
	index := map[string]int{}
	for pos, raw := range record {
		normalized := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(raw, "\ufeff")))
		if name, ok := headerAliases[normalized]; ok {
			index[name] = pos
		}
	}
	return index
}

func isEmptyRow(row LearnerRow) bool {
	return row.AdmissionNumber == "" && row.FirstName == "" && row.MiddleName == "" &&
		row.LastName == "" && row.GradeLabel == "" && row.StreamName == "" && row.GuardianPhone == ""
}

func validateRow(row LearnerRow, knownGrades map[string]string) []string {
	reasons := []string{}
	if row.AdmissionNumber == "" {
		reasons = append(reasons, "admission_number is required")
	}
	if row.FirstName == "" {
		reasons = append(reasons, "first_name is required")
	}
	if row.LastName == "" {
		reasons = append(reasons, "last_name is required")
	}
	if row.GradeLabel == "" {
		reasons = append(reasons, "grade_label is required")
	} else if _, ok := knownGrades[strings.ToLower(row.GradeLabel)]; !ok {
		reasons = append(reasons, fmt.Sprintf("unknown grade_label %q", row.GradeLabel))
	}
	return reasons
}

// ImportLearners previews or applies a learner CSV.
//
//	POST /imports/learners  {"csv": "...", "dry_run": true}
//
// Applying inserts only IMPORTABLE rows; duplicates and invalid rows are
// reported back with their reasons and never silently overwritten.
func (h *Handler) ImportLearners(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var req struct {
		CSV    string `json:"csv" binding:"required"`
		DryRun bool   `json:"dry_run"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")

	existing, err := existingAdmissions(tx, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	grades, err := knownGrades(tx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	preview, err := PreviewCSV(req.CSV, existing, grades)
	if err != nil {
		validation.BadRequest(c, "Invalid CSV", []validation.FieldError{
			{Field: "csv", Code: "INVALID_VALUE", Message: err.Error()},
		})
		return
	}

	status := http.StatusOK
	payload := gin.H{"dry_run": true, "preview": preview}
	if !req.DryRun {
		created, err := applyImport(tx, tenantID, preview, grades)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		// One audit event per applied import, in the same transaction as the
		// inserts, so the batch and its outcome are attributable.
		audit.TenantAction(tx, c, "LEARNER_IMPORT_APPLIED", "learners", "",
			ImportAuditDetails(preview, created))
		status = http.StatusCreated
		payload = gin.H{"dry_run": false, "created": created, "preview": preview}
	}
	c.JSON(status, payload)
}

func existingAdmissions(tx *sqlx.Tx, tenantID string) (map[string]bool, error) {
	rows, err := tx.Query(`SELECT admission_number FROM learners WHERE tenant_id = $1`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var admission string
		if err := rows.Scan(&admission); err != nil {
			return nil, err
		}
		out[strings.ToUpper(strings.TrimSpace(admission))] = true
	}
	return out, rows.Err()
}

func knownGrades(tx *sqlx.Tx) (map[string]string, error) {
	rows, err := tx.Query(`SELECT lower(grade_label), grade_id FROM grades`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var label, id string
		if err := rows.Scan(&label, &id); err != nil {
			return nil, err
		}
		out[label] = id
	}
	return out, rows.Err()
}

// ImportAuditDetails is the audit payload for an applied learner import. It
// records what was created and what was skipped, without learner names.
func ImportAuditDetails(preview Preview, created int) map[string]any {
	return map[string]any{
		"rows_created": created,
		"total_rows":   preview.TotalRows,
		"duplicates":   preview.Duplicates,
		"invalid":      preview.Invalid,
	}
}

// applyImport inserts the importable rows and enrols each learner into the
// current academic year's matching class group when one exists. A learner with
// no matching class group is still created; the import screen reports how many
// enrolments were created so the operator can place them afterwards.
func applyImport(tx *sqlx.Tx, tenantID string, preview Preview, grades map[string]string) (int, error) {
	currentYearID := ""
	if err := tx.QueryRow(
		`SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current LIMIT 1`, tenantID,
	).Scan(&currentYearID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}

	created := 0
	for _, row := range preview.learners {
		var learnerID string
		err := tx.QueryRow(
			`INSERT INTO learners (tenant_id, admission_number, first_name, middle_name, last_name,
			                       status, admitted_on, boarding_type)
			 VALUES ($1, $2, $3, NULLIF($4, ''), $5, 'ACTIVE', CURRENT_DATE, 'DAY')
			 ON CONFLICT (tenant_id, admission_number) DO NOTHING
			 RETURNING learner_id`,
			tenantID, row.AdmissionNumber, row.FirstName, row.MiddleName, row.LastName,
		).Scan(&learnerID)
		if errors.Is(err, sql.ErrNoRows) {
			// Between preview and apply another session inserted the same
			// admission number; leave that learner untouched.
			continue
		}
		if err != nil {
			return created, err
		}
		created++

		if currentYearID == "" {
			continue
		}
		gradeID := grades[strings.ToLower(row.GradeLabel)]
		classGroupID, err := findClassGroup(tx, tenantID, currentYearID, gradeID, row.StreamName)
		if err != nil {
			return created, err
		}
		if classGroupID == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT INTO enrolments (tenant_id, learner_id, class_group_id, year_id, status, started_on)
			 VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_DATE)`,
			tenantID, learnerID, classGroupID, currentYearID,
		); err != nil {
			return created, err
		}
	}
	return created, nil
}

// findClassGroup matches the grade and, when the CSV names one, the stream.
// An empty result means the school has not created that class yet; the learner
// is still imported and can be placed from the learners directory.
func findClassGroup(tx *sqlx.Tx, tenantID, yearID, gradeID, streamName string) (string, error) {
	if gradeID == "" {
		return "", nil
	}
	query := `SELECT cg.class_group_id
		 FROM class_groups cg
		 WHERE cg.tenant_id = $1 AND cg.year_id = $2 AND cg.grade_id = $3`
	args := []interface{}{tenantID, yearID, gradeID}
	if streamName != "" {
		query += ` AND cg.stream_id IN (
			SELECT s.stream_id FROM streams s
			WHERE s.tenant_id = $1 AND lower(s.stream_name) = lower($4))`
		args = append(args, streamName)
	}
	query += ` LIMIT 1`
	var classGroupID string
	err := tx.QueryRow(query, args...).Scan(&classGroupID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return classGroupID, err
}
