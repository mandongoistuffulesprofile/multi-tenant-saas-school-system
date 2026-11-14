package learner

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// queryer is what the list and detail queries need. The request-scoped
// transaction carries the RLS tenant context; querying the pool directly
// bypasses it and silently returns no rows.
type queryer interface {
	QueryxContext(ctx context.Context, query string, args ...interface{}) (*sqlx.Rows, error)
	QueryRowxContext(ctx context.Context, query string, args ...interface{}) *sqlx.Row
}

func (h *Handler) queryer(c *gin.Context) queryer {
	if tx := middleware.TxFromGin(c); tx != nil {
		return tx
	}
	return h.service.database
}

// learnerView is the school-facing view of a learner record: the stored columns
// plus the learner's current class and primary guardian phone.
type learnerView struct {
	LearnerID         string  `json:"learner_id"`
	TenantID          string  `json:"tenant_id"`
	AdmissionNumber   string  `json:"admission_number"`
	UPINemisNumber    *string `json:"upi_nemis_number"`
	FirstName         string  `json:"first_name"`
	MiddleName        *string `json:"middle_name"`
	LastName          string  `json:"last_name"`
	DateOfBirth       *string `json:"date_of_birth"`
	Gender            *string `json:"gender"`
	PhotoRef          *string `json:"photo_ref"`
	Status            string  `json:"status"`
	AdmittedOn        *string `json:"admitted_on"`
	ClassGroupID      *string `json:"class_group_id"`
	GradeLabel        *string `json:"grade_label"`
	StreamName        *string `json:"stream_name"`
	GuardianPhone     *string `json:"guardian_phone"`
	ResidenceType     *string `json:"residence_type"`
	KEMISUPI          *string `json:"kemis_upi"`
	KNECAssessmentNo  *string `json:"knec_assessment_no"`
	SNECategory       *string `json:"sne_category"`
	TransportZoneID   *string `json:"transport_zone_id"`
	TransportTripType *string `json:"transport_trip_type"`
}

// guardianInput is one guardian supplied with a learner admission.
type guardianInput struct {
	FullName           string `json:"full_name"`
	PhoneNumber        string `json:"phone_number"`
	Email              string `json:"email"`
	Relationship       string `json:"relationship"`
	IsEmergencyContact bool   `json:"is_emergency_contact"`
}

// learnerWriteRequest is the admission form payload. Optional values are
// strings so the API can accept the SPA's form state unchanged.
type learnerWriteRequest struct {
	AdmissionNumber   string          `json:"admission_number" binding:"required"`
	UPINemisNumber    string          `json:"upi_nemis_number"`
	FirstName         string          `json:"first_name" binding:"required"`
	MiddleName        string          `json:"middle_name"`
	LastName          string          `json:"last_name" binding:"required"`
	DateOfBirth       string          `json:"date_of_birth"`
	Gender            string          `json:"gender"`
	Status            string          `json:"status"`
	AdmittedOn        string          `json:"admitted_on"`
	BoardingType      string          `json:"boarding_type"`
	ResidenceType     string          `json:"residence_type"`
	KEMISUPI          string          `json:"kemis_upi"`
	KNECAssessmentNo  string          `json:"knec_assessment_no"`
	SNECategory       string          `json:"sne_category"`
	TransportZoneID   string          `json:"transport_zone_id"`
	TransportTripType string          `json:"transport_trip_type"`
	Guardians         []guardianInput `json:"guardians"`
}

const learnerSelect = `
	SELECT l.learner_id, l.tenant_id, l.admission_number,
	       l.upi_nemis_number, l.first_name, l.middle_name, l.last_name,
	       to_char(l.date_of_birth, 'YYYY-MM-DD'), l.gender, l.photo_ref,
	       COALESCE(l.status, 'ACTIVE'),
	       to_char(l.admitted_on, 'YYYY-MM-DD'),
	       e.class_group_id, g.grade_label, s.stream_name,
	       gd.phone_number,
	       l.residence_type, l.kemis_upi, l.knec_assessment_no, l.sne_category,
	       l.transport_zone_id::text, l.transport_trip_type
	FROM learners l
	LEFT JOIN LATERAL (
		SELECT en.class_group_id
		  FROM enrolments en
		 WHERE en.learner_id = l.learner_id AND en.status = 'ACTIVE'
		 ORDER BY en.created_at DESC NULLS LAST
		 LIMIT 1
	) e ON TRUE
	LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
	LEFT JOIN grades g ON g.grade_id = cg.grade_id
	LEFT JOIN streams s ON s.stream_id = cg.stream_id
	LEFT JOIN LATERAL (
		SELECT gd2.phone_number
		  FROM learner_guardians lg2
		  JOIN guardians gd2 ON gd2.guardian_id = lg2.guardian_id
		 WHERE lg2.learner_id = l.learner_id
		 ORDER BY lg2.is_primary_payer DESC NULLS LAST
		 LIMIT 1
	) gd ON TRUE
`

