package attendance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
)

// These tests cover the two register writes the desk gained last: editing a
// register's session (PATCH) and deleting a register together with its marks.
//
// Both are destructive in their own way — one rewrites who was marked, the other
// removes a whole register — so the important assertions are the refusals: an
// unknown id must not delete anything, an empty or invalid body must be a 400
// rather than a silent no-op, and a deletion must leave an audit row.
//
// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func TestRegisterWrites(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer database.Close()

	ctx := context.Background()
	suffix := time.Now().UnixNano()
	tenantID := fmt.Sprintf("att-writes-%d", suffix)

	var learnerID, userID string
	if err := database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantID, "Register Writes School", tenantID,
		); err != nil {
			return err
		}
		if err := tx.QueryRow(
			`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
			 VALUES ($1, $2, 'Amina', 'Wanjiru') RETURNING learner_id`,
			tenantID, fmt.Sprintf("RW-%d", suffix%1000000),
		).Scan(&learnerID); err != nil {
			return err
		}
		return tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, email_norm)
			 VALUES ($1::varchar, $2, 'x:x', $1::text) RETURNING user_id::text`,
			fmt.Sprintf("register-writes-%d@example.test", suffix),
			fmt.Sprintf("2547%d", (suffix/7)%10000000),
		).Scan(&userID)
	}); err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM attendance_marks WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM attendance_registers WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM audit_events WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM learners WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
			return nil
		})
		_, _ = database.Exec(`DELETE FROM users WHERE user_id = $1`, userID)
	})

	handler := NewHandler(NewService(database))
	gin.SetMode(gin.TestMode)

	// freshTx returns a tenant transaction the handler can use, committed by the
	// caller when the assertions are done.
	freshTx := func(t *testing.T) *sqlx.Tx {
		t.Helper()
		tx, err := database.BeginTxx(ctx, nil)
		if err != nil {
			t.Fatalf("begin tx: %v", err)
		}
		if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
			tx.Rollback()
			t.Fatalf("tenant context: %v", err)
		}
		t.Cleanup(func() { _ = tx.Rollback() })
		return tx
	}

	newRegister := func(t *testing.T, tx *sqlx.Tx, sessionType string) string {
		t.Helper()
		var registerID string
		if err := tx.QueryRow(
			`INSERT INTO attendance_registers
			   (tenant_id, class_group_id, grade_id, stream_id, academic_year_id, term_id,
			    register_date, session_type, status)
			 VALUES ($1, gen_random_uuid(), 'G1', gen_random_uuid(), gen_random_uuid(),
			         gen_random_uuid(), CURRENT_DATE, $2, 'CLOSED')
			 RETURNING register_id`,
			tenantID, sessionType,
		).Scan(&registerID); err != nil {
			t.Fatalf("create register: %v", err)
		}
		return registerID
	}

	addMark := func(t *testing.T, tx *sqlx.Tx, registerID string) {
		t.Helper()
		if _, err := tx.Exec(
			`INSERT INTO attendance_marks (tenant_id, register_id, learner_id, status)
			 VALUES ($1, $2, $3, 'PRESENT')`,
			tenantID, registerID, learnerID,
		); err != nil {
			t.Fatalf("create mark: %v", err)
		}
	}

	request := func(t *testing.T, tx *sqlx.Tx, method, registerID, body string) (*gin.Context, *httptest.ResponseRecorder) {
		t.Helper()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		var payload *bytes.Reader
		if body == "" {
			payload = bytes.NewReader(nil)
		} else {
			payload = bytes.NewReader([]byte(body))
		}
		c.Request = httptest.NewRequest(method, "/api/v1/attendance/registers/"+registerID, payload)
		c.Request.Header.Set("Content-Type", "application/json")
		c.Params = gin.Params{{Key: "register_id", Value: registerID}}
		c.Set("tenant_id", tenantID)
		c.Set("user_id", userID)
		c.Set("tx", tx)
		return c, w
	}

	decode := func(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body %q: %v", w.Body.String(), err)
		}
		return body
	}

	t.Run("listing tolerates a register nobody has marked", func(t *testing.T) {
		tx := freshTx(t)
		registerID := newRegister(t, tx, "MORNING")

		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/attendance/registers", nil)
		c.Set("tenant_id", tenantID)
		c.Set("tx", tx)
		handler.ListAttendanceRegisters(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		var rows []map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
			t.Fatalf("decode body %q: %v", w.Body.String(), err)
		}
		for _, row := range rows {
			if row["register_id"] == registerID {
				// marked_by is omitempty, so an unmarked register has no key.
				if marked, ok := row["marked_by"]; ok && marked != "" {
					t.Errorf("marked_by = %v, want empty for an unmarked register", marked)
				}
				return
			}
		}
		t.Fatalf("register %s missing from list", registerID)
	})

	t.Run("delete removes the register, its marks and records an audit row", func(t *testing.T) {
		tx := freshTx(t)
		registerID := newRegister(t, tx, "MORNING")
		addMark(t, tx, registerID)
		addMark(t, tx, registerID)

		c, w := request(t, tx, http.MethodDelete, registerID, "")
		handler.DeleteRegister(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		if got := decode(t, w)["marks_deleted"]; got != float64(2) {
			t.Errorf("marks_deleted = %v, want 2", got)
		}

		var marks int
		if err := tx.QueryRow(`SELECT count(*) FROM attendance_marks WHERE register_id = $1`, registerID).Scan(&marks); err != nil {
			t.Fatalf("count marks: %v", err)
		}
		if marks != 0 {
			t.Errorf("%d marks survived the delete", marks)
		}
		var registers int
		if err := tx.QueryRow(`SELECT count(*) FROM attendance_registers WHERE register_id = $1`, registerID).Scan(&registers); err != nil {
			t.Fatalf("count registers: %v", err)
		}
		if registers != 0 {
			t.Errorf("register survived the delete")
		}

		var (
			action, tableName, recordID, actorID, tenant string
			details                                      []byte
		)
		if err := tx.QueryRow(
			`SELECT action, table_name, record_id::text, new_values::text,
			        COALESCE(user_id::text, ''), tenant_id
			 FROM audit_events WHERE record_id = $1`,
			registerID,
		).Scan(&action, &tableName, &recordID, &details, &actorID, &tenant); err != nil {
			t.Fatalf("no audit row for the deleted register: %v", err)
		}
		if action != "ATTENDANCE_REGISTER_DELETED" || tableName != "attendance_registers" {
			t.Errorf("audit action/table = %s/%s", action, tableName)
		}
		if actorID != userID || tenant != tenantID {
			t.Errorf("audit attribution = user %q tenant %q", actorID, tenant)
		}
		var parsed map[string]any
		if err := json.Unmarshal(details, &parsed); err != nil {
			t.Fatalf("decode audit detail %q: %v", details, err)
		}
		if parsed["marks_deleted"] != float64(2) || parsed["session_type"] != "MORNING" {
			t.Errorf("audit detail = %v", parsed)
		}
	})

	t.Run("deleting an unknown register is a 404 that touches nothing", func(t *testing.T) {
		tx := freshTx(t)
		survivor := newRegister(t, tx, "MORNING")
		addMark(t, tx, survivor)

		c, w := request(t, tx, http.MethodDelete, "00000000-0000-0000-0000-000000000000", "")
		handler.DeleteRegister(c)

		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404, body = %s", w.Code, w.Body.String())
		}
		if code, _ := decode(t, w)["code"].(string); code != "NOT_FOUND" {
			t.Errorf("code = %q, want NOT_FOUND", code)
		}
		var marks int
		if err := tx.QueryRow(`SELECT count(*) FROM attendance_marks WHERE register_id = $1`, survivor).Scan(&marks); err != nil {
			t.Fatalf("count marks: %v", err)
		}
		if marks != 1 {
			t.Errorf("mark of another register was touched: %d left, want 1", marks)
		}
		var audits int
		if err := tx.QueryRow(`SELECT count(*) FROM audit_events WHERE record_id = $1`,
			"00000000-0000-0000-0000-000000000000").Scan(&audits); err != nil {
			t.Fatalf("count audit rows: %v", err)
		}
		if audits != 0 {
			t.Errorf("a 404 wrote %d audit rows", audits)
		}
	})

	t.Run("session_type is updated and read back", func(t *testing.T) {
		tx := freshTx(t)
		registerID := newRegister(t, tx, "MORNING")

		c, w := request(t, tx, http.MethodPatch, registerID, `{"session_type":"evening"}`)
		handler.UpdateRegister(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		var sessionType string
		var user *string
		if err := tx.QueryRow(
			`SELECT session_type, marked_by::text FROM attendance_registers WHERE register_id = $1`,
			registerID,
		).Scan(&sessionType, &user); err != nil {
			t.Fatalf("read register: %v", err)
		}
		if sessionType != "EVENING" {
			t.Errorf("session_type = %q, want EVENING (normalised from lower case)", sessionType)
		}
		if user == nil || *user != userID {
			t.Errorf("marked_by = %v, want the caller %q", user, userID)
		}
	})

	t.Run("status alone is still accepted", func(t *testing.T) {
		tx := freshTx(t)
		registerID := newRegister(t, tx, "MORNING")

		c, w := request(t, tx, http.MethodPatch, registerID, `{"status":"open"}`)
		handler.UpdateRegister(c)

		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		var status string
		if err := tx.QueryRow(`SELECT status FROM attendance_registers WHERE register_id = $1`, registerID).Scan(&status); err != nil {
			t.Fatalf("read register: %v", err)
		}
		if status != "OPEN" {
			t.Errorf("status = %q, want OPEN", status)
		}
	})

	t.Run("empty and invalid bodies are 400s that leave the register alone", func(t *testing.T) {
		tx := freshTx(t)
		registerID := newRegister(t, tx, "MORNING")

		for _, tc := range []struct{ name, body, field string }{
			{"neither field", `{}`, "status"},
			{"unknown status", `{"status":"HALF_OPEN"}`, "status"},
			{"unknown session", `{"session_type":"NIGHT"}`, "session_type"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				c, w := request(t, tx, http.MethodPatch, registerID, tc.body)
				handler.UpdateRegister(c)
				if w.Code != http.StatusBadRequest {
					t.Fatalf("status = %d, want 400, body = %s", w.Code, w.Body.String())
				}
				var fields []any
				if details, ok := decode(t, w)["field_errors"].([]any); ok {
					fields = details
				}
				found := false
				for _, f := range fields {
					if m, ok := f.(map[string]any); ok && m["field"] == tc.field {
						found = true
					}
				}
				if !found {
					t.Errorf("body %s did not name field %q: %s", w.Body.String(), tc.field, w.Body.String())
				}
			})
		}

		var sessionType, status string
		if err := tx.QueryRow(
			`SELECT session_type, status FROM attendance_registers WHERE register_id = $1`,
			registerID).Scan(&sessionType, &status); err != nil {
			t.Fatalf("read register: %v", err)
		}
		if sessionType != "MORNING" || status != "CLOSED" {
			t.Errorf("rejected request changed the register: %s/%s", sessionType, status)
		}
	})

	t.Run("updating an unknown register is a 404", func(t *testing.T) {
		tx := freshTx(t)
		c, w := request(t, tx, http.MethodPatch, "00000000-0000-0000-0000-000000000000", `{"session_type":"EVENING"}`)
		handler.UpdateRegister(c)
		if w.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404, body = %s", w.Code, w.Body.String())
		}
		if code, _ := decode(t, w)["code"].(string); code != "NOT_FOUND" {
			t.Errorf("code = %q, want NOT_FOUND", code)
		}
	})
}

// TestRegisterWritesNeedATransaction guards the shared precondition: without the
// tenant transaction every one of these handlers must fail closed rather than
// fall through to the database handle.
func TestRegisterWritesNeedATransaction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil)

	for name, call := range map[string]func(*gin.Context){
		"delete": handler.DeleteRegister,
		"update": handler.UpdateRegister,
	} {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPatch, "/api/v1/attendance/registers/x", strings.NewReader("{}"))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("tenant_id", "demo-school")
			call(c)
			if w.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 so a missing transaction is loud", w.Code)
			}
		})
	}
}
