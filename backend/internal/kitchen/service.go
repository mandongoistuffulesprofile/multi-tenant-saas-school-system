package kitchen

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/lib/pq"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

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

type MealRecipe struct {
	ID               string  `json:"id"`
	TenantID         string  `json:"tenant_id"`
	RecipeName       string  `json:"recipe_name"`
	MealType         string  `json:"meal_type"`
	ServingsPerBatch int     `json:"servings_per_batch"`
	Instructions     *string `json:"instructions,omitempty"`
	IsActive         bool    `json:"is_active"`
	CreatedBy        *string `json:"created_by,omitempty"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        string  `json:"updated_at"`
}

type CreateMealRecipeRequest struct {
	RecipeName       string  `json:"recipe_name" binding:"required"`
	MealType         string  `json:"meal_type" binding:"required"`
	ServingsPerBatch int     `json:"servings_per_batch" binding:"required,min=1"`
	Instructions     *string `json:"instructions"`
}

type StoreRequisition struct {
	ID               string                `json:"id"`
	TenantID         string                `json:"tenant_id"`
	RequisitionDate  string                `json:"requisition_date"`
	MealType         string                `json:"meal_type"`
	ExpectedServings int                   `json:"expected_servings"`
	RequestedBy      *string               `json:"requested_by,omitempty"`
	EnteredBy        *string               `json:"entered_by,omitempty"`
	Status           string                `json:"status"`
	ApprovedBy       *string               `json:"approved_by,omitempty"`
	ApprovedAt       *string               `json:"approved_at,omitempty"`
	IssuedBy         *string               `json:"issued_by,omitempty"`
	IssuedAt         *string               `json:"issued_at,omitempty"`
	ReconciledBy     *string               `json:"reconciled_by,omitempty"`
	ReconciledAt     *string               `json:"reconciled_at,omitempty"`
	PaperRefNumber   *string               `json:"paper_ref_number,omitempty"`
	Notes            *string               `json:"notes,omitempty"`
	CreatedAt        string                `json:"created_at"`
	UpdatedAt        string                `json:"updated_at"`
	Items            []StoreRequisitionItem `json:"items,omitempty"`
}

type StoreRequisitionItem struct {
	ID                 string   `json:"id"`
	TenantID           string   `json:"tenant_id"`
	RequisitionID      string   `json:"requisition_id"`
	InventoryItemID    string   `json:"inventory_item_id"`
	RecipeID           *string  `json:"recipe_id,omitempty"`
	RequestedQuantity  float64  `json:"requested_quantity"`
	Unit               string   `json:"unit"`
	ApprovedQuantity   *float64 `json:"approved_quantity,omitempty"`
	IssuedQuantity     *float64 `json:"issued_quantity,omitempty"`
	ActualQuantityUsed *float64 `json:"actual_quantity_used,omitempty"`
	VarianceQuantity   *float64 `json:"variance_quantity,omitempty"`
	VariancePercentage *float64 `json:"variance_percentage,omitempty"`
	UnitCost           *float64 `json:"unit_cost,omitempty"`
	LineTotal          *float64 `json:"line_total,omitempty"`
	Notes              *string  `json:"notes,omitempty"`
	CreatedAt          string   `json:"created_at"`
}

type CreateRequisitionRequest struct {
	RequisitionDate  string                       `json:"requisition_date" binding:"required"`
	MealType         string                       `json:"meal_type" binding:"required"`
	ExpectedServings int                          `json:"expected_servings" binding:"required,min=1"`
	PaperRefNumber   *string                      `json:"paper_ref_number"`
	Notes            *string                      `json:"notes"`
	Items            []CreateRequisitionItemRequest `json:"items" binding:"required,min=1"`
}

type CreateRequisitionItemRequest struct {
	InventoryItemID   string  `json:"inventory_item_id" binding:"required"`
	RecipeID          *string `json:"recipe_id"`
	RequestedQuantity float64 `json:"requested_quantity" binding:"required,gt=0"`
	Unit              string  `json:"unit" binding:"required"`
}

func (s *Service) q(ctx context.Context) queryer {
	if q := middleware.TxFromContext(ctx); q != nil {
		return q
	}
	return s.database
}

func (s *Service) ListRecipes(ctx context.Context, tenantID string, mealType string, includeInactive bool) ([]MealRecipe, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, recipe_name, meal_type, servings_per_batch, instructions, is_active, created_by, created_at, updated_at
			  FROM meal_recipes WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	if mealType != "" {
		query += ` AND meal_type = $2`
		args = append(args, mealType)
	}
	if !includeInactive {
		query += ` AND is_active = true`
	}
	query += ` ORDER BY recipe_name`

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recipes []MealRecipe
	for rows.Next() {
		var r MealRecipe
		if err := rows.Scan(&r.ID, &r.TenantID, &r.RecipeName, &r.MealType, &r.ServingsPerBatch,
			&r.Instructions, &r.IsActive, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		recipes = append(recipes, r)
	}
	return recipes, rows.Err()
}

func (s *Service) CreateRecipe(ctx context.Context, tenantID, userID string, req CreateMealRecipeRequest) (*MealRecipe, error) {
	q := s.q(ctx)
	var r MealRecipe
	err := q.QueryRow(
		`INSERT INTO meal_recipes (tenant_id, recipe_name, meal_type, servings_per_batch, instructions, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, tenant_id, recipe_name, meal_type, servings_per_batch, instructions, is_active, created_by, created_at, updated_at`,
		tenantID, req.RecipeName, req.MealType, req.ServingsPerBatch, req.Instructions, nullIfEmpty(userID),
	).Scan(&r.ID, &r.TenantID, &r.RecipeName, &r.MealType, &r.ServingsPerBatch,
		&r.Instructions, &r.IsActive, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("recipe already exists")
		}
		return nil, err
	}
	return &r, nil
}

func (s *Service) ListRequisitions(ctx context.Context, tenantID string, status string, fromDate, toDate string, limit, offset int) ([]StoreRequisition, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, requisition_date, meal_type, expected_servings, requested_by, entered_by,
			  status, approved_by, approved_at, issued_by, issued_at, reconciled_by, reconciled_at,
			  paper_ref_number, notes, created_at, updated_at
			  FROM daily_store_requisitions WHERE tenant_id = $1`
	args := []interface{}{tenantID}
	argIdx := 2
	if status != "" {
		query += ` AND status = $` + strconv.Itoa(argIdx)
		args = append(args, status)
		argIdx++
	}
	if fromDate != "" {
		query += ` AND requisition_date >= $` + strconv.Itoa(argIdx)
		args = append(args, fromDate)
		argIdx++
	}
	if toDate != "" {
		query += ` AND requisition_date <= $` + strconv.Itoa(argIdx)
		args = append(args, toDate)
		argIdx++
	}
	query += ` ORDER BY requisition_date DESC, meal_type LIMIT $` + strconv.Itoa(argIdx) + ` OFFSET $` + strconv.Itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reqs []StoreRequisition
	for rows.Next() {
		var r StoreRequisition
		if err := rows.Scan(&r.ID, &r.TenantID, &r.RequisitionDate, &r.MealType, &r.ExpectedServings,
			&r.RequestedBy, &r.EnteredBy, &r.Status, &r.ApprovedBy, &r.ApprovedAt, &r.IssuedBy, &r.IssuedAt,
			&r.ReconciledBy, &r.ReconciledAt, &r.PaperRefNumber, &r.Notes, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func (s *Service) CreateRequisition(ctx context.Context, tenantID, userID string, req CreateRequisitionRequest) (*StoreRequisition, error) {
	q := s.q(ctx)
	tx, ok := q.(*sql.Tx)
	if !ok {
		return nil, errors.New("transaction required")
	}

	var r StoreRequisition
	err := tx.QueryRow(
		`INSERT INTO daily_store_requisitions (tenant_id, requisition_date, meal_type, expected_servings, requested_by, entered_by, paper_ref_number, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, tenant_id, requisition_date, meal_type, expected_servings, requested_by, entered_by, status,
		 approved_by, approved_at, issued_by, issued_at, reconciled_by, reconciled_at, paper_ref_number, notes, created_at, updated_at`,
		tenantID, req.RequisitionDate, req.MealType, req.ExpectedServings, nullIfEmpty(userID), nullIfEmpty(userID), req.PaperRefNumber, req.Notes,
	).Scan(&r.ID, &r.TenantID, &r.RequisitionDate, &r.MealType, &r.ExpectedServings,
		&r.RequestedBy, &r.EnteredBy, &r.Status, &r.ApprovedBy, &r.ApprovedAt, &r.IssuedBy, &r.IssuedAt,
		&r.ReconciledBy, &r.ReconciledAt, &r.PaperRefNumber, &r.Notes, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("requisition exists")
		}
		return nil, err
	}

	for _, item := range req.Items {
		_, err := tx.Exec(
			`INSERT INTO store_requisition_items (tenant_id, requisition_id, inventory_item_id, recipe_id, requested_quantity, unit)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			tenantID, r.ID, item.InventoryItemID, item.RecipeID, item.RequestedQuantity, item.Unit,
		)
		if err != nil {
			return nil, err
		}
	}

	rows, err := tx.Query(
		`SELECT id, tenant_id, requisition_id, inventory_item_id, recipe_id, requested_quantity, unit,
		 approved_quantity, issued_quantity, actual_quantity_used, variance_quantity, variance_percentage,
		 unit_cost, line_total, notes, created_at
		 FROM store_requisition_items WHERE tenant_id = $1 AND requisition_id = $2`,
		tenantID, r.ID,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var i StoreRequisitionItem
			if err := rows.Scan(&i.ID, &i.TenantID, &i.RequisitionID, &i.InventoryItemID, &i.RecipeID,
				&i.RequestedQuantity, &i.Unit, &i.ApprovedQuantity, &i.IssuedQuantity, &i.ActualQuantityUsed,
				&i.VarianceQuantity, &i.VariancePercentage, &i.UnitCost, &i.LineTotal, &i.Notes, &i.CreatedAt); err == nil {
				r.Items = append(r.Items, i)
			}
		}
	}
	return &r, nil
}

func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}
