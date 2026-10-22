package attendance

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

type AttendanceEntry struct {
	StudentID uuid.UUID `json:"student_id"`
	Status    string    `json:"status"`
	Remarks   *string   `json:"remarks"`
}

type Service struct {
	dbPool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{dbPool: pool}
}

func (s *Service) HandleRollCall(w http.ResponseWriter, r *http.Request) {
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
		StreamID uuid.UUID         `json:"stream_id"`
		Date     string            `json:"date"`
		Session  string            `json:"session"`
		Entries  []AttendanceEntry `json:"entries"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Entries) == 0 {
		http.Error(w, `{"error": "Invalid attendance payload"}`, http.StatusBadRequest)
		return
	}

	if req.Session == "" {
		req.Session = "MORNING"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	err := database.RunInTenantTx(ctx, s.dbPool, tenantID, func(tx pgx.Tx) error {
		for _, entry := range req.Entries {
			_, err := tx.Exec(ctx, `
				INSERT INTO attendance_records (tenant_id, student_id, stream_id, attendance_date, session, status, remarks)
				VALUES ($1, $2, $3, $4::DATE, $5, $6, $7)
				ON CONFLICT (tenant_id, student_id, attendance_date, session)
				DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks, recorded_at = NOW()
			`, tenantID, entry.StudentID, req.StreamID, req.Date, req.Session, entry.Status, entry.Remarks)
			if err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, `{"error": "Failed to record attendance"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"message": "Roll call recorded successfully",
		"count":   len(req.Entries),
	})
}