func scanLearner(scan func(dest ...interface{}) error) (*learnerView, error) {
	var (
		l                                            learnerView
		upi, middle, dob, gender, photo, admitted    sql.NullString
		classGroup, gradeLabel, streamName, guardian sql.NullString
		residence, kemis, knec, sne, zone, trip      sql.NullString
	)
	if err := scan(&l.LearnerID, &l.TenantID, &l.AdmissionNumber,
		&upi, &l.FirstName, &middle, &l.LastName,
		&dob, &gender, &photo, &l.Status, &admitted,
		&classGroup, &gradeLabel, &streamName, &guardian,
		&residence, &kemis, &knec, &sne, &zone, &trip); err != nil {
		return nil, err
	}
	l.UPINemisNumber = nullStringPtr(upi)
	l.MiddleName = nullStringPtr(middle)
	l.DateOfBirth = nullStringPtr(dob)
	l.Gender = nullStringPtr(gender)
	l.PhotoRef = nullStringPtr(photo)
	l.AdmittedOn = nullStringPtr(admitted)
	l.ClassGroupID = nullStringPtr(classGroup)
	l.GradeLabel = nullStringPtr(gradeLabel)
	l.StreamName = nullStringPtr(streamName)
	l.GuardianPhone = nullStringPtr(guardian)
	l.ResidenceType = nullStringPtr(residence)
	l.KEMISUPI = nullStringPtr(kemis)
	l.KNECAssessmentNo = nullStringPtr(knec)
	l.SNECategory = nullStringPtr(sne)
	l.TransportZoneID = nullStringPtr(zone)
	l.TransportTripType = nullStringPtr(trip)
	return &l, nil
}

func nullStringPtr(v sql.NullString) *string {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return nil
	}
	out := v.String
	return &out
}

// ListLearners lists the tenant's learners, newest admission first, with an
// optional status filter and name/admission-number search.
func (h *Handler) ListLearners(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	status := strings.TrimSpace(c.Query("status"))
	search := strings.TrimSpace(c.Query("search"))
	limit := 50
	if raw := c.Query("limit"); raw != "" {
		var n int
		if _, err := fmt.Sscanf(raw, "%d", &n); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	query := learnerSelect + " WHERE l.tenant_id = $1"
	args := []interface{}{tenantID}
	if status != "" {
		args = append(args, status)
		query += fmt.Sprintf(" AND l.status = $%d", len(args))
	}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		query += fmt.Sprintf(` AND (lower(l.admission_number) LIKE $%d
			OR lower(l.first_name || ' ' || COALESCE(l.last_name, '')) LIKE $%d)`, len(args), len(args))
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY l.admission_number LIMIT $%d", len(args))

	rows, err := h.queryer(c).QueryxContext(c.Request.Context(), query, args...)
	if err != nil {
		validation.Internal(c, "could not list learners")
		return
	}
	defer rows.Close()

	learners := make([]learnerView, 0)
	for rows.Next() {
		l, err := scanLearner(rows.Scan)
		if err != nil {
			validation.Internal(c, "could not read learner row")
			return
		}
		learners = append(learners, *l)
	}
	if err := rows.Err(); err != nil {
		validation.Internal(c, "could not read learner rows")
		return
	}
	c.JSON(http.StatusOK, learners)
}

// GetLearner returns one learner scoped to the caller's tenant.
func (h *Handler) GetLearner(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	learnerID := c.Param("id")

	l, err := h.getLearner(c.Request.Context(), tenantID, learnerID)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Learner not found")
		return
	}
	if err != nil {
		validation.Internal(c, "could not load learner")
		return
	}
	c.JSON(http.StatusOK, l)
}

func (h *Handler) getLearner(ctx context.Context, tenantID, learnerID string) (*learnerView, error) {
	var q queryer = h.service.database
	if tx := middleware.TxFromContext(ctx); tx != nil {
		q = tx
	}
	row := q.QueryRowxContext(ctx, learnerSelect+" WHERE l.tenant_id = $1 AND l.learner_id = $2", tenantID, learnerID)
	return scanLearner(row.Scan)
}

