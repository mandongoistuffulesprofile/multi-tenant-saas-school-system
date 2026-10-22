package cbc

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/database"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type EvaluationEntry struct {
	StudentID uuid.UUID `json:"student_id"`
	StrandID  uuid.UUID `json:"strand_id"`
	Rating    string    `json:"rating"` // EE, ME, AE, BE
	Comments  string    `json:"comments"`
}

type ReportCardItem struct {
	LearningArea string    `json:"learning_area"`
	StrandTitle  string    `json:"strand_title"`
	Rating       string    `json:"rating"`
	Comments     string    `json:"comments"`
	AssessedAt   time.Time `json:"assessed_at"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

// HandleBulkEvaluations records immutable CBC formative events
func (s *Service) HandleBulkEvaluations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	var req struct {
		Evaluations []EvaluationEntry `json:"evaluations"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Evaluations) == 0 {
		http.Error(w, `{"error": "Invalid evaluation payload"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	// Append-only batch insert into cbc_evaluation_events
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		for _, ev := range req.Evaluations {
			_, err := tx.Exec(ctx, `
				INSERT INTO cbc_evaluation_events (tenant_id, student_id, strand_id, rating, comments)
				VALUES ($1, $2, $3, $4, $5)
			`, tenantID, ev.StudentID, ev.StrandID, ev.Rating, ev.Comments)
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to record evaluations"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "CBC Evaluations recorded successfully",
		"count":   len(req.Evaluations),
	})
}

// HandleReportCard extracts the latest performance rubric per sub-strand for a learner
func (s *Service) HandleReportCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	studentIDStr := r.URL.Query().Get("student_id")
	studentID, err := uuid.Parse(studentIDStr)
	if err != nil {
		http.Error(w, `{"error": "Missing or invalid student_id query parameter"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var reportItems []ReportCardItem
	err = database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT DISTINCT ON (e.student_id, e.strand_id)
				la.name, s.title, e.rating, COALESCE(e.comments, ''), e.assessed_at
			FROM cbc_evaluation_events e
			JOIN cbc_strands s ON e.strand_id = s.id
			JOIN cbc_learning_areas la ON s.learning_area_id = la.id
			WHERE e.tenant_id = $1 AND e.student_id = $2
			ORDER BY e.student_id, e.strand_id, e.assessed_at DESC
		`, tenantID, studentID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var item ReportCardItem
			if err := rows.Scan(&item.LearningArea, &item.StrandTitle, &item.Rating, &item.Comments, &item.AssessedAt); err == nil {
				reportItems = append(reportItems, item)
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to compile report card"}`, http.StatusInternalServerError)
		return
	}

	if reportItems == nil {
		reportItems = []ReportCardItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"student_id": studentID,
		"results":    reportItems,
	})
}
