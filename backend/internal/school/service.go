package school

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// GetSchoolResponse is the JSON-safe response shape — sql.NullString fields
// are coerced to plain strings so React doesn't receive {String, Valid} objects.
type GetSchoolResponse struct {
	TenantID         string  `json:"tenant_id"`
	SchoolName       string  `json:"school_name"`
	Subdomain        string  `json:"subdomain"`
	KNECCODE         *string `json:"knec_code"`
	KEMISCode        *string `json:"kemis_code"`
	SchoolType       string  `json:"school_type"`
	FundingMode      string  `json:"funding_mode"`
	County           *string `json:"county"`
	SubCounty        *string `json:"sub_county"`
	Address          *string `json:"address"`
	LogoRef          *string `json:"logo_ref"`
	StampRef         *string `json:"stamp_ref"`
	HeadSignatureRef *string `json:"head_signature_ref"`
	DefaultLocale    string  `json:"default_locale"`
	HostsJunior      bool    `json:"hosts_junior"`
	LicenseTier      string  `json:"license_tier"`
	Status           string  `json:"status"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

func nullStringPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type Service struct {
	database *db.DB
}

func NewService(database *db.DB) *Service {
	return &Service{database: database}
}

func (s *Service) GetSchool(ctx context.Context, tenantID string) (*GetSchoolResponse, error) {
	var q queryer = s.database
	if t := middleware.TxFromContext(ctx); t != nil { q = t }
	var tid string
	var schoolName string
	var subdomain string
	var knecCode sql.NullString
	var kemisCode sql.NullString
	var schoolType string
	var fundingMode string
	var county sql.NullString
	var subCounty sql.NullString
	var address sql.NullString
	var logoRef sql.NullString
	var stampRef sql.NullString
	var headSignatureRef sql.NullString
	var defaultLocale string
	var hostsJunior bool
	var licenseTier string
	var status string
	var createdAt string
	var updatedAt string

	err := q.QueryRow(
		`SELECT tenant_id, school_name, subdomain, knec_code, kemis_code, school_type,
			funding_mode, county, sub_county, address, logo_ref, stamp_ref,
			head_signature_ref, default_locale, hosts_junior, license_tier, status,
			created_at, updated_at
		 FROM schools WHERE tenant_id = $1`,
		tenantID,
	).Scan(
		&tid, &schoolName, &subdomain, &knecCode, &kemisCode,
		&schoolType, &fundingMode, &county, &subCounty, &address,
		&logoRef, &stampRef, &headSignatureRef, &defaultLocale, &hostsJunior,
		&licenseTier, &status, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &GetSchoolResponse{
		TenantID:         tid,
		SchoolName:       schoolName,
		Subdomain:        subdomain,
		KNECCODE:         nullStringPtr(knecCode),
		KEMISCode:        nullStringPtr(kemisCode),
		SchoolType:       schoolType,
		FundingMode:      fundingMode,
		County:           nullStringPtr(county),
		SubCounty:        nullStringPtr(subCounty),
		Address:          nullStringPtr(address),
		LogoRef:          nullStringPtr(logoRef),
		StampRef:         nullStringPtr(stampRef),
		HeadSignatureRef: nullStringPtr(headSignatureRef),
		DefaultLocale:    defaultLocale,
		HostsJunior:      hostsJunior,
		LicenseTier:      licenseTier,
		Status:           status,
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

var updatableSchoolFields = map[string]struct{}{
	"school_name":        {},
	"subdomain":          {},
	"school_type":        {},
	"funding_mode":       {},
	"county":             {},
	"sub_county":         {},
	"address":            {},
	"logo_ref":           {},
	"stamp_ref":          {},
	"head_signature_ref": {},
	"default_locale":     {},
	"hosts_junior":       {},
	"license_tier":       {},
	"status":             {},
}

func (s *Service) UpdateSchool(tenantID string, updates map[string]interface{}) (*GetSchoolResponse, error) {
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1

	for key, val := range updates {
		if key == "tenant_id" || key == "created_at" || key == "updated_at" {
			continue
		}
		if _, ok := updatableSchoolFields[key]; !ok {
			continue
		}
		setParts = append(setParts, fmt.Sprintf("%s = $%d", key, argIndex))
		args = append(args, val)
		argIndex++
	}

	if len(setParts) == 0 {
		return nil, fmt.Errorf("no updatable fields provided")
	}

	setParts = append(setParts, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, tenantID)

	query := fmt.Sprintf(
		`UPDATE schools SET %s WHERE tenant_id = $%d RETURNING tenant_id, school_name, subdomain, school_type, funding_mode, status`,
		strings.Join(setParts, ", "), argIndex,
	)

	var tid, schoolName, subdomain, schoolType, fundingMode, status string
	err := s.database.QueryRow(query, args...).Scan(
		&tid, &schoolName, &subdomain, &schoolType, &fundingMode, &status,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update school: %w", err)
	}

	return &GetSchoolResponse{
		TenantID:    tid,
		SchoolName:  schoolName,
		Subdomain:   subdomain,
		SchoolType:  schoolType,
		FundingMode: fundingMode,
		Status:      status,
	}, nil
}

// PaymentChannel represents a M-Pesa/payment channel for a school
type PaymentChannel struct {
	ChannelID           string   `json:"channel_id"`
	TenantID            string   `json:"tenant_id"`
	ChannelType         string   `json:"channel_type"` // PAYBILL, TILL, BANK
	ShortcodeOrAccount  string   `json:"shortcode_or_account"`
	Label               string   `json:"label"`
	Environment         string   `json:"environment"`
	IsDefault           bool     `json:"is_default"`
	Status              string   `json:"status"`
	ReferenceFormat     string   `json:"reference_format"`
	RoutedFeeCategories []string `json:"routed_fee_categories"`
	ChannelToken        string   `json:"channel_token"`
	C2BRegistered       bool     `json:"c2b_registered"`
	CreatedAt           string   `json:"created_at"`
}

func (s *Service) ListPaymentChannels(tenantID string) ([]PaymentChannel, error) {
	rows, err := s.database.Query(
		`SELECT channel_id, tenant_id, channel_type, shortcode_or_account, label,
			environment, is_default, status, reference_format,
			routed_fee_categories, channel_token, c2b_registered, created_at
		 FROM school_payment_channels WHERE tenant_id = $1 ORDER BY is_default DESC, created_at`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []PaymentChannel
	for rows.Next() {
		var c PaymentChannel
		var cats []byte
		if err := rows.Scan(
			&c.ChannelID, &c.TenantID, &c.ChannelType, &c.ShortcodeOrAccount,
			&c.Label, &c.Environment, &c.IsDefault, &c.Status, &c.ReferenceFormat,
			&cats, &c.ChannelToken, &c.C2BRegistered, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		json.Unmarshal(cats, &c.RoutedFeeCategories)
		channels = append(channels, c)
	}
	return channels, nil
}

func (s *Service) CreatePaymentChannel(tenantID string, ch PaymentChannel) (*PaymentChannel, error) {
	err := s.database.QueryRow(
		`INSERT INTO school_payment_channels (tenant_id, channel_type, shortcode_or_account, label,
			environment, is_default, status, reference_format, routed_fee_categories, channel_token)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING channel_id, channel_token`,
		tenantID, ch.ChannelType, ch.ShortcodeOrAccount, ch.Label, ch.Environment,
		ch.IsDefault, ch.Status, ch.ReferenceFormat, ch.RoutedFeeCategories, ch.ChannelToken,
	).Scan(&ch.ChannelID, &ch.ChannelToken)
	if err != nil {
		return nil, err
	}
	ch.TenantID = tenantID
	return &ch, nil
}

// FinanceSettings represents school finance configuration
type FinanceSettings struct {
	TenantID             string   `json:"tenant_id"`
	TuitionInvoicing     bool     `json:"tuition_invoicing"`
	OptionalServices     bool     `json:"optional_services"`
	CapitationTracking   bool     `json:"capitation_tracking"`
	AllowedFeeCategories []string `json:"allowed_fee_categories"`
	ArrearsReminders     bool     `json:"arrears_reminders"`
	ReportWithholding    bool     `json:"report_withholding"`
	GateArrearsDenial    bool     `json:"gate_arrears_denial"`
	PresetLabel          string   `json:"preset_label"`
}

func (s *Service) GetFinanceSettings(tenantID string) (*FinanceSettings, error) {
	var fs FinanceSettings
	var cats []byte
	err := s.database.QueryRow(
		`SELECT tenant_id, tuition_invoicing, optional_services, capitation_tracking,
			allowed_fee_categories, arrears_reminders, report_withholding,
			gate_arrears_denial, preset_label
		 FROM school_finance_settings WHERE tenant_id = $1`,
		tenantID,
	).Scan(
		&fs.TenantID, &fs.TuitionInvoicing, &fs.OptionalServices, &fs.CapitationTracking,
		&cats, &fs.ArrearsReminders, &fs.ReportWithholding, &fs.GateArrearsDenial, &fs.PresetLabel,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return defaults
			return &FinanceSettings{
				TenantID:             tenantID,
				TuitionInvoicing:     false,
				OptionalServices:     false,
				CapitationTracking:   false,
				AllowedFeeCategories: []string{},
				ArrearsReminders:     true,
				ReportWithholding:    false,
				GateArrearsDenial:    false,
				PresetLabel:          "CUSTOM",
			}, nil
		}
		return nil, err
	}
	json.Unmarshal(cats, &fs.AllowedFeeCategories)
	return &fs, nil
}

func (s *Service) UpdateFinanceSettings(tenantID string, fs FinanceSettings) error {
	cats, _ := json.Marshal(fs.AllowedFeeCategories)
	_, err := s.database.Exec(
		`INSERT INTO school_finance_settings (tenant_id, tuition_invoicing, optional_services,
			capitation_tracking, allowed_fee_categories, arrears_reminders, report_withholding,
			gate_arrears_denial, preset_label)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 ON CONFLICT (tenant_id) DO UPDATE SET
			tuition_invoicing = EXCLUDED.tuition_invoicing,
			optional_services = EXCLUDED.optional_services,
			capitation_tracking = EXCLUDED.capitation_tracking,
			allowed_fee_categories = EXCLUDED.allowed_fee_categories,
			arrears_reminders = EXCLUDED.arrears_reminders,
			report_withholding = EXCLUDED.report_withholding,
			gate_arrears_denial = EXCLUDED.gate_arrears_denial,
			preset_label = EXCLUDED.preset_label,
			updated_at = CURRENT_TIMESTAMP`,
		tenantID, fs.TuitionInvoicing, fs.OptionalServices, fs.CapitationTracking,
		string(cats), fs.ArrearsReminders, fs.ReportWithholding, fs.GateArrearsDenial, fs.PresetLabel,
	)
	return err
}

// Handler

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetSchool(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	school, err := h.service.GetSchool(c.Request.Context(), tenantID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": "SCHOOL_NOT_FOUND", "message": "School not found"})
		return
	}
	c.JSON(http.StatusOK, school)
}

func (h *Handler) UpdateSchool(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var updates map[string]interface{}
	if errs := validation.BindJSON(c, &updates); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	school, err := h.service.UpdateSchool(tenantID, updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "Failed to update school"})
		return
	}
	c.JSON(http.StatusOK, school)
}

func (h *Handler) ListPaymentChannels(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	channels, err := h.service.ListPaymentChannels(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, channels)
}

func (h *Handler) CreatePaymentChannel(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var ch PaymentChannel
	if errs := validation.BindJSON(c, &ch); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	created, err := h.service.CreatePaymentChannel(tenantID, ch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *Handler) GetFinanceSettings(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	fs, err := h.service.GetFinanceSettings(tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, fs)
}

func (h *Handler) UpdateFinanceSettings(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	var fs FinanceSettings
	if errs := validation.BindJSON(c, &fs); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	if err := h.service.UpdateFinanceSettings(tenantID, fs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": "UPDATED", "message": "Finance settings updated"})
}

var _ = strconv.Itoa
