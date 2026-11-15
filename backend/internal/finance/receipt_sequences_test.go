package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// These tests cover the receipt-sequence endpoints: list, create and update.
//
// The interesting behaviour is not the happy path but what happens around it. A
// period is unique per school, so a second create must be a 409 rather than a
// duplicate row; editing a sequence onto a period that already exists must be a
// 409 too; and an invalid body must be a 400 that writes nothing. The list has
// to serialise an empty result as [] — the sequence page renders it directly and
// a null reads as "the request failed".
//
// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func TestReceiptSequenceEndpoints(t *testing.T) {
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
	tenantID := fmt.Sprintf("rseq-%d", suffix)
	if err := database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
		_, err := tx.Exec(
			`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, $2, $3)`,
			tenantID, "Receipt Sequence School", tenantID,
		)
		return err
	}); err != nil {
		t.Fatalf("create fixture: %v", err)
	}
	t.Cleanup(func() {
		_ = database.WithTenant(ctx, tenantID, "", func(tx *db.Tx) error {
			_, _ = tx.Exec(`DELETE FROM receipt_sequences WHERE tenant_id = $1`, tenantID)
			_, _ = tx.Exec(`DELETE FROM schools WHERE tenant_id = $1`, tenantID)
			return nil
		})
	})

	handler := NewHandler(NewService(database))
	gin.SetMode(gin.TestMode)

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

	request := func(t *testing.T, tx *sqlx.Tx, method, target, body string, params gin.Params) (*gin.Context, *httptest.ResponseRecorder) {
		t.Helper()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(method, target, bytes.NewReader([]byte(body)))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Request = c.Request.WithContext(middleware.WithTx(c.Request.Context(), tx))
		c.Params = params
		c.Set("tenant_id", tenantID)
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

	create := func(t *testing.T, tx *sqlx.Tx, period string) *httptest.ResponseRecorder {
		t.Helper()
		c, w := request(t, tx, http.MethodPost, "/api/v1/finance/receipt-sequences",
			fmt.Sprintf(`{"prefix":"RCP","last_number":0,"reset_frequency":"YEARLY","current_period":%q}`, period),
			nil)
		handler.CreateReceiptSequence(c)
		return w
	}

	t.Run("an empty list is [] not null", func(t *testing.T) {
		tx := freshTx(t)
		c, w := request(t, tx, http.MethodGet, "/api/v1/finance/receipt-sequences", "", nil)
		handler.ListReceiptSequences(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		if got := w.Body.String(); got != "[]" {
			t.Errorf("body = %s, want []", got)
		}
	})

	t.Run("create rejects invalid bodies without writing", func(t *testing.T) {
		tx := freshTx(t)
		for _, tc := range []struct{ name, body, field string }{
			{"no prefix", `{"current_period":"2031"}`, "current_period"},
			{"no period", `{"prefix":"RCP"}`, "current_period"},
			{"negative counter", `{"prefix":"RCP","current_period":"2031","last_number":-1}`, "current_period"},
			{"unknown reset", `{"prefix":"RCP","current_period":"2031","reset_frequency":"WEEKLY"}`, "current_period"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				c, w := request(t, tx, http.MethodPost, "/api/v1/finance/receipt-sequences", tc.body, nil)
				handler.CreateReceiptSequence(c)
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
					t.Errorf("body %s did not name field %q", w.Body.String(), tc.field)
				}
			})
		}
		var rows int
		if err := tx.QueryRow(`SELECT count(*) FROM receipt_sequences WHERE tenant_id = $1`, tenantID).Scan(&rows); err != nil {
			t.Fatalf("count: %v", err)
		}
		if rows != 0 {
			t.Errorf("rejected creates wrote %d rows", rows)
		}
	})

	t.Run("create stores the row and refuses a duplicate period", func(t *testing.T) {
		tx := freshTx(t)
		w := create(t, tx, "2027")
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		first := decode(t, w)
		if first["current_period"] != "2027" || first["prefix"] != "RCP" || first["sequence_id"] == "" {
			t.Errorf("created body = %v", first)
		}

		// The duplicate is a real unique-violation, which aborts the surrounding
		// transaction in Postgres. The middleware rolls back on any 4xx in
		// production; here a savepoint keeps the assertions that follow usable.
		if _, err := tx.Exec(`SAVEPOINT duplicate`); err != nil {
			t.Fatalf("savepoint: %v", err)
		}
		again := create(t, tx, "2027")
		if _, err := tx.Exec(`ROLLBACK TO SAVEPOINT duplicate`); err != nil {
			t.Fatalf("rollback to savepoint: %v", err)
		}
		if again.Code != http.StatusConflict {
			t.Fatalf("duplicate status = %d, want 409, body = %s", again.Code, again.Body.String())
		}
		if code, _ := decode(t, again)["code"].(string); code != "CONFLICT" {
			t.Errorf("duplicate code = %q, want CONFLICT", code)
		}

		var rows int
		if err := tx.QueryRow(
			`SELECT count(*) FROM receipt_sequences WHERE tenant_id = $1 AND current_period = '2027'`,
			tenantID).Scan(&rows); err != nil {
			t.Fatalf("count: %v", err)
		}
		if rows != 1 {
			t.Errorf("%d rows for one period, want 1", rows)
		}
	})

	t.Run("list returns every sequence for the tenant", func(t *testing.T) {
		tx := freshTx(t)
		for _, period := range []string{"2027", "2028"} {
			if w := create(t, tx, period); w.Code != http.StatusCreated {
				t.Fatalf("create %s status = %d, body = %s", period, w.Code, w.Body.String())
			}
		}
		c, w := request(t, tx, http.MethodGet, "/api/v1/finance/receipt-sequences", "", nil)
		handler.ListReceiptSequences(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		var rows []map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &rows); err != nil {
			t.Fatalf("decode %q: %v", w.Body.String(), err)
		}
		if len(rows) != 2 {
			t.Fatalf("got %d rows, want 2: %s", len(rows), w.Body.String())
		}
		// Newest period first, so the desk sees the live counter at the top.
		if rows[0]["current_period"] != "2028" || rows[1]["current_period"] != "2027" {
			t.Errorf("order = %v then %v", rows[0]["current_period"], rows[1]["current_period"])
		}
	})

	t.Run("update changes the counter and rejects collisions", func(t *testing.T) {
		tx := freshTx(t)
		if w := create(t, tx, "2029"); w.Code != http.StatusCreated {
			t.Fatalf("create 2029: %s", w.Body.String())
		}
		if w := create(t, tx, "2030"); w.Code != http.StatusCreated {
			t.Fatalf("create 2030: %s", w.Body.String())
		}

		var sequenceID string
		if err := tx.QueryRow(
			`SELECT sequence_id FROM receipt_sequences WHERE tenant_id = $1 AND current_period = '2029'`,
			tenantID).Scan(&sequenceID); err != nil {
			t.Fatalf("read sequence id: %v", err)
		}
		params := gin.Params{{Key: "id", Value: sequenceID}}

		c, w := request(t, tx, http.MethodPatch, "/api/v1/finance/receipt-sequences/"+sequenceID,
			`{"prefix":"rcpt","last_number":41,"reset_frequency":"MONTHLY","current_period":"2029"}`, params)
		handler.UpdateReceiptSequence(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		if got := decode(t, w); got["last_number"] != float64(41) || got["prefix"] != "RCPT" || got["reset_frequency"] != "MONTHLY" {
			t.Errorf("updated body = %v", got)
		}

		// Moving a sequence onto a period another sequence already owns would
		// leave two counters for one period, so it must be refused.
		if _, err := tx.Exec(`SAVEPOINT collision`); err != nil {
			t.Fatalf("savepoint: %v", err)
		}
		c, w = request(t, tx, http.MethodPatch, "/api/v1/finance/receipt-sequences/"+sequenceID,
			`{"prefix":"RCP","last_number":41,"reset_frequency":"MONTHLY","current_period":"2030"}`, params)
		handler.UpdateReceiptSequence(c)
		if _, err := tx.Exec(`ROLLBACK TO SAVEPOINT collision`); err != nil {
			t.Fatalf("rollback to savepoint: %v", err)
		}
		if w.Code != http.StatusConflict {
			t.Fatalf("collision status = %d, want 409, body = %s", w.Code, w.Body.String())
		}

		// An invalid body is a 400 even for an existing sequence.
		c, w = request(t, tx, http.MethodPatch, "/api/v1/finance/receipt-sequences/"+sequenceID,
			`{"prefix":"RCP","reset_frequency":"FORTNIGHTLY","current_period":"2029"}`, params)
		handler.UpdateReceiptSequence(c)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid body status = %d, want 400, body = %s", w.Code, w.Body.String())
		}

		c, w = request(t, tx, http.MethodPatch,
			"/api/v1/finance/receipt-sequences/00000000-0000-0000-0000-000000000000",
			`{"prefix":"RCP","current_period":"2032"}`,
			gin.Params{{Key: "id", Value: "00000000-0000-0000-0000-000000000000"}})
		handler.UpdateReceiptSequence(c)
		if w.Code != http.StatusNotFound {
			t.Fatalf("unknown id status = %d, want 404, body = %s", w.Code, w.Body.String())
		}

		// The refused edits must not have changed the stored counter.
		var lastNumber int
		var period string
		if err := tx.QueryRow(
			`SELECT last_number, current_period FROM receipt_sequences WHERE sequence_id = $1`,
			sequenceID).Scan(&lastNumber, &period); err != nil {
			t.Fatalf("read sequence: %v", err)
		}
		if lastNumber != 41 || period != "2029" {
			t.Errorf("refused update changed the row: last_number=%d period=%s", lastNumber, period)
		}
	})

	t.Run("GET by period creates the default once and is idempotent", func(t *testing.T) {
		tx := freshTx(t)
		params := gin.Params{{Key: "period", Value: "2033"}}

		c, w := request(t, tx, http.MethodGet, "/api/v1/finance/receipt-sequences/2033", "", params)
		handler.GetReceiptSequence(c)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
		}
		first := decode(t, w)
		if first["prefix"] != "RCP" || first["last_number"] != float64(0) || first["reset_frequency"] != "YEARLY" {
			t.Errorf("default sequence = %v", first)
		}

		c, w = request(t, tx, http.MethodGet, "/api/v1/finance/receipt-sequences/2033", "", params)
		handler.GetReceiptSequence(c)
		if w.Code != http.StatusOK {
			t.Fatalf("second status = %d, body = %s", w.Code, w.Body.String())
		}
		if second := decode(t, w); second["sequence_id"] != first["sequence_id"] {
			t.Errorf("second read returned a different row: %v then %v", first["sequence_id"], second["sequence_id"])
		}

		var rows int
		if err := tx.QueryRow(
			`SELECT count(*) FROM receipt_sequences WHERE tenant_id = $1 AND current_period = '2033'`,
			tenantID).Scan(&rows); err != nil {
			t.Fatalf("count: %v", err)
		}
		if rows != 1 {
			t.Errorf("%d rows created for one period, want 1", rows)
		}
	})
}
