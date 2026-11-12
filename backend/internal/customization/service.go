// Package customization holds the tenant-owned dictionaries that vary between
// Kenyan schools: transport zones and school-specific CBC learning areas
// (electives such as French, Coding or Music). Standard fee categories and the
// published CBC catalogue stay in finance and curriculum respectively.
package customization

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

type Service struct{}

func NewService() *Service {
	return &Service{}
}

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func noTenantTx(c *gin.Context) bool {
	if middleware.TxFromGin(c) == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return true
	}
	return false
}

func isUniqueViolation(err error) bool {
	var pgErr *pq.Error
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// ============ Transport zones ============

type TransportZone struct {
	ZoneID       string  `json:"zone_id"`
	TenantID     string  `json:"tenant_id,omitempty"`
	ZoneName     string  `json:"zone_name" binding:"required,max=100"`
	PickupPoints string  `json:"pickup_points"`
	TwoWayFee    float64 `json:"two_way_fee"`
	OneWayFee    float64 `json:"one_way_fee"`
	IsActive     bool    `json:"is_active"`
	CreatedAt    string  `json:"created_at,omitempty"`
	UpdatedAt    string  `json:"updated_at,omitempty"`
}

type transportZoneRequest struct {
	ZoneName     string  `json:"zone_name" binding:"required,max=100"`
	PickupPoints string  `json:"pickup_points"`
	TwoWayFee    float64 `json:"two_way_fee"`
	OneWayFee    float64 `json:"one_way_fee"`
	IsActive     *bool   `json:"is_active"`
}

func (r *transportZoneRequest) normalise() []validation.FieldError {
	var errs []validation.FieldError
	r.ZoneName = strings.TrimSpace(r.ZoneName)
	if r.ZoneName == "" {
		errs = append(errs, validation.FieldError{Field: "zone_name", Code: "REQUIRED", Message: "'zone_name' is required"})
	}
	if r.TwoWayFee < 0 || r.OneWayFee < 0 {
		errs = append(errs, validation.FieldError{
			Field: "one_way_fee", Code: "INVALID_VALUE",
			Message: "transport fees cannot be negative",
		})
	}
	return errs
}

func (h *Handler) ListTransportZones(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	query := `SELECT id, zone_name, COALESCE(pickup_points, ''), two_way_fee, one_way_fee,
			is_active, created_at, updated_at
		FROM transport_zones WHERE tenant_id = $1`
	if c.Query("include_inactive") != "true" {
		query += ` AND is_active = true`
	}
	query += ` ORDER BY zone_name`

	rows, err := tx.Query(query, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	zones := make([]TransportZone, 0)
	for rows.Next() {
		var z TransportZone
		z.TenantID = tenantID
		if err := rows.Scan(&z.ZoneID, &z.ZoneName, &z.PickupPoints, &z.TwoWayFee,
			&z.OneWayFee, &z.IsActive, &z.CreatedAt, &z.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		zones = append(zones, z)
	}
	c.JSON(http.StatusOK, zones)
}

func (h *Handler) CreateTransportZone(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	var req transportZoneRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}

	var zoneID string
	err := tx.QueryRow(
		`INSERT INTO transport_zones (tenant_id, zone_name, pickup_points, two_way_fee, one_way_fee, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		tenantID, req.ZoneName, nullIfEmpty(req.PickupPoints), req.TwoWayFee, req.OneWayFee, active,
	).Scan(&zoneID)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "A transport zone with this name already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"zone_id": zoneID})
}

func (h *Handler) UpdateTransportZone(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	var req transportZoneRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	zoneID := c.Param("id")
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}

	result, err := tx.Exec(
		`UPDATE transport_zones
		 SET zone_name = $1, pickup_points = $2, two_way_fee = $3, one_way_fee = $4,
		     is_active = $5, updated_at = now()
		 WHERE id = $6 AND tenant_id = $7`,
		req.ZoneName, nullIfEmpty(req.PickupPoints), req.TwoWayFee, req.OneWayFee,
		active, zoneID, tenantID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "A transport zone with this name already exists")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Transport zone not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"zone_id": zoneID})
}

// DeleteTransportZone deactivates the zone. Learners keep their history; the
// composite FK only prevents deleting a zone that is still assigned.
func (h *Handler) DeleteTransportZone(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	zoneID := c.Param("id")

	result, err := tx.Exec(
		`UPDATE transport_zones SET is_active = false, updated_at = now()
		 WHERE id = $1 AND tenant_id = $2`, zoneID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Transport zone not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"zone_id": zoneID, "message": "Transport zone deactivated"})
}

// ============ Tenant learning areas ============

type TenantLearningArea struct {
	AreaID          string `json:"area_id"`
	TenantID        string `json:"tenant_id,omitempty"`
	GradeTier       string `json:"grade_tier"`
	Name            string `json:"name"`
	Code            string `json:"code"`
	IsElective      bool   `json:"is_elective"`
	IsActive        bool   `json:"is_active"`
	KNECSubjectCode string `json:"knec_subject_code,omitempty"`
	CreatedAt       string `json:"created_at,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

type learningAreaRequest struct {
	GradeTier       string `json:"grade_tier" binding:"required"`
	Name            string `json:"name" binding:"required,max=100"`
	Code            string `json:"code" binding:"required,max=20"`
	IsElective      bool   `json:"is_elective"`
	IsActive        *bool  `json:"is_active"`
	KNECSubjectCode string `json:"knec_subject_code"`
}

var (
	gradeTiers = map[string]struct{}{
		"PRE_PRIMARY": {}, "LOWER_PRIMARY": {}, "UPPER_PRIMARY": {}, "JUNIOR_SCHOOL": {},
	}
	learningAreaCodePattern = regexp.MustCompile(`^[A-Z0-9_]{2,20}$`)
)

func (r *learningAreaRequest) normalise() []validation.FieldError {
	var errs []validation.FieldError
	r.GradeTier = strings.ToUpper(strings.TrimSpace(r.GradeTier))
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	r.Name = strings.TrimSpace(r.Name)
	r.KNECSubjectCode = strings.ToUpper(strings.TrimSpace(r.KNECSubjectCode))

	if _, ok := gradeTiers[r.GradeTier]; !ok {
		errs = append(errs, validation.FieldError{
			Field: "grade_tier", Code: "INVALID_VALUE",
			Message: "grade_tier must be PRE_PRIMARY, LOWER_PRIMARY, UPPER_PRIMARY or JUNIOR_SCHOOL",
		})
	}
	if !learningAreaCodePattern.MatchString(r.Code) {
		errs = append(errs, validation.FieldError{
			Field: "code", Code: "INVALID_VALUE",
			Message: "code must be 2-20 characters using letters, digits or underscores",
		})
	}
	if r.Name == "" {
		errs = append(errs, validation.FieldError{Field: "name", Code: "REQUIRED", Message: "'name' is required"})
	}
	return errs
}

func (h *Handler) ListTenantLearningAreas(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	query := `SELECT id, grade_tier, name, code, is_elective, is_active,
			COALESCE(knec_subject_code, ''), created_at, updated_at
		FROM tenant_learning_areas WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if tier := strings.ToUpper(strings.TrimSpace(c.Query("grade_tier"))); tier != "" {
		query += ` AND grade_tier = $2`
		args = append(args, tier)
	}
	if c.Query("include_inactive") != "true" {
		query += ` AND is_active = true`
	}
	query += ` ORDER BY grade_tier, is_elective, name`

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	areas := make([]TenantLearningArea, 0)
	for rows.Next() {
		var a TenantLearningArea
		a.TenantID = tenantID
		if err := rows.Scan(&a.AreaID, &a.GradeTier, &a.Name, &a.Code, &a.IsElective,
			&a.IsActive, &a.KNECSubjectCode, &a.CreatedAt, &a.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		areas = append(areas, a)
	}
	c.JSON(http.StatusOK, areas)
}

func (h *Handler) CreateTenantLearningArea(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	var req learningAreaRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}

	var areaID string
	err := tx.QueryRow(
		`INSERT INTO tenant_learning_areas
		 (tenant_id, grade_tier, name, code, is_elective, is_active, knec_subject_code)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		tenantID, req.GradeTier, req.Name, req.Code, req.IsElective, active,
		nullIfEmpty(req.KNECSubjectCode),
	).Scan(&areaID)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "This learning area already exists for that grade tier")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"area_id": areaID})
}

