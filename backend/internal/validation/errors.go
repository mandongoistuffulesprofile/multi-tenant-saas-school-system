package validation

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// A pq error quotes table names, column names and constraint names:
//
//	pq: relation "teaching_assignments" does not exist
//	pq: duplicate key value violates unique constraint "receipt_sequences_period_key"
//
// Shown to a bursar it is noise; shown to anyone probing the API it is a map of
// the schema. These handlers answer with a stable code and a message that names
// nothing internal, and the driver error goes to the log with the request id so
// support can still join a complaint to a stack trace.
const dbErrorMessage = "We could not complete that request. Quote the request id below if you contact support."

const serverErrorMessage = "Something went wrong on our side. Quote the request id below if you contact support."

// DBError logs a database failure with its request id and answers 500 DB_ERROR.
// Call it as `return validation.DBError(c, err)` in place of writing the raw
// error into the response body.
func DBError(c *gin.Context, err error) {
	logFailure(c, "database error", err)
	JSONError(c, "DB_ERROR", dbErrorMessage, http.StatusInternalServerError, nil)
}

// ServerError is the same contract for a failure that is not from the database.
func ServerError(c *gin.Context, err error) {
	logFailure(c, "request failed", err)
	JSONError(c, "SERVER_ERROR", serverErrorMessage, http.StatusInternalServerError, nil)
}

func logFailure(c *gin.Context, msg string, err error) {
	attrs := []any{"request_id", RequestID(c), "error", err}
	if c.Request != nil {
		attrs = append(attrs, "method", c.Request.Method, "route", c.FullPath())
	}
	slog.ErrorContext(c.Request.Context(), msg, attrs...)
}

// RequestID returns the id the observability middleware assigned to this
// request. The middleware stores it under "request_id"; the older
// "X-Request-ID" key is still honoured so responses keep their id wherever the
// middleware was not in the chain (tests, internal calls).
func RequestID(c *gin.Context) string {
	for _, key := range []string{"request_id", "X-Request-ID"} {
		if id := c.GetString(key); id != "" {
			return id
		}
	}
	if c.Request != nil {
		if id := c.GetHeader("X-Request-ID"); id != "" {
			return id
		}
	}
	return "unknown"
}

// ServerErrorHTTP is ServerError for the few handlers that use net/http instead
// of gin: same contract, same refusal to echo err.Error().
func ServerErrorHTTP(w http.ResponseWriter, r *http.Request, err error) {
	requestID := r.Header.Get("X-Request-ID")
	if requestID == "" {
		requestID = "unknown"
	}
	slog.ErrorContext(r.Context(), "request failed",
		"request_id", requestID, "method", r.Method, "path", r.URL.Path, "error", err)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code": "SERVER_ERROR", "message": serverErrorMessage, "request_id": requestID,
	})
}
