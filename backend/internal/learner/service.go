package learner

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// LearnerTerminationRequest is the authenticated school-admin request to
// categorize and retain a learner record rather than remove it outright.
type LearnerTerminationRequest struct {
	LearnerIDs []string `json:"learner_ids" binding:"required,min=1"`
	Category   string   `json:"category" binding:"required"`
	Reason     string   `json:"reason" binding:"required"`
}

// Termination categories represent why a learner is no longer active in daily
// school life. The record is retained for audit, finance, attendance and
// reporting; only the active status changes.
var TerminationCategories = []string{
	"TRANSFERRED_OUT",
	"EXPELLED",
	"GRADUATED",
	"WITHDRAWN",
	"RELOCATED",
	"ARCHIVED",
}

func IsTerminationCategory(category string) bool {
	for _, c := range TerminationCategories {
		if strings.EqualFold(c, category) {
			return true
		}
	}
	return false
}

// Handler provides learner endpoints scoped to the current tenant.
type Handler struct {
	service *Service
}

// Service is the learner write/read surface.
type Service struct {
	database *sqlx.DB
}

// NewService creates a learner service.
func NewService(database *sqlx.DB) *Service {
	return &Service{database: database}
}

// TerminateLearners categorizes one or more learner records as no longer
// active. It requires a school-admin session, a valid termination category,
// and a documented reason, and it writes an audit trail entry for every
// affected learner.
//
// TerminateLearners is intentionally a status change, not a row purge.
// Learner records are retained for audit, finance, attendance and reporting;
// only the active status is changed and the action is recorded in
// learner_status_history.
func (h *Handler) TerminateLearners(c *gin.Context) {
	if !middleware.IsSchoolAdmin(c) {
		validation.Forbidden(c, "school admin access required")
		return
	}

	var req LearnerTerminationRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	if !IsTerminationCategory(req.Category) {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "category", Code: "INVALID_VALUE", Message: "category must be a recognized termination category"},
		})
		return
	}

	if len(strings.TrimSpace(req.Reason)) < 10 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "reason", Code: "TOO_SHORT", Message: "reason must be at least 10 characters"},
		})
		return
	}

	userID, _ := c.Get("user_id")
	tenantID := c.GetString("tenant_id")
	if tenantID == "" {
		validation.Forbidden(c, "no tenant context")
		return
	}

	tx, err := h.service.database.BeginTxx(c.Request.Context(), nil)
	if err != nil {
		validation.InternalError(c, "could not start transaction")
		return
	}
	defer tx.Rollback()

	var results []TerminationResult
	for _, learnerID := range req.LearnerIDs {
		row, err := h.service.terminateLearner(tx, tenantID, learnerID, req.Category, req.Reason, userID)
		if err != nil {
			results = append(results, TerminationResult{
				LearnerID: learnerID,
				Error:     err.Error(),
			})
			continue
		}
		results = append(results, TerminationResult{
			LearnerID:        row.LearnerID,
			AdmissionNumber:  row.AdmissionNumber,
			PreviousStatus:   row.PreviousStatus,
			NewStatus:        row.NewStatus,
			Category:         req.Category,
		})
	}

	if err := tx.Commit(); err != nil {
		validation.InternalError(c, "could not complete learner termination")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"terminated": results,
	})
}

// TerminationResult is one learner's termination response.
type TerminationResult struct {
	LearnerID        string `json:"learner_id"`
	AdmissionNumber  string `json:"admission_number"`
	PreviousStatus   string `json:"previous_status"`
	NewStatus        string `json:"new_status"`
	Category         string `json:"category"`
	Error            string `json:"error,omitempty"`
}

// LearnerStatusChange is one row written to learner_status_history.
type LearnerStatusChange struct {
	LearnerID       string
	AdmissionNumber string
	PreviousStatus  string
	NewStatus       string
	Reason          string
	ChangedBy       string
	ChangedAt       time.Time
}

