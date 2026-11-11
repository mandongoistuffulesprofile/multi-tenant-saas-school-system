package auth

import (
	"context"
	"crypto/rand"
	"database/sql"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Security-question recovery reuses the baseline schema:
//
//	security_questions(question_id, question_text, display_order)
//	user_security_answers(user_id, question_id, answer_hash, ...)
//
// Answers are normalised (trim, lowercase, collapse whitespace) and hashed
// with argon2id before storage. The API never returns answer hashes.
type recoveryQuestion struct {
	ID    int    `json:"id" db:"question_id"`
	Label string `json:"label" db:"question_text"`
}

type recoveryAnswerInput struct {
	QuestionID int    `json:"question_id"`
	Answer     string `json:"answer"`
}

func normalizeAnswer(answer string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(answer)), " "))
}

func requestIdentifier(identifier, email string) string {
	if v := strings.TrimSpace(identifier); v != "" {
		return v
	}
	return strings.TrimSpace(email)
}

// validateRecoveryAnswers checks the shape only; the handler confirms that the
// question IDs exist in security_questions.
func validateRecoveryAnswers(in []recoveryAnswerInput) (map[int]string, string) {
	if len(in) != 3 {
		return nil, "Choose exactly three security questions"
	}
	out := make(map[int]string, 3)
	for _, a := range in {
		if a.QuestionID <= 0 {
			return nil, "Unknown security question"
		}
		if _, duplicate := out[a.QuestionID]; duplicate {
			return nil, "Each security question must be different"
		}
		answer := normalizeAnswer(a.Answer)
		if len([]rune(answer)) < 2 {
			return nil, "Answers must be at least 2 characters"
		}
		if len([]rune(answer)) > 200 {
			return nil, "Answers must be at most 200 characters"
		}
		out[a.QuestionID] = answer
	}
	return out, ""
}

func (h *Handler) configuredRecoveryQuestions(ctx context.Context, userID string) ([]recoveryQuestion, error) {
	items := make([]recoveryQuestion, 0, 3)
	err := h.database.SelectContext(ctx, &items, `
		SELECT q.question_id, q.question_text
		  FROM user_security_answers a
		  JOIN security_questions q ON q.question_id = a.question_id
		 WHERE a.user_id = $1
		 ORDER BY q.display_order, q.question_id`, userID)
	return items, err
}

func (h *Handler) questionsExist(ctx context.Context, ids []int) (bool, error) {
	if len(ids) != 3 {
		return false, nil
	}
	var count int
	err := h.database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM security_questions WHERE question_id IN ($1, $2, $3)`,
		ids[0], ids[1], ids[2],
	).Scan(&count)
	return count == 3, err
}

// ListRecoveryQuestionCatalog exposes the fixed question set to the SPA.
func (h *Handler) ListRecoveryQuestionCatalog(c *gin.Context) {
	items := make([]recoveryQuestion, 0, 10)
	if err := h.database.SelectContext(c.Request.Context(), &items, `
		SELECT question_id, question_text FROM security_questions
		 ORDER BY display_order, question_id`); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not load security questions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"questions": items})
}

// GetMySecurityQuestions reports which questions the signed-in user configured.
func (h *Handler) GetMySecurityQuestions(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Sign in required"})
		return
	}
	questions, err := h.configuredRecoveryQuestions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not load recovery settings"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"configured": len(questions) >= 3,
		"questions":  questions,
	})
}

// SetMySecurityQuestions replaces the signed-in user's three recovery
// questions. The current password is required so a borrowed session cannot
// silently take over account recovery.
func (h *Handler) SetMySecurityQuestions(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "UNAUTHORIZED", "message": "Sign in required"})
		return
	}
	if !AllowRecoverySetup(c.Request.Context(), userID) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RATE_LIMITED", "message": "Too many attempts. Try again later."})
		return
	}
	var req struct {
		CurrentPassword string                `json:"current_password"`
		Answers         []recoveryAnswerInput `json:"answers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.CurrentPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Current password and three answers are required"})
		return
	}
	answers, msg := validateRecoveryAnswers(req.Answers)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ANSWERS", "message": msg})
		return
	}
	ids := make([]int, 0, len(answers))
	for id := range answers {
		ids = append(ids, id)
	}

	ctx := c.Request.Context()
	exists, err := h.questionsExist(ctx, ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not validate the questions"})
		return
	}
	if !exists {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_ANSWERS", "message": "One or more security questions do not exist"})
		return
	}

	var currentHash string
	if err := h.database.QueryRowContext(ctx,
		`SELECT password_hash FROM users WHERE user_id = $1 AND is_active = true`, userID,
	).Scan(&currentHash); err != nil || !VerifyPassword(currentHash, req.CurrentPassword) {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CREDENTIALS", "message": "Current password is incorrect"})
		return
	}

	tx, err := h.database.BeginTxx(ctx, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not save recovery settings"})
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_security_answers WHERE user_id = $1`, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not save recovery settings"})
		return
	}
	for _, id := range ids {
		hash, err := HashPassword(answers[id])
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Could not secure the answers"})
			return
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO user_security_answers (user_id, question_id, answer_hash) VALUES ($1, $2, $3)`,
			userID, id, hash,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not save recovery settings"})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not save recovery settings"})
		return
	}

	saved, _ := h.configuredRecoveryQuestions(ctx, userID)
	c.JSON(http.StatusOK, gin.H{
		"configured": true,
		"questions":  saved,
		"message":    "Recovery questions saved",
	})
}

