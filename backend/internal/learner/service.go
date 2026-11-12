package learner

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
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

// Learner
type Learner struct {
	LearnerID       string `json:"learner_id"`
	TenantID        string `json:"tenant_id"`
	AdmissionNumber string `json:"admission_number"`
	UPINEMISNumber  string `json:"upi_nemis_number"`
	FirstName       string `json:"first_name"`
	MiddleName      string `json:"middle_name"`
	LastName        string `json:"last_name"`
	DateOfBirth     string `json:"date_of_birth"`
	Gender          string `json:"gender"`
	PhotoRef        string `json:"photo_ref"`
	Status          string `json:"status"`
	AdmittedOn      string `json:"admitted_on"`
	BoardingType    string `json:"boarding_type"`
	ClassGroupID    string `json:"class_group_id,omitempty"`
	GradeLabel      string `json:"grade_label,omitempty"`
	StreamName      string `json:"stream_name,omitempty"`
	GuardianPhone   string `json:"guardian_phone,omitempty"`
}

// scanLearner reads a learner row, tolerating NULLs in optional columns.
func scanLearner(rows interface{ Scan(...interface{}) error }, l *Learner,
	classGroupID, gradeLabel, streamName, guardianPhone *sql.NullString,
) error {
	var upi, middle, dob, gender, photo, status, admittedOn, boarding sql.NullString

	if err := rows.Scan(
		&l.LearnerID, &l.TenantID, &l.AdmissionNumber, &upi,
		&l.FirstName, &middle, &l.LastName, &dob, &gender,
		&photo, &status, &admittedOn, &boarding,
		classGroupID, gradeLabel, streamName, guardianPhone,
	); err != nil {
		return err
	}

	l.UPINEMISNumber = upi.String
	l.MiddleName = middle.String
	l.DateOfBirth = dob.String
	l.Gender = gender.String
	l.PhotoRef = photo.String
	l.Status = status.String
	l.AdmittedOn = admittedOn.String
	l.BoardingType = boarding.String
	return nil
}

