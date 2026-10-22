package staff

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"kenyan-primary-saas/backend/internal/validation"
	"golang.org/x/crypto/argon2"
	"kenyan-primary-saas/backend/internal/db"
)

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
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
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT tm.membership_id, tm.user_id, u.email, u.phone_number, tm.role, tm.status,
			sp.tsc_number, sp.national_id, sp.subjects, sp.employment_date
		 FROM tenant_memberships tm
		 JOIN users u ON tm.user_id = u.user_id
		 LEFT JOIN staff_profiles sp ON sp.membership_id = tm.membership_id
		 WHERE tm.tenant_id = $1 ORDER BY tm.created_at`,
		tenantID,
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

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("current_user_id")

	tx, err := h.service.database.BeginTenantTx(tenantID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to begin transaction"})
		return
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	// Check if user exists by email/phone
	var userIDExists string
	err = tx.QueryRow(
		`SELECT user_id FROM users WHERE email = $1 OR phone_number = $2`,
		req.Email, req.PhoneNumber,
	).Scan(&userIDExists)

	if err != nil && err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to check existing user"})
		return
	}

	if err == sql.ErrNoRows {
		// Create new user with invite-only status; password set on first login
	inviteHash, err := hashInviteToken()
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

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to commit staff creation"})
		return
	}

	// Send invitation (stub)
	// TODO: Integrate with SMS/email provider

	c.JSON(http.StatusCreated, gin.H{"membership_id": membershipID, "user_id": userID})
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

func hashInviteToken() (string, error) {
	token := generateInviteToken()
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey(
		[]byte(token),
		salt,
		3,
		64*1024,
		4,
		32,
	)
	return hex.EncodeToString(salt) + ":" + hex.EncodeToString(hash), nil
}

var _ = http.StatusOK