// RecoveryQuestions returns the account's configured questions for the
// no-cost reset flow. Unknown accounts and accounts without questions get the
// same response so the endpoint cannot be used to enumerate users.
func (h *Handler) RecoveryQuestions(c *gin.Context) {
	var req struct {
		Identifier string `json:"identifier"`
		Email      string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	identifier := requestIdentifier(req.Identifier, req.Email)
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	ctx := c.Request.Context()
	normalized := strings.ToLower(identifier)
	if !AllowRecoveryQuestionsIP(ctx, c.ClientIP()) || !AllowRecoveryQuestionsEmail(ctx, normalized) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RATE_LIMITED", "message": "Too many attempts. Try again later."})
		return
	}

	userID, err := h.findActiveUser(ctx, identifier)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "RECOVERY_NOT_SETUP", "message": "No security questions are set up for this account"})
		return
	}
	questions, err := h.configuredRecoveryQuestions(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not load recovery questions"})
		return
	}
	if len(questions) < 3 {
		c.JSON(http.StatusNotFound, gin.H{"code": "RECOVERY_NOT_SETUP", "message": "No security questions are set up for this account"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"questions": questions})
}

// ResetWithAnswers verifies all configured answers and sets a new password.
func (h *Handler) ResetWithAnswers(c *gin.Context) {
	var req struct {
		Identifier  string                `json:"identifier"`
		Email       string                `json:"email"`
		Answers     []recoveryAnswerInput `json:"answers"`
		NewPassword string                `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Answers and a new password are required"})
		return
	}
	identifier := requestIdentifier(req.Identifier, req.Email)
	answers, msg := validateRecoveryAnswers(req.Answers)
	if identifier == "" || msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Three answers and a new password are required"})
		return
	}
	if policyErr := ValidatePasswordPolicy(req.NewPassword); policyErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "POLICY_VIOLATION", "message": policyErr})
		return
	}
	ctx := c.Request.Context()
	normalized := strings.ToLower(identifier)
	if !AllowRecoveryAnswersIP(ctx, c.ClientIP()) || !AllowRecoveryAnswersEmail(ctx, normalized) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RATE_LIMITED", "message": "Too many attempts. Try again later."})
		return
	}

	userID, err := h.findActiveUser(ctx, identifier)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "RECOVERY_INCORRECT", "message": "One or more answers are incorrect"})
		return
	}
	if h.recoveryLocked(ctx, userID) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RECOVERY_LOCKED", "message": "Too many incorrect answers. Request platform help or try again later."})
		return
	}

	type storedAnswer struct {
		QuestionID int    `db:"question_id"`
		AnswerHash string `db:"answer_hash"`
	}
	stored := make([]storedAnswer, 0, 3)
	if err := h.database.SelectContext(ctx, &stored, `
		SELECT question_id, answer_hash FROM user_security_answers WHERE user_id = $1`, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not verify answers"})
		return
	}
	matched := 0
	for _, row := range stored {
		if answer, ok := answers[row.QuestionID]; ok && VerifyPassword(row.AnswerHash, answer) {
			matched++
		}
	}

	if len(stored) < 3 || matched != len(stored) {
		h.noteRecoveryFailure(ctx, userID)
		c.JSON(http.StatusUnauthorized, gin.H{"code": "RECOVERY_INCORRECT", "message": "One or more answers are incorrect"})
		return
	}

	if err := h.completePasswordReset(ctx, userID, req.NewPassword); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not reset the password"})
		return
	}
	h.clearRecoveryFailures(ctx, userID)
	c.JSON(http.StatusOK, gin.H{"code": "RESET_COMPLETE", "message": "Password has been reset. Sign in with your new password."})
}

// RequestPasswordAssistance puts the user in the platform-admin help queue.
// Unknown accounts receive the same response to avoid enumeration.
func (h *Handler) RequestPasswordAssistance(c *gin.Context) {
	var req struct {
		Identifier string `json:"identifier"`
		Email      string `json:"email"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	identifier := requestIdentifier(req.Identifier, req.Email)
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	ctx := c.Request.Context()
	normalized := strings.ToLower(identifier)
	if !AllowAssistanceIP(ctx, c.ClientIP()) || !AllowAssistanceEmail(ctx, normalized) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RATE_LIMITED", "message": "Too many requests. Try again later."})
		return
	}
	note := strings.TrimSpace(req.Note)
	if len([]rune(note)) > 500 {
		note = string([]rune(note)[:500])
	}

	if userID, err := h.findActiveUser(ctx, identifier); err == nil {
		tenantID := h.userTenant(ctx, userID)
		_, err := h.database.ExecContext(ctx, `
			INSERT INTO password_assistance_requests (user_id, tenant_id, note)
			VALUES ($1, NULLIF($2, ''), $3)
			ON CONFLICT (user_id) WHERE status = 'PENDING'
			DO UPDATE SET note = CASE
				WHEN EXCLUDED.note <> '' THEN EXCLUDED.note
				ELSE password_assistance_requests.note
			END`,
			userID, tenantID, note,
		)
		if err != nil {
			log.Printf("password assistance: could not queue request for user %s: %v", userID, err)
		} else {
			log.Printf("password assistance: request queued for tenant %q", tenantID)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    "ASSISTANCE_REQUESTED",
		"message": "A platform administrator has been notified. They can issue you a one-time reset code.",
	})
}