// terminateLearner changes a learner's status to a termination category and
// records the change in learner_status_history.
func (s *Service) terminateLearner(
	tx *sqlx.Tx,
	tenantID, learnerID, category, reason, userID string,
) (*LearnerStatusChange, error) {
	var l struct {
		LearnerID      string
		AdmissionNumber string
		FirstName       string
		LastName        string
	}
	var previousStatus sql.NullString
	err := tx.QueryRow(
		`SELECT learner_id, admission_number, status, first_name, last_name
		 FROM learners
		 WHERE learner_id = $1 AND tenant_id = $2`,
		learnerID, tenantID,
	).Scan(&l.LearnerID, &l.AdmissionNumber, &previousStatus, &l.FirstName, &l.LastName)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("learner not found")
		}
		return nil, err
	}

	newStatus := strings.ToUpper(category)
	if !previousStatus.Valid || previousStatus.String == newStatus {
		if _, err := tx.Exec(
			`INSERT INTO learner_status_history
			 (learner_id, tenant_id, previous_status, new_status, reason, changed_by, changed_at)
			 VALUES ($1, $2, $3, $4, $5, $6, now())`,
			l.LearnerID, tenantID, previousStatus.String, newStatus, reason, userID,
		); err != nil {
			return nil, err
		}
		return &LearnerStatusChange{
			LearnerID:       l.LearnerID,
			AdmissionNumber: l.AdmissionNumber,
			PreviousStatus:  previousStatus.String,
			NewStatus:       newStatus,
			Reason:          reason,
			ChangedBy:       userID,
			ChangedAt:       time.Now(),
		}, nil
	}

	if _, err := tx.Exec(
		`UPDATE learners SET status = $1, updated_at = now()
		 WHERE learner_id = $2 AND tenant_id = $3`,
		newStatus, l.LearnerID, tenantID,
	); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(
		`INSERT INTO learner_status_history
		 (learner_id, tenant_id, previous_status, new_status, reason, changed_by, changed_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		l.LearnerID, tenantID, previousStatus.String, newStatus, reason, userID,
	); err != nil {
		return nil, err
	}

	return &LearnerStatusChange{
		LearnerID:       l.LearnerID,
		AdmissionNumber: l.AdmissionNumber,
		PreviousStatus:  previousStatus.String,
		NewStatus:       newStatus,
		Reason:          reason,
		ChangedBy:       userID,
		ChangedAt:       time.Now(),
	}, nil
}

// Learner is the stable learner record view used by the school admin pages.
type Learner struct {
	LearnerID         string `json:"learner_id"`
	TenantID          string `json:"tenant_id"`
	AdmissionNumber   string `json:"admission_number"`
	UPINEMISNumber    string `json:"upi_nemis_number,omitempty"`
	FirstName         string `json:"first_name"`
	MiddleName        string `json:"middle_name,omitempty"`
	LastName          string `json:"last_name"`
	DateOfBirth       string `json:"date_of_birth,omitempty"`
	Gender            string `json:"gender,omitempty"`
	PhotoRef          string `json:"photo_ref,omitempty"`
	Status            string `json:"status"`
	AdmittedOn        string `json:"admitted_on,omitempty"`
	BoardingType      string `json:"boarding_type,omitempty"`
	ResidenceType     string `json:"residence_type,omitempty"`
	KEMISUPI          string `json:"kesis_upi,omitempty"`
	KNECAssessmentNo string `json:"knec_assessment_no,omitempty"`
	SNECategory       string `json:"sne_category,omitempty"`
	TransportZoneID   string `json:"transport_zone_id,omitempty"`
	TransportTripType string `json:"transport_trip_type,omitempty"`
	GradeLabel        string `json:"grade_label,omitempty"`
	StreamName        string `json:"stream_name,omitempty"`
}

// IsSchoolAdmin is a small predicate used by learner endpoints that need to
// confirm the caller is a school administrator before mutating learner records.
func IsSchoolAdmin(c *gin.Context) bool {
	return middleware.IsSchoolAdmin(c)
}
