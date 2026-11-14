package admin_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/admin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// TestInKindSettingsRoundTrip exercises the table, the tenant policy and the
// timestamp scans together: the settings endpoint previously failed before it
// reached the database, and its updated_at column is selected as text because
// the handler decodes it into a string.
func TestInKindSettingsRoundTrip(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	tenantID := "inkind-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if err := database.WithTenant(context.Background(), tenantID, "", func(tx *db.Tx) error {
		_, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			tenantID, "In-kind School", tenantID)
		return err
	}); err != nil {
		t.Fatalf("seed school: %v", err)
	}

	handler := admin.NewHandler(admin.NewService(database))
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("tenant_id", tenantID); c.Next() })
	router.Use(middleware.TenantTxMiddleware(database.DB, nil))
	router.POST("/settings", handler.UpsertInKindSetting)
	router.GET("/settings", handler.ListInKindSettings)

	body := `{"setting_key":"MAIZE_RATE","setting_value":{"per_kg":55},"description":"Maize valuation"}`
	req := httptest.NewRequest(http.MethodPost, "/settings", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("upsert returned %d: %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/settings", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("list returned %d: %s", rec.Code, rec.Body.String())
	}
	var listed []struct {
		SettingKey   string          `json:"setting_key"`
		SettingValue json.RawMessage `json:"setting_value"`
		UpdatedAt    string          `json:"updated_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v (%s)", err, rec.Body.String())
	}
	if len(listed) != 1 {
		t.Fatalf("settings = %d, want 1: %s", len(listed), rec.Body.String())
	}
	if listed[0].SettingKey != "MAIZE_RATE" || !strings.Contains(string(listed[0].SettingValue), "55") {
		t.Fatalf("unexpected setting: %+v", listed[0])
	}
	if listed[0].UpdatedAt == "" {
		t.Fatalf("updated_at did not survive the scan: %+v", listed[0])
	}
}
