package validation

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

// FieldError describes a single field-level validation failure.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse is the standard error envelope used across all API responses.
type ErrorResponse struct {
	Code         string        `json:"code"`
	Message      string        `json:"message"`
	FieldErrors  []FieldError  `json:"field_errors,omitempty"`
	RequestID    string        `json:"request_id"`
	StatusCode   int           `json:"-"`
}

// Errors converts a validator.ValidationError into structured field errors.
// Maps Gin/validator tags to human-readable codes the frontend can act on.
func Errors(err error) []FieldError {
	vErr, ok := err.(validator.ValidationErrors)
	if !ok {
		return nil
	}

	out := make([]FieldError, 0, len(vErr))
	for _, fe := range vErr {
		field := strings.ToLower(fe.Field())
		tag := fe.Tag()

		code := validationCode(tag)
		message := validationMessage(field, tag, fe.Param())

		out = append(out, FieldError{
			Field:   field,
			Code:    code,
			Message: message,
		})
	}
	return out
}

// validationCode maps validator tags to stable API error codes.
func validationCode(tag string) string {
	switch tag {
	case "required":
		return "REQUIRED"
	case "email":
		return "INVALID_EMAIL"
	case "min":
		return "TOO_SHORT"
	case "max":
		return "TOO_LONG"
	case "gte", "lte", "gt", "lt":
		return "OUT_OF_RANGE"
	case "oneof":
		return "INVALID_VALUE"
	default:
		return "INVALID"
	}
}

// validationMessage produces a human-readable message for a field error.
func validationMessage(field, tag, param string) string {
	switch tag {
	case "required":
		return fmt.Sprintf("'%s' is required", field)
	case "email":
		return fmt.Sprintf("'%s' must be a valid email address", field)
	case "min":
		return fmt.Sprintf("'%s' is too short", field)
	case "max":
		return fmt.Sprintf("'%s' is too long", field)
	case "oneof":
		return fmt.Sprintf("'%s' must be one of: %s", field, param)
	default:
		return fmt.Sprintf("'%s' failed validation (%s)", field, tag)
	}
}

// BindJSON validates the request body and returns structured field errors on failure.
// Usage: if errs := validation.BindJSON(c, &req); errs != nil { return }
func BindJSON(c *gin.Context, obj any) []FieldError {
	if err := c.ShouldBindJSON(obj); err != nil {
		fe := Errors(err)
		if fe == nil {
			fe = []FieldError{{Field: "body", Code: "INVALID_JSON", Message: err.Error()}}
		}
		return fe
	}
	return nil
}

// JSONError writes a standard error response and aborts the request.
func JSONError(c *gin.Context, code, message string, status int, fieldErrors []FieldError) {
	requestID := c.GetString("X-Request-ID")
	if requestID == "" {
		requestID = "unknown"
	}

	resp := ErrorResponse{
		Code:        code,
		Message:     message,
		FieldErrors: fieldErrors,
		RequestID:   requestID,
		StatusCode:  status,
	}

	c.JSON(status, resp)
	c.Abort()
}

// BadRequest writes a 400 with VALIDATION_ERROR code and field-level details.
func BadRequest(c *gin.Context, message string, fieldErrors []FieldError) {
	JSONError(c, "VALIDATION_ERROR", message, http.StatusBadRequest, fieldErrors)
}

// Unauthorized writes a 401.
func Unauthorized(c *gin.Context, message string) {
	JSONError(c, "UNAUTHENTICATED", message, http.StatusUnauthorized, nil)
}

// Forbidden writes a 403.
func Forbidden(c *gin.Context, message string) {
	JSONError(c, "FORBIDDEN", message, http.StatusForbidden, nil)
}

// NotFound writes a 404.
func NotFound(c *gin.Context, message string) {
	JSONError(c, "NOT_FOUND", message, http.StatusNotFound, nil)
}

// Conflict writes a 409.
func Conflict(c *gin.Context, message string) {
	JSONError(c, "CONFLICT", message, http.StatusConflict, nil)
}

// TooManyRequests writes a 429.
func TooManyRequests(c *gin.Context, message string) {
	JSONError(c, "RATE_LIMITED", message, http.StatusTooManyRequests, nil)
}

// Internal writes a 500.
func Internal(c *gin.Context, message string) {
	JSONError(c, "INTERNAL", message, http.StatusInternalServerError, nil)
}