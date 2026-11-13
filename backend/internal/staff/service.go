package staff

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/sms"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type Handler struct {
	service    *Service
	smsService *sms.SMSService
}

func NewHandler(service *Service, smsService *sms.SMSService) *Handler {
	return &Handler{
		service:    service,
		smsService: smsService,
	}
}

// StaffProfile
type StaffProfile struct {
	ProfileID      string   `json:"profile_id"`
	MembershipID   string   `json:"membership_id"`
	TSCNumber      string   `json:"tsc_number"`
	NationalID     string   `json:"national_id"`
	Subjects       []string `json:"subjects"`
	EmploymentDate string   `json:"employment_date"`
}

func (h *Handler) ListStaff(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	rows, err := tx.Query(
		`SELECT tm.membership_id, tm.user_id, u.email, u.phone_number, tm.role, tm.status,
			sp.tsc_number, sp.national_id, sp.subjects, sp.employment_date
		 FROM tenant_memberships tm
		 JOIN users u ON tm.user_id = u.user_id
		 LEFT JOIN staff_profiles sp ON sp.membership_id = tm.membership_id
		 WHERE tm.tenant_id = $1 ORDER BY tm.created_at`,
		c.GetString("tenant_id"),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type StaffRow struct {
		MembershipID   string   `json:"membership_id"`
		UserID         string   `json:"user_id"`
		Email          string   `json:"email"`
		PhoneNumber    string   `json:"phone_number"`
		Role           string   `json:"role"`
		Status         string   `json:"status"`
		TSCNumber      string   `json:"tsc_number"`
		NationalID     string   `json:"national_id"`
		Subjects       []string `json:"subjects"`
		EmploymentDate string   `json:"employment_date"`
	}
	// Initialise as an empty slice so an empty result serialises to [] not null.
	staff := make([]StaffRow, 0)
	for rows.Next() {
		var s StaffRow
		// LEFT JOINs make every staff_profiles column nullable, and users.phone_number
		// is nullable too — scan into sql.NullString to avoid scan errors.
		var email, phone, tsc, nationalID, employmentDate sql.NullString
		var subjects []byte
		if err := rows.Scan(&s.MembershipID, &s.UserID, &email, &phone,
			&s.Role, &s.Status, &tsc, &nationalID, &subjects, &employmentDate); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		s.Email = email.String
		s.PhoneNumber = phone.String
		s.TSCNumber = tsc.String
		s.NationalID = nationalID.String
		s.EmploymentDate = employmentDate.String

		// subjects is a JSONB array; it may be NULL or empty.
		s.Subjects = []string{}
		if len(subjects) > 0 {
			_ = json.Unmarshal(subjects, &s.Subjects)
			if s.Subjects == nil {
				s.Subjects = []string{}
			}
		}
		staff = append(staff, s)
	}
	c.JSON(http.StatusOK, staff)
}

func (h *Handler) CreateStaff(c *gin.Context) {
	type CreateRequest struct {
		Email          string   `json:"email" binding:"required"`
		PhoneNumber    string   `json:"phone_number" binding:"required"`
		Role           string   `json:"role" binding:"required"` // HEAD, DEPUTY, BURSAR, CLERK, TEACHER
		TSCNumber      string   `json:"tsc_number"`
		Subjects       []string `json:"subjects"`
		EmploymentDate string   `json:"employment_date"`
	}
	var req CreateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// Allowlist of staff roles a school admin may assign.
	allowedRoles := map[string]bool{"HEAD": true, "DEPUTY": true, "BURSAR": true, "CLERK": true, "TEACHER": true}
	if !allowedRoles[req.Role] {
		validation.BadRequest(c, "Invalid role", nil)
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("current_user_id")

	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}

	// Check if user exists by email/phone
	var userIDExists string
	err := tx.QueryRow(
		`SELECT user_id FROM users WHERE email = $1 OR phone_number = $2`,
		req.Email, req.PhoneNumber,
	).Scan(&userIDExists)

	if err != nil && err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to check existing user"})
		return
	}

	// Generate a single-use invite token before branching on new vs existing user.
	inviteToken := generateInviteToken()

	if err == sql.ErrNoRows {
		// Create new user with invite-only status; password set on first login
		inviteHash, err := hashInviteToken(inviteToken)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to generate invite hash"})
			return
		}
		err = tx.QueryRow(
			`INSERT INTO users (email, phone_number, password_hash, status)
			 VALUES ($1, $2, $3, 'INVITE_PENDING') RETURNING user_id`,
			req.Email, req.PhoneNumber, inviteHash,
		).Scan(&userIDExists)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to create user"})
			return
		}
	} else {
		// Existing user: re-issue a fresh invite token for this membership.
		inviteHash, err := hashInviteToken(inviteToken)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to generate invite hash"})
			return
		}
		_, err = tx.Exec(
			`UPDATE users SET password_hash = $1, status = 'INVITE_PENDING' WHERE user_id = $2`,
			inviteHash, userID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to reissue invite"})
			return
		}
		_ = inviteHash
	}
	userID = userIDExists

	// Create membership
	var membershipID string
	err = tx.QueryRow(
		`INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
		 VALUES ($1, $2, $3, 'ACTIVE') RETURNING membership_id`,
		userID, tenantID, req.Role,
	).Scan(&membershipID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to create membership"})
		return
	}

	// Create staff profile
	subjectsJSON, err := json.Marshal(req.Subjects)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to encode subjects"})
		return
	}
	_, err = tx.Exec(
		`INSERT INTO staff_profiles (membership_id, tsc_number, subjects, employment_date)
		 VALUES ($1, $2, $3, $4)`,
		membershipID, nullIfEmpty(req.TSCNumber), string(subjectsJSON), nullIfEmpty(req.EmploymentDate),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to create staff profile"})
		return
	}

	// Persist the single-use invite token (expires in 7 days) and deliver it
	// to the invitee via SMS. The plaintext token is never stored — only its
	// SHA-256 hash — so it can only be used by the recipient who receives it.
	inviteHash, err := hashInviteToken(inviteToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to hash invite token"})
		return
	}
	_, err = tx.Exec(
		`INSERT INTO invite_tokens (user_id, tenant_id, token_hash, expires_at, created_by_ip)
		 VALUES ($1, $2, $3, now() + interval '7 days', $4)`,
		userID, tenantID, inviteHash, c.ClientIP(),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to persist invite token"})
		return
	}

	// Send the invite token via SMS (non-blocking; Africa's Talking logs in dev
	// mode when no credentials are configured).
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		msg := fmt.Sprintf(
			"You have been invited to join %s at %s. Use this invite code to set your password: %s. It expires in 7 days.",
			tenantID, req.Role, inviteToken,
		)
		if h.smsService != nil {
			_ = h.smsService.SendSMS(ctx, req.PhoneNumber, msg)
		}
	}()

	c.JSON(http.StatusCreated, gin.H{
		"membership_id": membershipID,
		"user_id":       userID,
		"invite_token":  inviteToken,
	})
}