func (h *Handler) ListLearners(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	grade := c.Query("grade")
	stream := c.Query("stream")
	status := c.Query("status")
	q := c.Query("q")

	limit := 50
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	offset := 0
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	query := `
		SELECT l.learner_id, l.tenant_id, l.admission_number, l.upi_nemis_number,
			l.first_name, l.middle_name, l.last_name, l.date_of_birth, l.gender,
			l.photo_ref, l.status, l.admitted_on, l.boarding_type,
			cg.class_group_id, g.grade_label, s.stream_name,
			gd.phone_number AS guardian_phone
		FROM learners l
		LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		LEFT JOIN class_groups cg ON e.class_group_id = cg.class_group_id
		LEFT JOIN grades g ON cg.grade_id = g.grade_id
		LEFT JOIN streams s ON cg.stream_id = s.stream_id
		LEFT JOIN learner_guardians lg ON lg.learner_id = l.learner_id AND lg.is_primary_payer
		LEFT JOIN guardians gd ON lg.guardian_id = gd.guardian_id
		WHERE l.tenant_id = $1`
	args := []interface{}{tenantID}
	argIndex := 2

	if grade != "" {
		query += fmt.Sprintf(" AND g.grade_label = $%d", argIndex)
		args = append(args, grade)
		argIndex++
	}
	if stream != "" {
		query += fmt.Sprintf(" AND s.stream_name = $%d", argIndex)
		args = append(args, stream)
		argIndex++
	}
	if status != "" {
		query += fmt.Sprintf(" AND l.status = $%d", argIndex)
		args = append(args, status)
		argIndex++
	}
	if q != "" {
		query += fmt.Sprintf(" AND (l.first_name ILIKE $%d OR l.last_name ILIKE $%d OR l.admission_number ILIKE $%d)",
			argIndex, argIndex+1, argIndex+2)
		args = append(args, "%"+q+"%", "%"+q+"%", "%"+q+"%")
		argIndex += 3
	}

	query += fmt.Sprintf(" ORDER BY l.last_name, l.first_name LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, offset)

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	// Initialise as an empty slice so the response is [] rather than null —
	// the frontend DataTable iterates the result directly.
	learners := make([]Learner, 0)
	for rows.Next() {
		var l Learner
		var classGroupID, gradeLabel, streamName, guardianPhone sql.NullString
		if err := scanLearner(rows, &l, &classGroupID, &gradeLabel, &streamName, &guardianPhone); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		if classGroupID.Valid {
			l.ClassGroupID = classGroupID.String
		}
		if gradeLabel.Valid {
			l.GradeLabel = gradeLabel.String
		}
		if streamName.Valid {
			l.StreamName = streamName.String
		}
		if guardianPhone.Valid {
			l.GuardianPhone = guardianPhone.String
		}
		learners = append(learners, l)
	}
	c.JSON(http.StatusOK, learners)
}

// nullIfEmpty converts an empty string to nil so optional columns (dates in
// particular) are inserted as NULL instead of failing PostgreSQL's cast.
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (h *Handler) CreateLearner(c *gin.Context) {
	type GuardianInput struct {
		FullName     string `json:"full_name"`
		FirstName    string `json:"first_name"`
		LastName     string `json:"last_name"`
		PhoneNumber  string `json:"phone_number"`
		Email        string `json:"email"`
		Relationship string `json:"relationship"`
	}
	type CreateRequest struct {
		AdmissionNumber string          `json:"admission_number" binding:"required"`
		UPINEMISNumber  string          `json:"upi_nemis_number"`
		FirstName       string          `json:"first_name" binding:"required"`
		MiddleName      string          `json:"middle_name"`
		LastName        string          `json:"last_name" binding:"required"`
		DateOfBirth     string          `json:"date_of_birth"`
		Gender          string          `json:"gender"`
		Status          string          `json:"status"`
		AdmittedOn      string          `json:"admitted_on"`
		BoardingType    string          `json:"boarding_type"`
		GradeLabel      string          `json:"grade_label"`
		StreamName      string          `json:"stream_name"`
		Guardians       []GuardianInput `json:"guardians"`
	}
	var req CreateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")

	// Validate boarding_type before hitting the DB so the caller gets a
	// structured 400 instead of a constraint-violation error.
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	switch req.BoardingType {
	case "", "DAY", "BOARDING":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "boarding_type", Code: "INVALID_VALUE", Message: "'boarding_type' must be DAY or BOARDING"},
		})
		return
	}

	// Guardians are optional only when no contact is supplied; when a phone
	// number exists a guardian card must be creatable (guardians.phone_number
	// is NOT NULL, and a name is required for first_name/last_name NOT NULL).
	guardianRows := make([]GuardianInput, 0)
	for _, g := range req.Guardians {
		phone := strings.TrimSpace(g.PhoneNumber)
		if phone == "" {
			continue
		}
		if strings.TrimSpace(g.FirstName) == "" && strings.TrimSpace(g.FullName) != "" {
			parts := strings.Fields(strings.TrimSpace(g.FullName))
			if len(parts) == 1 {
				g.FirstName = parts[0]
				g.LastName = parts[0]
			} else if len(parts) > 1 {
				g.FirstName = parts[0]
				g.LastName = strings.Join(parts[1:], " ")
			}
		}
		g.FirstName = strings.TrimSpace(g.FirstName)
		g.LastName = strings.TrimSpace(g.LastName)
		if g.FirstName == "" || g.LastName == "" {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "guardians", Code: "INVALID_VALUE", Message: "each guardian needs a full name and phone number"},
			})
			return
		}
		if g.Relationship == "" {
			g.Relationship = "GUARDIAN"
		}
		guardianRec := g
		guardianRec.PhoneNumber = phone
		guardianRows = append(guardianRows, guardianRec)
	}
	var learnerID string
	err := tx.QueryRow(
		`INSERT INTO learners (tenant_id, admission_number, upi_nemis_number, first_name,
			middle_name, last_name, date_of_birth, gender, status, admitted_on, boarding_type)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'ACTIVE'), $10, COALESCE($11, 'DAY'))
		 RETURNING learner_id`,
		tenantID, req.AdmissionNumber, nullIfEmpty(req.UPINEMISNumber), req.FirstName, nullIfEmpty(req.MiddleName),
		req.LastName, nullIfEmpty(req.DateOfBirth), nullIfEmpty(req.Gender), nullIfEmpty(req.Status),
		nullIfEmpty(req.AdmittedOn), nullIfEmpty(req.BoardingType),
	).Scan(&learnerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// Link guardians in the same transaction: upsert by tenant + phone so
	// repeat admissions reuse the existing guardian card.
	for i, g := range guardianRows {
		var guardianID string
		err := tx.QueryRow(
			`SELECT guardian_id FROM guardians WHERE tenant_id = $1 AND phone_number = $2
			 ORDER BY created_at LIMIT 1`,
			tenantID, g.PhoneNumber,
		).Scan(&guardianID)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRow(
				`INSERT INTO guardians (tenant_id, first_name, last_name, phone_number, email)
				 VALUES ($1, $2, $3, $4, NULLIF($5, '')) RETURNING guardian_id`,
				tenantID, g.FirstName, g.LastName, g.PhoneNumber, strings.TrimSpace(g.Email),
			).Scan(&guardianID)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		_, err = tx.Exec(
			`INSERT INTO learner_guardians
			 (learner_id, guardian_id, relationship, is_primary_payer, is_emergency_contact, can_collect, can_view_fees)
			 VALUES ($1, $2, $3, $4, $5, false, true)`,
			learnerID, guardianID, strings.ToUpper(strings.TrimSpace(g.Relationship)),
			i == 0, g.Relationship != "",
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
	}

	// Enrol into the current class group matching grade label + stream name
	// when both resolve; leave admission without enrolment otherwise (the
	// school can still adjust structure later).
	if strings.TrimSpace(req.GradeLabel) != "" && strings.TrimSpace(req.StreamName) != "" {
		var yearID string
		if err := tx.QueryRow(
			`SELECT COALESCE(
				(SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true),
				(SELECT year_id FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC LIMIT 1))
			 FROM tenants WHERE tenant_id = $1`,
			tenantID,
		).Scan(&yearID); err == nil && yearID != "" {
			var classGroupID string
			row := tx.QueryRow(
				`SELECT cg.class_group_id
				 FROM class_groups cg
				 JOIN grades gr ON gr.grade_id = cg.grade_id
				 JOIN streams st ON st.stream_id = cg.stream_id
				 WHERE cg.tenant_id = $1 AND gr.grade_label = $2
				 AND st.stream_name = $3 AND cg.year_id = $4
				 ORDER BY cg.created_at LIMIT 1`,
				tenantID, strings.TrimSpace(req.GradeLabel), strings.TrimSpace(req.StreamName), yearID,
			)
			if err := row.Scan(&classGroupID); err == nil {
				startedOn := req.AdmittedOn
				if strings.TrimSpace(startedOn) == "" {
					startedOn = time.Now().Format("2006-01-02")
				}
				_, err = tx.Exec(
					`INSERT INTO enrolments (tenant_id, learner_id, class_group_id, year_id, status, started_on)
					 VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
					tenantID, learnerID, classGroupID, yearID, startedOn,
				)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
					return
				}
			}
		}
	}

	c.JSON(http.StatusCreated, gin.H{"learner_id": learnerID})
}

// UpdateLearner applies inline grade/stream/status changes from the learners
// table. Changing grade or stream moves the learner's active enrolment to the
// matching class group, creating the stream and class group when the school has
// not set them up yet.
func (h *Handler) UpdateLearner(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	learnerID := c.Param("id")
	tenantID := c.GetString("tenant_id")

	var req struct {
		GradeLabel string `json:"grade_label"`
		StreamName string `json:"stream_name"`
		Status     string `json:"status"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	gradeLabel := strings.TrimSpace(req.GradeLabel)
	streamName := strings.TrimSpace(req.StreamName)
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if gradeLabel == "" && streamName == "" && status == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "body", Code: "REQUIRED", Message: "provide grade_label, stream_name or status"},
		})
		return
	}

	var currentGrade, currentStream, currentYear sql.NullString
	err := tx.QueryRow(
		`SELECT g.grade_label, s.stream_name, e.year_id
		 FROM learners l
		 LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 LEFT JOIN streams s ON s.stream_id = cg.stream_id
		 WHERE l.learner_id = $1 AND l.tenant_id = $2
		 ORDER BY e.started_on DESC NULLS LAST
		 LIMIT 1`, learnerID, tenantID).Scan(&currentGrade, &currentStream, &currentYear)
	if errors.Is(err, sql.ErrNoRows) {
		validation.NotFound(c, "Learner not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	if status != "" {
		if _, err := tx.Exec(
			`UPDATE learners SET status = $1 WHERE learner_id = $2 AND tenant_id = $3`,
			status, learnerID, tenantID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
	}

	if gradeLabel != "" || streamName != "" {
		if gradeLabel == "" {
			gradeLabel = currentGrade.String
		}
		if streamName == "" {
			streamName = currentStream.String
		}
		if gradeLabel == "" {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "grade_label", Code: "REQUIRED", Message: "learner has no current grade; supply grade_label"},
			})
			return
		}
		if streamName == "" {
			streamName = "Main"
		}

		yearID := currentYear.String
		if yearID == "" {
			var y sql.NullString
			if err := tx.QueryRow(
				`SELECT COALESCE(
					(SELECT year_id FROM academic_years WHERE tenant_id = $1 AND is_current = true),
					(SELECT year_id FROM academic_years WHERE tenant_id = $1 ORDER BY start_date DESC LIMIT 1))`,
				tenantID).Scan(&y); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
				return
			}
			if !y.Valid || y.String == "" {
				validation.BadRequest(c, "Invalid request", []validation.FieldError{
					{Field: "academic_year", Code: "REQUIRED", Message: "tenant has no academic year configured"},
				})
				return
			}
			yearID = y.String
		}

		var gradeID string
		if err := tx.QueryRow(
			`SELECT grade_id FROM grades WHERE lower(grade_label) = lower($1)`, gradeLabel).Scan(&gradeID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				validation.BadRequest(c, "Invalid request", []validation.FieldError{
					{Field: "grade_label", Code: "INVALID_VALUE", Message: "unknown grade_label"},
				})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		var streamID string
		err = tx.QueryRow(
			`SELECT stream_id FROM streams
			 WHERE tenant_id = $1 AND lower(stream_name) = lower($2) LIMIT 1`,
			tenantID, streamName).Scan(&streamID)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRow(
				`INSERT INTO streams (tenant_id, stream_name) VALUES ($1, $2) RETURNING stream_id`,
				tenantID, streamName).Scan(&streamID)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		var classGroupID string
		err = tx.QueryRow(
			`SELECT class_group_id FROM class_groups
			 WHERE tenant_id = $1 AND year_id = $2 AND grade_id = $3 AND stream_id = $4
			 LIMIT 1`, tenantID, yearID, gradeID, streamID).Scan(&classGroupID)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRow(
				`INSERT INTO class_groups (tenant_id, year_id, grade_id, stream_id)
				 VALUES ($1, $2, $3, $4) RETURNING class_group_id`,
				tenantID, yearID, gradeID, streamID).Scan(&classGroupID)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		var enrolmentID string
		err = tx.QueryRow(
			`SELECT enrolment_id FROM enrolments
			 WHERE tenant_id = $1 AND learner_id = $2 AND status = 'ACTIVE'
			 ORDER BY started_on DESC LIMIT 1`, tenantID, learnerID).Scan(&enrolmentID)
		if errors.Is(err, sql.ErrNoRows) {
			_, err = tx.Exec(
				`INSERT INTO enrolments (tenant_id, learner_id, class_group_id, year_id, status, started_on)
				 VALUES ($1, $2, $3, $4, 'ACTIVE', CURRENT_DATE)`,
				tenantID, learnerID, classGroupID, yearID)
		} else if err == nil {
			_, err = tx.Exec(
				`UPDATE enrolments SET class_group_id = $1, year_id = $2 WHERE enrolment_id = $3`,
				classGroupID, yearID, enrolmentID)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"learner_id":  learnerID,
		"grade_label": gradeLabel,
		"stream_name": streamName,
		"status":      status,
	})
}

func (h *Handler) GetLearner(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	learnerID := c.Param("id")
	tenantID := c.GetString("tenant_id")

	var l Learner
	var upi, middle, dob, gender, photo, status, admittedOn, boarding sql.NullString
	err := tx.QueryRow(
		`SELECT learner_id, tenant_id, admission_number, upi_nemis_number, first_name,
			middle_name, last_name, date_of_birth, gender, photo_ref, status,
			admitted_on, boarding_type
		 FROM learners WHERE learner_id = $1 AND tenant_id = $2`,
		learnerID, tenantID,
	).Scan(&l.LearnerID, &l.TenantID, &l.AdmissionNumber, &upi,
		&l.FirstName, &middle, &l.LastName, &dob, &gender,
		&photo, &status, &admittedOn, &boarding)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "LEARNER_NOT_FOUND", "message": "Learner not found"})
		return
	}
	l.UPINEMISNumber = upi.String
	l.MiddleName = middle.String
	l.DateOfBirth = dob.String
	l.Gender = gender.String
	l.PhotoRef = photo.String
	l.Status = status.String
	l.AdmittedOn = admittedOn.String
	l.BoardingType = boarding.String
	c.JSON(http.StatusOK, l)
}

var _ = sql.ErrNoRows
