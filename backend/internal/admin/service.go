package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type InKindSetting struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenant_id"`
	SettingKey    string          `json:"setting_key"`
	SettingValue  json.RawMessage `json:"setting_value"`
	Description   *string         `json:"description,omitempty"`
	UpdatedBy     *string         `json:"updated_by,omitempty"`
	UpdatedAt     string          `json:"updated_at"`
}

type UpdateInKindSettingRequest struct {
	SettingKey    string          `json:"setting_key" binding:"required"`
	SettingValue  json.RawMessage `json:"setting_value" binding:"required"`
	Description   *string         `json:"description"`
}

func (s *Service) q(ctx context.Context) queryer {
	if q := middleware.TxFromContext(ctx); q != nil {
		return q
	}
	return s.database
}

func (s *Service) ListInKindSettings(ctx context.Context, tenantID string) ([]InKindSetting, error) {
	q := s.q(ctx)
	rows, err := q.Query(
		`SELECT id, tenant_id, setting_key, setting_value, description, updated_by, updated_at
		 FROM admin_in_kind_settings WHERE tenant_id = $1 ORDER BY setting_key`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var settings []InKindSetting
	for rows.Next() {
		var st InKindSetting
		if err := rows.Scan(&st.ID, &st.TenantID, &st.SettingKey, &st.SettingValue, &st.Description, &st.UpdatedBy, &st.UpdatedAt); err != nil {
			return nil, err
		}
		settings = append(settings, st)
	}
	return settings, rows.Err()
}

func (s *Service) UpsertInKindSetting(ctx context.Context, tenantID, userID string, req UpdateInKindSettingRequest) (*InKindSetting, error) {
	q := s.q(ctx)
	var st InKindSetting
	err := q.QueryRow(
		`INSERT INTO admin_in_kind_settings (tenant_id, setting_key, setting_value, description, updated_by)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (tenant_id, setting_key) DO UPDATE SET
			setting_value = EXCLUDED.setting_value,
			description = COALESCE(EXCLUDED.description, admin_in_kind_settings.description),
			updated_by = EXCLUDED.updated_by,
			updated_at = NOW()
		 RETURNING id, tenant_id, setting_key, setting_value, description, updated_by, updated_at`,
		tenantID, req.SettingKey, req.SettingValue, req.Description, nullIfEmpty(userID),
	).Scan(&st.ID, &st.TenantID, &st.SettingKey, &st.SettingValue, &st.Description, &st.UpdatedBy, &st.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("setting exists")
		}
		return nil, err
	}
	return &st, nil
}

func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