// nullIfEmpty converts an empty string to nil so optional columns (dates in
// particular) are stored as NULL instead of failing PostgreSQL's cast.
func nullIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func generateInviteToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashInviteToken(token string) (string, error) {
	b := sha256.Sum256([]byte(token))
	return hex.EncodeToString(b[:]), nil
}

func (h *Handler) UpdateStaff(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	membershipID := c.Param("id")
	tenantID := c.GetString("tenant_id")

	var req struct {
		Role           string   `json:"role"`
		TSCNumber      string   `json:"tsc_number"`
		Subjects       []string `json:"subjects"`
		EmploymentDate string   `json:"employment_date"`
		Status         string   `json:"status"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	// Check membership exists and belongs to this tenant
	var exists bool
	err := tx.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM tenant_memberships WHERE membership_id = $1 AND tenant_id = $2)`,
		membershipID, tenantID).Scan(&exists)
	if err != nil || !exists {
		validation.NotFound(c, "Staff member not found")
		return
	}

	// Validate role if provided
	if req.Role != "" {
		allowedRoles := map[string]bool{"HEAD": true, "DEPUTY": true, "BURSAR": true, "CLERK": true, "TEACHER": true}
		if !allowedRoles[req.Role] {
			validation.BadRequest(c, "Invalid role", []validation.FieldError{
				{Field: "role", Code: "INVALID_VALUE", Message: "role must be one of: HEAD, DEPUTY, BURSAR, CLERK, TEACHER"},
			})
			return
		}
	}

	// Build dynamic update query
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1

	if req.Role != "" {
		setParts = append(setParts, fmt.Sprintf("role = $%d", argIndex))
		args = append(args, req.Role)
		argIndex++
	}
	if req.TSCNumber != "" {
		setParts = append(setParts, fmt.Sprintf("tsc_number = $%d", argIndex))
		args = append(args, req.TSCNumber)
		argIndex++
	}
	if req.Subjects != nil {
		subjectsJSON, err := json.Marshal(req.Subjects)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "SERVER_ERROR", "message": "Failed to encode subjects"})
			return
		}
		setParts = append(setParts, fmt.Sprintf("subjects = $%d", argIndex))
		args = append(args, string(subjectsJSON))
		argIndex++
	}
	if req.EmploymentDate != "" {
		setParts = append(setParts, fmt.Sprintf("employment_date = $%d", argIndex))
		args = append(args, req.EmploymentDate)
		argIndex++
	}
	if req.Status != "" {
		setParts = append(setParts, fmt.Sprintf("status = $%d", argIndex))
		args = append(args, req.Status)
		argIndex++
	}

	if len(setParts) == 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "body", Code: "REQUIRED", Message: "provide at least one field to update"},
		})
		return
	}

	setParts = append(setParts, fmt.Sprintf("updated_at = now()"))
	args = append(args, membershipID, tenantID)

	query := fmt.Sprintf(
		`UPDATE staff_profiles SET %s WHERE membership_id = $%d AND tenant_id = $%d`,
		strings.Join(setParts, ", "), argIndex, argIndex+1,
	)

	if _, err := tx.Exec(query, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// If role changed, also update tenant_memberships
	if req.Role != "" {
		_, _ = tx.Exec(
			`UPDATE tenant_memberships SET role = $1 WHERE membership_id = $2 AND tenant_id = $3`,
			req.Role, membershipID, tenantID,
		)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Staff updated"})
}

func (h *Handler) DeleteStaff(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	membershipID := c.Param("id")
	tenantID := c.GetString("tenant_id")

	// Check membership exists and belongs to this tenant
	var exists bool
	err := tx.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM tenant_memberships WHERE membership_id = $1 AND tenant_id = $2)`,
		membershipID, tenantID).Scan(&exists)
	if err != nil || !exists {
		validation.NotFound(c, "Staff member not found")
		return
	}

	// Soft delete: mark membership as INACTIVE
	_, err = tx.Exec(
		`UPDATE tenant_memberships SET status = 'INACTIVE' WHERE membership_id = $1 AND tenant_id = $2`,
		membershipID, tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Staff member deactivated"})
}

var _ = http.StatusOK
