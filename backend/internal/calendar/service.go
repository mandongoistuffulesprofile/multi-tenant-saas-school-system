package calendar

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"kenyan-primary-saas/backend/internal/validation"
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

// AcademicYear
type AcademicYear struct {
	YearID    string `json:"year_id"`
	TenantID  string `json:"tenant_id"`
	YearLabel string `json:"year_label"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	IsCurrent bool   `json:"is_current"`
}

func (h *Handler) ListAcademicYears(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT year_id, tenant_id, year_label, start_date, end_date, is_current
		 FROM academic_years WHERE tenant_id = $1 ORDER BY year_label`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var years []AcademicYear
	for rows.Next() {
		var y AcademicYear
		if err := rows.Scan(&y.YearID, &y.TenantID, &y.YearLabel, &y.StartDate, &y.EndDate, &y.IsCurrent); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		years = append(years, y)
	}
	c.JSON(http.StatusOK, years)
}

func (h *Handler) CreateAcademicYear(c *gin.Context) {
	type CreateRequest struct {
		YearLabel string `json:"year_label" binding:"required"`
		StartDate string `json:"start_date" binding:"required"`
		EndDate   string `json:"end_date" binding:"required"`
		IsCurrent bool   `json:"is_current"`
	}
	var req CreateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	var yearID string
	err := h.service.database.QueryRow(
		`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
		 VALUES ($1, $2, $3, $4, $5) RETURNING year_id`,
		tenantID, req.YearLabel, req.StartDate, req.EndDate, req.IsCurrent,
	).Scan(&yearID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"year_id": yearID})
}

// Term
type Term struct {
	TermID       string `json:"term_id"`
	TenantID     string `json:"tenant_id"`
	YearID       string `json:"year_id"`
	TermNumber   int    `json:"term_number"`
	TermLabel    string `json:"term_label"`
	StartDate    string `json:"start_date"`
	EndDate      string `json:"end_date"`
	MidtermStart string `json:"midterm_start"`
	MidtermEnd   string `json:"midterm_end"`
	IsCurrent    bool   `json:"is_current"`
}

func (h *Handler) ListTerms(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	yearID := c.Query("year_id")

	// year_id is an optional filter; when omitted, list every term for the tenant.
	query := `SELECT term_id, tenant_id, year_id, term_number, term_label, start_date, end_date,
			midterm_start, midterm_end, is_current
		 FROM terms WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if yearID != "" {
		query += ` AND year_id = $2`
		args = append(args, yearID)
	}
	query += ` ORDER BY term_number`

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	terms := make([]Term, 0)
	for rows.Next() {
		var t Term
		// midterm_start and midterm_end are nullable.
		var midtermStart, midtermEnd sql.NullString
		if err := rows.Scan(&t.TermID, &t.TenantID, &t.YearID, &t.TermNumber, &t.TermLabel,
			&t.StartDate, &t.EndDate, &midtermStart, &midtermEnd, &t.IsCurrent); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		t.MidtermStart = midtermStart.String
		t.MidtermEnd = midtermEnd.String
		terms = append(terms, t)
	}
	c.JSON(http.StatusOK, terms)
}

func (h *Handler) CreateTerm(c *gin.Context) {
	type CreateRequest struct {
		YearID       string `json:"year_id" binding:"required"`
		TermNumber   int    `json:"term_number" binding:"required"`
		TermLabel    string `json:"term_label" binding:"required"`
		StartDate    string `json:"start_date" binding:"required"`
		EndDate      string `json:"end_date" binding:"required"`
		MidtermStart string `json:"midterm_start"`
		MidtermEnd   string `json:"midterm_end"`
		IsCurrent    bool   `json:"is_current"`
	}
	var req CreateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	var termID string
	err := h.service.database.QueryRow(
		`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date,
			midterm_start, midterm_end, is_current)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING term_id`,
		tenantID, req.YearID, req.TermNumber, req.TermLabel, req.StartDate, req.EndDate,
		req.MidtermStart, req.MidtermEnd, req.IsCurrent,
	).Scan(&termID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"term_id": termID})
}

// ExamWindow
type ExamWindow struct {
	WindowID    string `json:"window_id"`
	TenantID    string `json:"tenant_id"`
	ExamType    string `json:"exam_type"`
	WindowLabel string `json:"window_label"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
}

func (h *Handler) ListExamWindows(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rows, err := h.service.database.Query(
		`SELECT window_id, tenant_id, exam_type, window_label, start_date, end_date
		 FROM exam_windows WHERE tenant_id = $1 ORDER BY start_date`,
		tenantID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	var windows []ExamWindow
	for rows.Next() {
		var w ExamWindow
		if err := rows.Scan(&w.WindowID, &w.TenantID, &w.ExamType, &w.WindowLabel, &w.StartDate, &w.EndDate); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		windows = append(windows, w)
	}
	c.JSON(http.StatusOK, windows)
}

func (h *Handler) CreateExamWindow(c *gin.Context) {
	type CreateRequest struct {
		ExamType    string `json:"exam_type" binding:"required"`
		WindowLabel string `json:"window_label" binding:"required"`
		StartDate   string `json:"start_date" binding:"required"`
		EndDate     string `json:"end_date" binding:"required"`
	}
	var req CreateRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}

	tenantID := c.GetString("tenant_id")
	var windowID string
	err := h.service.database.QueryRow(
		`INSERT INTO exam_windows (tenant_id, exam_type, window_label, start_date, end_date)
		 VALUES ($1, $2, $3, $4, $5) RETURNING window_id`,
		tenantID, req.ExamType, req.WindowLabel, req.StartDate, req.EndDate,
	).Scan(&windowID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"window_id": windowID})
}

var _ = http.StatusOK
