package database

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
)

// WithTenantTx wraps DB queries in SET LOCAL app.current_tenant_id so connection pools never leak state
func WithTenantTx(ctx context.Context, db *sql.DB, tenantID uuid.UUID, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer tx.Rollback()

	setQuery := fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", tenantID.String())
	if _, err := tx.ExecContext(ctx, setQuery); err != nil {
		return fmt.Errorf("failed to set tenant context: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit()
}
