package validation

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func failureContext(requestID string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/finance/invoices", nil)
	if requestID != "" {
		c.Set("request_id", requestID)
	}
	return c, w
}

// The messages below are the ones the API used to hand out verbatim.
const pqMissingRelation = `pq: relation "teaching_assignments" does not exist`

func TestDBErrorKeepsTheSchemaOutOfTheResponse(t *testing.T) {
	c, w := failureContext("req-abc")

	DBError(c, errors.New(pqMissingRelation))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, "pq:") || strings.Contains(body, "teaching_assignments") {
		t.Fatalf("response leaks the driver error: %s", body)
	}

	var resp ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v (%s)", err, body)
	}
	if resp.Code != "DB_ERROR" {
		t.Errorf("code = %q, want DB_ERROR", resp.Code)
	}
	if resp.RequestID != "req-abc" {
		t.Errorf("request_id = %q, want the id the middleware assigned", resp.RequestID)
	}
	if !strings.Contains(resp.Message, "request id") {
		t.Errorf("message %q should tell the caller what to quote", resp.Message)
	}
}

func TestServerErrorHasTheSameContract(t *testing.T) {
	c, w := failureContext("")

	ServerError(c, errors.New("hash: argon2 out of memory"))

	var resp ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Code != "SERVER_ERROR" {
		t.Errorf("code = %q, want SERVER_ERROR", resp.Code)
	}
	if resp.RequestID != "unknown" {
		t.Errorf("request_id = %q, want unknown when no middleware ran", resp.RequestID)
	}
	if strings.Contains(w.Body.String(), "argon2") {
		t.Errorf("response leaks the internal error: %s", w.Body.String())
	}
}

// TestNoHandlerWritesADriverErrorIntoAServerFailure guards the rule rather than
// the two call sites: a 5xx body may carry a stable code and a request id, but
// never err.Error(). This is the check that keeps the next handler from quietly
// reintroducing the problem, so it scans the source instead of driving handlers.
func TestNoHandlerWritesADriverErrorIntoAServerFailure(t *testing.T) {
	var offenders []string
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(src), "\n") {
			if strings.Contains(line, "StatusInternalServerError") && strings.Contains(line, "err.Error()") {
				offenders = append(offenders, path+":"+itoa(i+1))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(offenders) > 0 {
		t.Fatalf("these server failures write the raw error to the client; use validation.DBError or validation.ServerError:\n  %s",
			strings.Join(offenders, "\n  "))
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
