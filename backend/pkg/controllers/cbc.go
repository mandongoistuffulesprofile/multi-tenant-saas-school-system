package controllers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"backend/pkg/middleware"
)

type CBCAssessmentPayload struct {
	StudentID    string `json:"student_id"`
	LearningArea string `json:"learning_area"`
	Strand       string `json:"strand"`
	Substrand    string `json:"substrand"`
	RubricLevel  string `json:"rubric_level"`
	TermID       string `json:"term_id"`
	AcademicYear int    `json:"academic_year"`
}

type SyncBatchRequest struct {
	SchemaVersion string                 `json:"schema_version"`
	Records       []CBCAssessmentPayload `json:"records"`
}

type CBCController struct {
	DB *sql.DB
}

func NewCBCController(db *sql.DB) *CBCController {
	return &CBCController{DB: db}
}

// RecordAssessment appends to the immutable event log (trigger automatically updates read model)
func (c *CBCController) RecordAssessment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var p CBCAssessmentPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, `{"error":"Payload batili"}`, http.StatusBadRequest)
		return
	}

	tx := r.Context().Value(middleware.TxContextKey).(*sql.Tx)
	tenantID := r.Context().Value(middleware.TenantContextKey).(string)

	query := `
		INSERT INTO cbc_assessment_events (
			tenant_id, student_id, learning_area, strand, substrand, rubric_level, recorded_by, term_id, academic_year, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, '00000000-0000-0000-0000-000000000000', $7, $8, $9);
	`

	_, err := tx.ExecContext(r.Context(), query,
		tenantID, p.StudentID, p.LearningArea, p.Strand, p.Substrand, p.RubricLevel, p.TermID, p.AcademicYear, time.Now(),
	)

	if err != nil {
		http.Error(w, `{"error":"Imeshindwa kuhifadhi tathmini"}`, http.StatusInternalServerError)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "message": "Tathmini imehifadhiwa"})
}

// BatchSync handles offline PWA synchronization
func (c *CBCController) BatchSync(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req SyncBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"Batch payload batili"}`, http.StatusBadRequest)
		return
	}

	if req.SchemaVersion != "1.0.0" {
		http.Error(w, `{"error":"Hitilafu ya toleo la schema (Schema drift detected). Tafadhali sasisha programu."}`, http.StatusUpgradeRequired)
		return
	}

	tx := r.Context().Value(middleware.TxContextKey).(*sql.Tx)
	tenantID := r.Context().Value(middleware.TenantContextKey).(string)

	stmt, err := tx.PrepareContext(r.Context(), `
		INSERT INTO cbc_assessment_events (
			tenant_id, student_id, learning_area, strand, substrand, rubric_level, recorded_by, term_id, academic_year, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, '00000000-0000-0000-0000-000000000000', $7, $8, $9);
	`)
	if err != nil {
		http.Error(w, `{"error":"Database error"}`, http.StatusInternalServerError)
		return
	}
	defer stmt.Close()

	for _, p := range req.Records {
		_, _ = stmt.ExecContext(r.Context(), tenantID, p.StudentID, p.LearningArea, p.Strand, p.Substrand, p.RubricLevel, p.TermID, p.AcademicYear, time.Now())
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "synced",
		"records_synced": len(req.Records),
		"timestamp":      time.Now(),
	})
}