// ResetWithSupportCode redeems a one-time code issued by a platform admin.
func (h *Handler) ResetWithSupportCode(c *gin.Context) {
	var req struct {
		Identifier  string `json:"identifier"`
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Code and a new password are required"})
		return
	}
	identifier := requestIdentifier(req.Identifier, req.Email)
	code := normalizeRecoveryCode(req.Code)
	if identifier == "" || code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Code and a new password are required"})
		return
	}
	if policyErr := ValidatePasswordPolicy(req.NewPassword); policyErr != "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "POLICY_VIOLATION", "message": policyErr})
		return
	}
	ctx := c.Request.Context()
	normalized := strings.ToLower(identifier)
	if !AllowRecoveryCodeIP(ctx, c.ClientIP()) || !AllowRecoveryCodeEmail(ctx, normalized) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RATE_LIMITED", "message": "Too many attempts. Try again later."})
		return
	}

	userID, err := h.findActiveUser(ctx, identifier)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CODE", "message": "The support code is invalid or has expired"})
		return
	}
	if h.recoveryLocked(ctx, userID) {
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "RECOVERY_LOCKED", "message": "Too many incorrect attempts. Try again later."})
		return
	}

	hashes := make([]string, 0, 3)
	if err := h.database.SelectContext(ctx, &hashes, `
		SELECT code_hash FROM password_reset_codes
		 WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
		 ORDER BY created_at DESC LIMIT 3`, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not verify the code"})
		return
	}
	matched := false
	for _, hash := range hashes {
		if VerifyPassword(hash, code) {
			matched = true
		}
	}

	if !matched {
		h.noteRecoveryFailure(ctx, userID)
		c.JSON(http.StatusUnauthorized, gin.H{"code": "INVALID_CODE", "message": "The support code is invalid or has expired"})
		return
	}

	if err := h.completePasswordReset(ctx, userID, req.NewPassword); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not reset the password"})
		return
	}
	_, _ = h.database.ExecContext(ctx,
		`UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID)
	h.clearRecoveryFailures(ctx, userID)
	c.JSON(http.StatusOK, gin.H{"code": "RESET_COMPLETE", "message": "Password has been reset. Sign in with your new password."})
}

// ---------------------------------------------------------------------------
// Platform administrator endpoints (SAAS_ADMIN / SUPER_ADMIN)
// ---------------------------------------------------------------------------

type assistanceRequestRow struct {
	RequestID        string     `db:"request_id" json:"request_id"`
	UserID           string     `db:"user_id" json:"user_id"`
	Identifier       string     `db:"identifier" json:"identifier"`
	Email            string     `db:"email" json:"email"`
	Phone            string     `db:"phone" json:"phone"`
	TenantID         string     `db:"tenant_id" json:"tenant_id"`
	SchoolName       string     `db:"school_name" json:"school_name"`
	Note             string     `db:"note" json:"note"`
	Status           string     `db:"status" json:"status"`
	CreatedAt        time.Time  `db:"created_at" json:"created_at"`
	ResolvedAt       *time.Time `db:"resolved_at" json:"resolved_at,omitempty"`
	ResolutionMethod string     `db:"resolution_method" json:"resolution_method,omitempty"`
}

// ListPasswordAssistance powers the platform-admin queue and its badge count.
func (h *Handler) ListPasswordAssistance(c *gin.Context) {
	ctx := c.Request.Context()
	var items []assistanceRequestRow
	err := h.database.SelectContext(ctx, &items, `
		SELECT r.request_id::text, r.user_id::text,
		       COALESCE(NULLIF(u.email, ''), u.phone_number) AS identifier,
		       COALESCE(u.email, '') AS email,
		       COALESCE(u.phone_number, '') AS phone,
		       COALESCE(r.tenant_id, '') AS tenant_id,
		       COALESCE(s.school_name, '') AS school_name,
		       COALESCE(r.note, '') AS note,
		       r.status,
		       r.created_at,
		       r.resolved_at,
		       COALESCE(r.resolution_method, '') AS resolution_method
		  FROM password_assistance_requests r
		  JOIN users u ON u.user_id = r.user_id
		  LEFT JOIN schools s ON s.tenant_id = r.tenant_id
		 ORDER BY CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC
		 LIMIT 100`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not load password assistance requests"})
		return
	}
	pending := 0
	for _, item := range items {
		if item.Status == "PENDING" {
			pending++
		}
	}
	c.JSON(http.StatusOK, gin.H{"pending": pending, "requests": items})
}

// IssueResetCodeForRequest resolves one queued help request with a one-time code.
func (h *Handler) IssueResetCodeForRequest(c *gin.Context) {
	requestID := c.Param("id")
	adminID := c.GetString("user_id")
	ctx := c.Request.Context()

	var userID, identifier string
	err := h.database.QueryRowContext(ctx, `
		SELECT r.user_id::text, COALESCE(NULLIF(u.email, ''), u.phone_number)
		  FROM password_assistance_requests r
		  JOIN users u ON u.user_id = r.user_id
		 WHERE r.request_id = $1`, requestID).Scan(&userID, &identifier)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Assistance request not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not load the request"})
		return
	}

	code, expiresAt, err := h.issueResetCode(ctx, userID, adminID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not issue a reset code"})
		return
	}
	_, _ = h.database.ExecContext(ctx, `
		UPDATE password_assistance_requests
		   SET status = 'RESOLVED', resolved_by = NULLIF($2, '')::uuid,
		       resolved_at = now(), resolution_method = 'CODE_ISSUED'
		 WHERE user_id = $1 AND status = 'PENDING'`, userID, adminID)

	log.Printf("password assistance: admin %s issued a reset code for user %s", adminID, userID)
	c.JSON(http.StatusOK, gin.H{
		"code":               code,
		"expires_at":         expiresAt,
		"expires_in_minutes": resetCodeTTLMinutes,
		"user_id":            userID,
		"identifier":         identifier,
		"message":            "Give this one-time code to the user over a verified channel. It expires shortly and works once.",
	})
}

// IssueResetCodeByEmail lets an administrator help a user who could not queue
// a request (for example, they cannot sign in to see the form).
func (h *Handler) IssueResetCodeByEmail(c *gin.Context) {
	var req struct {
		Email      string `json:"email"`
		Identifier string `json:"identifier"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	identifier := requestIdentifier(req.Identifier, req.Email)
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_REQUEST", "message": "Email or phone number is required"})
		return
	}
	ctx := c.Request.Context()
	userID, err := h.findActiveUser(ctx, identifier)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"code": "USER_NOT_FOUND", "message": "No active account matches that email or phone number"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not look up the account"})
		return
	}
	adminID := c.GetString("user_id")
	code, expiresAt, err := h.issueResetCode(ctx, userID, adminID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Could not issue a reset code"})
		return
	}
	_, _ = h.database.ExecContext(ctx, `
		UPDATE password_assistance_requests
		   SET status = 'RESOLVED', resolved_by = NULLIF($2, '')::uuid,
		       resolved_at = now(), resolution_method = 'CODE_ISSUED'
		 WHERE user_id = $1 AND status = 'PENDING'`, userID, adminID)

	log.Printf("password assistance: admin %s issued a reset code for user %s", adminID, userID)
	c.JSON(http.StatusOK, gin.H{
		"code":               code,
		"expires_at":         expiresAt,
		"expires_in_minutes": resetCodeTTLMinutes,
		"user_id":            userID,
		"identifier":         identifier,
		"message":            "Give this one-time code to the user over a verified channel. It expires shortly and works once.",
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetCodeTTLMinutes = 30

const recoveryCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// generateRecoveryCode returns a one-time code formatted as XXXXX-XXXXX.
func generateRecoveryCode() (string, error) {
	raw := make([]byte, 10)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	out := make([]byte, 0, 11)
	for i, b := range raw {
		if i == 5 {
			out = append(out, '-')
		}
		out = append(out, recoveryCodeAlphabet[int(b)%len(recoveryCodeAlphabet)])
	}
	return string(out), nil
}

func normalizeRecoveryCode(code string) string {
	replacer := strings.NewReplacer("-", "", " ", "", "\t", "")
	return strings.ToUpper(replacer.Replace(strings.TrimSpace(code)))
}

func (h *Handler) findActiveUser(ctx context.Context, identifier string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return "", sql.ErrNoRows
	}
	var userID string
	err := h.database.QueryRowContext(ctx, `
		SELECT user_id::text FROM users
		 WHERE is_active = true
		   AND (email_norm = LOWER($1) OR LOWER(email) = LOWER($1) OR phone_number = $1)
		 LIMIT 1`, identifier).Scan(&userID)
	return userID, err
}

// userTenant returns the user's first active school for support-ticket context.
// tenant_memberships is FORCE-RLS, so the query runs in a user-scoped tx.
func (h *Handler) userTenant(ctx context.Context, userID string) string {
	tx, err := h.database.BeginTxx(ctx, nil)
	if err != nil {
		return ""
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_user_id', $1, true)`, userID); err != nil {
		return ""
	}
	var tenant string
	_ = tx.QueryRowContext(ctx, `
		SELECT tenant_id FROM tenant_memberships
		 WHERE user_id = $1 AND status = 'ACTIVE'
		 ORDER BY created_at LIMIT 1`, userID).Scan(&tenant)
	return tenant
}

func (h *Handler) issueResetCode(ctx context.Context, userID, adminID string) (string, time.Time, error) {
	code, err := generateRecoveryCode()
	if err != nil {
		return "", time.Time{}, err
	}
	hash, err := HashPassword(normalizeRecoveryCode(code))
	if err != nil {
		return "", time.Time{}, err
	}
	expiresAt := time.Now().Add(resetCodeTTLMinutes * time.Minute)
	// Issuing a new code invalidates older outstanding codes for the account.
	_, _ = h.database.ExecContext(ctx,
		`UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID)
	if _, err := h.database.ExecContext(ctx, `
		INSERT INTO password_reset_codes (user_id, code_hash, expires_at, created_by)
		VALUES ($1, $2, $3, NULLIF($4, '')::uuid)`,
		userID, hash, expiresAt, adminID,
	); err != nil {
		return "", time.Time{}, err
	}
	return code, expiresAt, nil
}

func (h *Handler) completePasswordReset(ctx context.Context, userID, newPassword string) error {
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	if _, err := h.database.ExecContext(ctx, `
		UPDATE users
		   SET password_hash = $1, failed_login_count = 0, locked_until = NULL, updated_at = now()
		 WHERE user_id = $2`, hash, userID); err != nil {
		return err
	}
	_, _ = h.database.ExecContext(ctx,
		`UPDATE sessions SET revoked = true WHERE user_id = $1 AND revoked = false`, userID)
	_, _ = h.database.ExecContext(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	// A password change invalidates any outstanding one-time support codes.
	_, _ = h.database.ExecContext(ctx,
		`UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID)
	// Also resolve pending help requests immediately (the DB trigger is a
	// backstop for any other password update path).
	_, _ = h.database.ExecContext(ctx, `
		UPDATE password_assistance_requests
		   SET status = 'RESOLVED', resolved_at = now(),
		       resolution_method = COALESCE(NULLIF(resolution_method, ''), 'PASSWORD_CHANGED')
		 WHERE user_id = $1 AND status = 'PENDING'`, userID)
	return nil
}

func (h *Handler) recoveryLocked(ctx context.Context, userID string) bool {
	if h.redis == nil {
		return false
	}
	n, err := h.redis.Get(ctx, "rl:recovery:fail:"+userID).Int()
	return err == nil && n >= 5
}

func (h *Handler) noteRecoveryFailure(ctx context.Context, userID string) {
	if h.redis == nil {
		return
	}
	key := "rl:recovery:fail:" + userID
	n, err := h.redis.Incr(ctx, key).Result()
	if err == nil && n == 1 {
		h.redis.Expire(ctx, key, 15*time.Minute)
	}
}

func (h *Handler) clearRecoveryFailures(ctx context.Context, userID string) {
	if h.redis == nil {
		return
	}
	h.redis.Del(ctx, "rl:recovery:fail:"+userID)
}