func (h *Handler) UpdateTenantLearningArea(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	var req learningAreaRequest
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if errs := req.normalise(); len(errs) > 0 {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	areaID := c.Param("id")
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}

	result, err := tx.Exec(
		`UPDATE tenant_learning_areas
		 SET grade_tier = $1, name = $2, code = $3, is_elective = $4,
		     is_active = $5, knec_subject_code = $6, updated_at = now()
		 WHERE id = $7 AND tenant_id = $8`,
		req.GradeTier, req.Name, req.Code, req.IsElective, active,
		nullIfEmpty(req.KNECSubjectCode), areaID, tenantID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			validation.Conflict(c, "This learning area already exists for that grade tier")
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Learning area not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"area_id": areaID})
}

func (h *Handler) DeleteTenantLearningArea(c *gin.Context) {
	if noTenantTx(c) {
		return
	}
	tx := middleware.TxFromGin(c)
	tenantID := c.GetString("tenant_id")
	areaID := c.Param("id")

	result, err := tx.Exec(
		`UPDATE tenant_learning_areas SET is_active = false, updated_at = now()
		 WHERE id = $1 AND tenant_id = $2`, areaID, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		validation.NotFound(c, "Learning area not found")
		return
	}
	c.JSON(http.StatusOK, gin.H{"area_id": areaID, "message": "Learning area deactivated"})
}

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}

var _ = sql.ErrNoRows
