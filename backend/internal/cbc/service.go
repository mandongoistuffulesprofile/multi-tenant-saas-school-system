package cbc

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type AssessmentEvent struct {
	StudentID        uuid.UUID `json:"student_id"`
	LearningArea     string    `json:"learning_area"`
	Strand           string    `json:"strand"`
	SubStrand        string    `json:"sub_strand"`
	PerformanceLevel int       `json:"performance_level"` // 1: BE, 2: AE, 3: ME, 4: EE
	SyncID           uuid.UUID `json:"sync_id"`           // Offline deduplication
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

// RecordAssessmentBatch processes offline events from teacher PWAs idempotently.
//
// The caller must supply a request-scoped tenant transaction (retrieved via
// middleware.TxFromGin / middleware.TxFromContext) whose RLS context
// (app.current_tenant_id) is already set by TenantTxMiddleware. The transaction
// lifecycle — begin, tenant context, commit/rollback — is owned by the
// middleware, not by this method.
func (s *Service) RecordAssessmentBatch(ctx context.Context, tx *sqlx.Tx, tenantID, teacherID uuid.UUID, events []AssessmentEvent) error {
	if tx == nil {
		return fmt.Errorf("cbc: no tenant transaction provided")
	}

	query := `
		INSERT INTO cbc_assessment_events (tenant_id, student_id, learning_area, strand, sub_strand, performance_level, recorded_by, sync_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (sync_id) DO NOTHING;
	`
	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, ev := range events {
		if ev.PerformanceLevel < 1 || ev.PerformanceLevel > 4 {
			return fmt.Errorf("invalid CBC performance level: %d (must be between 1 and 4)", ev.PerformanceLevel)
		}
		if _, err := stmt.ExecContext(ctx, tenantID, ev.StudentID, ev.LearningArea, ev.Strand, ev.SubStrand, ev.PerformanceLevel, teacherID, ev.SyncID); err != nil {
			return fmt.Errorf("failed inserting assessment: %w", err)
		}
	}

	return nil
}

var _ = sql.ErrNoRows