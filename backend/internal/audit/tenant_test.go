package audit

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type recordingExecer struct {
	query string
	args  []any
}

func (r *recordingExecer) Exec(query string, args ...interface{}) (sql.Result, error) {
	r.query = query
	r.args = args
	return nil, nil
}

// TestTenantActionRecordsAttribution pins the shared audit write: the actor,
// IP and request ID come from the request, and the action-specific details are
// stored as JSON in new_values rather than in columns the schema does not have.
func TestTenantActionRecordsAttribution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := &recordingExecer{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/academic/rollover", nil)
	c.Request.RemoteAddr = "203.0.113.9:4321"
	c.Set("tenant_id", "school-a")
	c.Set("user_id", "user-1")
	c.Set("request_id", "req-1")

	TenantAction(rec, c, "ACADEMIC_ROLLOVER_APPLIED", "academic_years", "year-2027",
		map[string]any{"promoted": 10, "graduating": 3})

	if rec.query == "" {
		t.Fatal("no audit insert was issued")
	}
	for _, column := range []string{"user_id", "table_name", "record_id", "new_values", "ip_address", "request_id"} {
		if !strings.Contains(rec.query, column) {
			t.Fatalf("audit insert does not write %s:\n%s", column, rec.query)
		}
	}
	for _, forbidden := range []string{"actor_user_id", "entity_type", "after_state", "target_type"} {
		if strings.Contains(rec.query, forbidden) {
			t.Fatalf("audit insert references non-existent column %s", forbidden)
		}
	}

	want := []any{"school-a", "user-1", "ACADEMIC_ROLLOVER_APPLIED", "academic_years", "year-2027"}
	for i, expected := range want {
		if rec.args[i] != expected {
			t.Fatalf("audit argument %d = %v, want %v", i, rec.args[i], expected)
		}
	}
	if rec.args[6] != "203.0.113.9" {
		t.Fatalf("audit IP = %v, want 203.0.113.9", rec.args[6])
	}
	if rec.args[7] != "req-1" {
		t.Fatalf("audit request id = %v, want req-1", rec.args[7])
	}

	var details map[string]any
	if err := json.Unmarshal([]byte(rec.args[5].(string)), &details); err != nil {
		t.Fatalf("audit details are not JSON: %v", err)
	}
	if details["promoted"] != float64(10) || details["graduating"] != float64(3) {
		t.Fatalf("audit details = %v, want promoted 10 and graduating 3", details)
	}
}

func TestTenantActionWithoutHandleIsSafe(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	TenantAction(nil, c, "NOOP", "none", "", nil)
}
