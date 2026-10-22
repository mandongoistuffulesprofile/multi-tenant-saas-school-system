package student

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

type Student struct {
	ID              uuid.UUID  `json:"id"`
	AdmissionNumber string     `json:"admission_number"`
	UPINemis        *string    `json:"upi_nemis,omitempty"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	Gender          string     `json:"gender"`
	DateOfBirth     string     `json:"date_of_birth"`
	CurrentStreamID *uuid.UUID `json:"current_stream_id,omitempty"`
	Status          string     `json:"status"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

func (s *Service) HandleStudents(w http.ResponseWriter, r *http.Request) {
	tenantVal := r.Context().Value(middleware.TenantIDKey)
	tenantID, ok := tenantVal.(uuid.UUID)
	if !ok {
		http.Error(w, `{"error": "Invalid tenant context"}`, http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		s.listStudents(w, r, tenantID)
	case http.MethodPost:
		s.admitStudent(w, r, tenantID)
	default:
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (s *Service) listStudents(w http.ResponseWriter, r *http.Request, tenantID uuid.UUID) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var students []Student
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, admission_number, upi_nemis, first_name, last_name, gender, TO_CHAR(date_of_birth, 'YYYY-MM-DD'), current_stream_id, status
			FROM students
			WHERE tenant_id = $1
			ORDER BY first_name ASC
		`, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var st Student
			if err := rows.Scan(&st.ID, &st.AdmissionNumber, &st.UPINemis, &st.FirstName, &st.LastName, &st.Gender, &st.DateOfBirth, &st.CurrentStreamID, &st.Status); err == nil {
				students = append(students, st)
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to fetch students"}`, http.StatusInternalServerError)
		return
	}

	if students == nil {
		students = []Student{}
	}
	json.NewEncoder(w).Encode(students)
}

func (s *Service) admitStudent(w http.ResponseWriter, r *http.Request, tenantID uuid.UUID) {
	var req struct {
		AdmissionNumber string     `json:"admission_number"`
		UPINemis        *string    `json:"upi_nemis"`
		FirstName       string     `json:"first_name"`
		LastName        string     `json:"last_name"`
		Gender          string     `json:"gender"`
		DateOfBirth     string     `json:"date_of_birth"`
		CurrentStreamID *uuid.UUID `json:"current_stream_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var newID uuid.UUID
	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO students (tenant_id, admission_number, upi_nemis, first_name, last_name, gender, date_of_birth, current_stream_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7::DATE, $8)
			RETURNING id
		`, tenantID, req.AdmissionNumber, req.UPINemis, req.FirstName, req.LastName, req.Gender, req.DateOfBirth, req.CurrentStreamID).Scan(&newID)
	})

	if err != nil {
		http.Error(w, `{"error": "Admission failed. Admission number may already exist."}`, http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message":    "Student admitted successfully",
		"student_id": newID,
	})
}
