package curriculum

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
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

// CurriculumVersion
type CurriculumVersion struct {
	VersionID     string `json:"version_id"`
	VersionLabel  string `json:"version_label"`
	Description   string `json:"description,omitempty"`
	IsPublished   bool   `json:"is_published"`
	EffectiveFrom string `json:"effective_from,omitempty"`
	EffectiveTo   string `json:"effective_to,omitempty"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

func (h *Handler) ListCurriculumVersions(c *gin.Context) {
	rows, err := h.service.database.Query(
		`SELECT version_id, version_label, description, is_published,
			effective_from, effective_to, created_at, updated_at
		 FROM curriculum_versions ORDER BY created_at DESC`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	versions := make([]CurriculumVersion, 0)
	for rows.Next() {
		var v CurriculumVersion
		// description, effective_from and effective_to are all nullable.
		var description, effectiveFrom, effectiveTo sql.NullString
		if err := rows.Scan(&v.VersionID, &v.VersionLabel, &description, &v.IsPublished,
			&effectiveFrom, &effectiveTo, &v.CreatedAt, &v.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		v.Description = description.String
		v.EffectiveFrom = effectiveFrom.String
		v.EffectiveTo = effectiveTo.String
		versions = append(versions, v)
	}
	c.JSON(http.StatusOK, versions)
}

func (h *Handler) GetCurriculumVersion(c *gin.Context) {
	versionID := c.Param("version_id")
	var v CurriculumVersion
	err := h.service.database.QueryRow(
		`SELECT version_id, version_label, description, is_published,
			effective_from, effective_to, created_at, updated_at
		 FROM curriculum_versions WHERE version_id = $1`,
		versionID,
	).Scan(&v.VersionID, &v.VersionLabel, &v.Description, &v.IsPublished,
		&v.EffectiveFrom, &v.EffectiveTo, &v.CreatedAt, &v.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "Curriculum version not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// LearningArea
type LearningArea struct {
	AreaID      string `json:"area_id"`
	VersionID   string `json:"version_id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	GradeBand   string `json:"grade_band,omitempty"`
	SortOrder   int    `json:"sort_order"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (h *Handler) ListLearningAreas(c *gin.Context) {
	versionID := c.Query("version_id")

	// version_id is an optional filter: when it is omitted we return every
	// learning area rather than passing an empty string to a uuid column.
	query := `SELECT area_id, version_id, code, name, description, grade_band, sort_order,
			created_at, updated_at
		 FROM learning_areas`
	args := []interface{}{}
	if versionID != "" {
		query += ` WHERE version_id = $1`
		args = append(args, versionID)
	}
	query += ` ORDER BY sort_order`

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	areas := make([]LearningArea, 0)
	for rows.Next() {
		var a LearningArea
		var description, gradeBand sql.NullString
		if err := rows.Scan(&a.AreaID, &a.VersionID, &a.Code, &a.Name, &description,
			&gradeBand, &a.SortOrder, &a.CreatedAt, &a.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		a.Description = description.String
		a.GradeBand = gradeBand.String
		areas = append(areas, a)
	}
	c.JSON(http.StatusOK, areas)
}

// Strand
type Strand struct {
	StrandID    string `json:"strand_id"`
	AreaID      string `json:"area_id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	SortOrder   int    `json:"sort_order"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (h *Handler) ListStrands(c *gin.Context) {
	areaID := c.Query("area_id")

	// area_id is an optional filter; omit it to list every strand.
	query := `SELECT strand_id, area_id, code, name, description, sort_order,
			created_at, updated_at
		 FROM strands`
	args := []interface{}{}
	if areaID != "" {
		query += ` WHERE area_id = $1`
		args = append(args, areaID)
	}
	query += ` ORDER BY sort_order`

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	strands := make([]Strand, 0)
	for rows.Next() {
		var s Strand
		var description sql.NullString
		if err := rows.Scan(&s.StrandID, &s.AreaID, &s.Code, &s.Name, &description,
			&s.SortOrder, &s.CreatedAt, &s.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		s.Description = description.String
		strands = append(strands, s)
	}
	c.JSON(http.StatusOK, strands)
}

// SubStrand
type SubStrand struct {
	SubStrandID string `json:"sub_strand_id"`
	StrandID    string `json:"strand_id"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	SortOrder   int    `json:"sort_order"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func (h *Handler) ListSubStrands(c *gin.Context) {
	strandID := c.Query("strand_id")

	// strand_id is an optional filter; omit it to list every sub-strand.
	query := `SELECT sub_strand_id, strand_id, code, name, description, sort_order,
			created_at, updated_at
		 FROM sub_strands`
	args := []interface{}{}
	if strandID != "" {
		query += ` WHERE strand_id = $1`
		args = append(args, strandID)
	}
	query += ` ORDER BY sort_order`

	rows, err := h.service.database.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	subStrands := make([]SubStrand, 0)
	for rows.Next() {
		var s SubStrand
		var description sql.NullString
		if err := rows.Scan(&s.SubStrandID, &s.StrandID, &s.Code, &s.Name, &description,
			&s.SortOrder, &s.CreatedAt, &s.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		s.Description = description.String
		subStrands = append(subStrands, s)
	}
	c.JSON(http.StatusOK, subStrands)
}

// TenantCurriculumPin
type TenantCurriculumPin struct {
	PinID     string `json:"pin_id"`
	TenantID  string `json:"tenant_id"`
	VersionID string `json:"version_id"`
	PinnedBy  string `json:"pinned_by,omitempty"`
	PinnedAt  string `json:"pinned_at,omitempty"`
}

func (h *Handler) GetTenantCurriculumPin(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var pin TenantCurriculumPin
	err := h.service.database.QueryRow(
		`SELECT pin_id, tenant_id, version_id, pinned_by, pinned_at
		 FROM tenant_curriculum_pins WHERE tenant_id = $1`,
		tenantID,
	).Scan(&pin.PinID, &pin.TenantID, &pin.VersionID, &pin.PinnedBy, &pin.PinnedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"code": "NOT_FOUND", "message": "No curriculum pin found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, pin)
}

func (h *Handler) SetTenantCurriculumPin(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var pin TenantCurriculumPin
	if errs := validation.BindJSON(c, &pin); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	err := h.service.database.QueryRow(
		`INSERT INTO tenant_curriculum_pins (tenant_id, version_id)
		 VALUES ($1, $2)
		 ON CONFLICT (tenant_id) DO UPDATE SET version_id = EXCLUDED.version_id,
		 pinned_at = CURRENT_TIMESTAMP
		 RETURNING pin_id, pinned_at`,
		tenantID, pin.VersionID,
	).Scan(&pin.PinID, &pin.PinnedAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	pin.TenantID = tenantID
	c.JSON(http.StatusOK, pin)
}

var _ = http.StatusOK