// CreateLearner admits one learner and, when guardian details are supplied,
// records the guardian and links them to the new learner.
func (h *Handler) CreateLearner(c *gin.Context) {
	var req learnerWriteRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	ctx := c.Request.Context()

	tx, err := h.service.database.BeginTxx(ctx, nil)
	if err != nil {
		validation.Internal(c, "could not start transaction")
		return
	}
	defer tx.Rollback()

	var learnerID string
	err = tx.QueryRowxContext(ctx, `
		INSERT INTO learners (tenant_id, admission_number, upi_nemis_number,
			first_name, middle_name, last_name, date_of_birth, gender, status, admitted_on,
			boarding_type, residence_type, kemis_upi, knec_assessment_no, sne_category,
			transport_zone_id, transport_trip_type, is_boarder)
		VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), $6,
			NULLIF($7, '')::date, NULLIF($8, ''), COALESCE(NULLIF($9, ''), 'ACTIVE'),
			NULLIF($10, '')::date,
			COALESCE(NULLIF($11, ''), 'DAY'),
			COALESCE(NULLIF($12, ''), 'DAY_SCHOLAR_WITH_LUNCH'),
			NULLIF($13, ''), NULLIF($14, ''), COALESCE(NULLIF($15, ''), 'NONE'),
			NULLIF($16, '')::uuid, COALESCE(NULLIF($17, ''), 'NONE'),
			COALESCE(NULLIF($11, ''), 'DAY') = 'BOARDING')
		RETURNING learner_id`,
		tenantID, req.AdmissionNumber, req.UPINemisNumber, req.FirstName, req.MiddleName, req.LastName,
		req.DateOfBirth, req.Gender, req.Status, req.AdmittedOn,
		req.BoardingType, req.ResidenceType, req.KEMISUPI, req.KNECAssessmentNo, req.SNECategory,
		req.TransportZoneID, req.TransportTripType,
	).Scan(&learnerID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "That admission number is already in use")
			return
		}
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "learner", Code: "INVALID_VALUE", Message: "could not store learner: " + err.Error()},
		})
		return
	}

	for i, g := range req.Guardians {
		if strings.TrimSpace(g.PhoneNumber) == "" {
			continue
		}
		first, last := splitName(g.FullName, req.LastName)
		var guardianID string
		if err := tx.QueryRowxContext(ctx, `
			INSERT INTO guardians (tenant_id, first_name, last_name, phone_number, email)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''))
			RETURNING guardian_id`,
			tenantID, first, last, strings.TrimSpace(g.PhoneNumber), g.Email,
		).Scan(&guardianID); err != nil {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "guardians", Code: "INVALID_VALUE", Message: "could not store guardian: " + err.Error()},
			})
			return
		}
		relationship := strings.TrimSpace(g.Relationship)
		if relationship == "" {
			relationship = "GUARDIAN"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO learner_guardians (learner_id, guardian_id, relationship, is_primary_payer, is_emergency_contact)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (learner_id, guardian_id) DO NOTHING`,
			learnerID, guardianID, relationship, i == 0, g.IsEmergencyContact,
		); err != nil {
			validation.Internal(c, "could not link guardian")
			return
		}
	}

	if err := tx.Commit(); err != nil {
		validation.Internal(c, "could not complete learner admission")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"learner_id": learnerID})
}

// UpdateLearner applies the supplied fields to one learner.
func (h *Handler) UpdateLearner(c *gin.Context) {
	var req learnerWriteRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	learnerID := c.Param("id")

	set := make([]string, 0, 12)
	args := make([]interface{}, 0, 14)
	add := func(column, value string) {
		args = append(args, value)
		set = append(set, fmt.Sprintf("%s = NULLIF($%d, '')", column, len(args)))
	}

	if req.AdmissionNumber != "" {
		add("admission_number", req.AdmissionNumber)
	}
	if req.UPINemisNumber != "" {
		add("upi_nemis_number", req.UPINemisNumber)
	}
	if req.FirstName != "" {
		add("first_name", req.FirstName)
	}
	if req.MiddleName != "" {
		add("middle_name", req.MiddleName)
	}
	if req.LastName != "" {
		add("last_name", req.LastName)
	}
	if req.Gender != "" {
		add("gender", req.Gender)
	}
	if req.Status != "" {
		add("status", req.Status)
	}
	if req.ResidenceType != "" {
		add("residence_type", req.ResidenceType)
	}
	if req.KEMISUPI != "" {
		add("kemis_upi", req.KEMISUPI)
	}
	if req.KNECAssessmentNo != "" {
		add("knec_assessment_no", req.KNECAssessmentNo)
	}
	if req.SNECategory != "" {
		add("sne_category", req.SNECategory)
	}
	if req.TransportTripType != "" {
		add("transport_trip_type", req.TransportTripType)
	}
	if req.DateOfBirth != "" {
		args = append(args, req.DateOfBirth)
		set = append(set, fmt.Sprintf("date_of_birth = $%d::date", len(args)))
	}
	if req.AdmittedOn != "" {
		args = append(args, req.AdmittedOn)
		set = append(set, fmt.Sprintf("admitted_on = $%d::date", len(args)))
	}
	if len(set) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "learner", Code: "REQUIRED", Message: "no fields to update"},
		})
		return
	}
	set = append(set, "updated_at = now()")
	args = append(args, learnerID, tenantID)

	query := fmt.Sprintf("UPDATE learners SET %s WHERE learner_id = $%d AND tenant_id = $%d",
		strings.Join(set, ", "), len(args)-1, len(args))
	result, err := h.service.database.ExecContext(c.Request.Context(), query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key value") {
			validation.Conflict(c, "That admission number is already in use")
			return
		}
		validation.Internal(c, "could not update learner")
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Learner not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"learner_id": learnerID})
}

func splitName(fullName, fallbackLast string) (string, string) {
	fields := strings.Fields(strings.TrimSpace(fullName))
	switch len(fields) {
	case 0:
		return "Guardian", fallbackLast
	case 1:
		return fields[0], fallbackLast
	default:
		return strings.Join(fields[:len(fields)-1], " "), fields[len(fields)-1]
	}
}
