package kitchen

import (
	"context"
	"database/sql"
	"encoding/json"
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
	ID              string                `json:"id"`
	TenantID        string                `json:"tenant_id"`
	SlipNumber      string                `json:"slip_number"`
	RequisitionDate string                `json:"requisition_date"`
	MealType        string                `json:"meal_type"`
	RecipeID        *string               `json:"recipe_id,omitempty"`
	BoarderCountFed int                   `json:"boarder_count_fed"`
	Status          string                `json:"status"`
	ApprovedBy      *string               `json:"approved_by,omitempty"`
	ApprovedAt      *string               `json:"approved_at,omitempty"`
	ApprovalReason  *string               `json:"approval_reason,omitempty"`
	CreatedBy       *string               `json:"created_by,omitempty"`
	CreatedAt       string                `json:"created_at"`
	UpdatedAt       string                `json:"updated_at"`
	Items           []StoreRequisitionItem `json:"items,omitempty"`
}

type StoreRequisitionItem struct {
	ID             string   `json:"id"`
	TenantID       string   `json:"tenant_id"`
	RequisitionID  string   `json:"requisition_id"`
	InventoryItemID string  `json:"inventory_item_id"`
	ExpectedQty    float64  `json:"expected_qty"`
	ActualIssuedQty float64 `json:"actual_issued_qty"`
	VarianceQty    float64  `json:"variance_qty"`
	VariancePct    float64  `json:"variance_pct"`
	UnitCostAtTime *float64 `json:"unit_cost_at_time,omitempty"`
	Notes          *string  `json:"notes,omitempty"`
	CreatedAt      string   `json:"created_at"`
}

type CreateRequisitionRequest struct {
	SlipNumber      string                        `json:"slip_number" binding:"required"`
	RequisitionDate string                        `json:"requisition_date" binding:"required"`
	MealType        string                        `json:"meal_type" binding:"required"`
	RecipeID        *string                       `json:"recipe_id"`
	BoarderCountFed int                           `json:"boarder_count_fed" binding:"required,min=1"`
	Notes           *string                       `json:"notes"`
	Items           []CreateRequisitionItemRequest `json:"items" binding:"required,min=1"`
}

type CreateRequisitionItemRequest struct {
	InventoryItemID  string  `json:"inventory_item_id" binding:"required"`
	ExpectedQty      float64 `json:"expected_qty" binding:"required,gte=0"`
	ActualIssuedQty  float64 `json:"actual_issued_qty" binding:"required,gt=0"`
	UnitCost         *float64 `json:"unit_cost"`
}

func (s *Service) q(ctx context.Context) queryer {
	if q := middleware.TxFromContext(ctx); q != nil {
		return q
	}
	return s.database
}

func (s *Service) ListRecipes(ctx context.Context, tenantID string, mealType string, includeInactive bool) ([]MealRecipe, error) {
	q := s.q(ctx)
	query := `SELECT id, tenant_id, name, meal_type, is_active, created_by, created_at, updated_at
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
		if err := rows.Scan(&r.ID, &r.TenantID, &r.RecipeName, &r.MealType, &r.IsActive, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt); err != nil {
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
		`INSERT INTO meal_recipes (tenant_id, name, meal_type, created_by)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, tenant_id, name, meal_type, is_active, created_by, created_at, updated_at`,
		tenantID, req.RecipeName, req.MealType, nullIfEmpty(userID),
	).Scan(&r.ID, &r.TenantID, &r.RecipeName, &r.MealType, &r.IsActive, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt)
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
	query := `SELECT id, tenant_id, slip_number, requisition_date, meal_type, recipe_id, boarder_count_fed,
			  status, approved_by, approved_at, approval_reason, created_by, created_at, updated_at
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
		if err := rows.Scan(&r.ID, &r.TenantID, &r.SlipNumber, &r.RequisitionDate, &r.MealType, &r.RecipeID,
			&r.BoarderCountFed, &r.Status, &r.ApprovedBy, &r.ApprovedAt, &r.ApprovalReason, &r.CreatedBy,
			&r.CreatedAt, &r.UpdatedAt); err != nil {
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
		`INSERT INTO daily_store_requisitions (tenant_id, slip_number, requisition_date, meal_type, recipe_id, boarder_count_fed, status, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, 'RECONCILED', $7)
		 RETURNING id, tenant_id, slip_number, requisition_date, meal_type, recipe_id, boarder_count_fed, status, approved_by, approved_at, approval_reason, created_by, created_at, updated_at`,
		tenantID, req.SlipNumber, req.RequisitionDate, req.MealType, nullIfEmptyStr(req.RecipeID), req.BoarderCountFed, nullIfEmpty(userID),
	).Scan(&r.ID, &r.TenantID, &r.SlipNumber, &r.RequisitionDate, &r.MealType, &r.RecipeID, &r.BoarderCountFed, &r.Status,
		&r.ApprovedBy, &r.ApprovedAt, &r.ApprovalReason, &r.CreatedBy, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" {
			return nil, errors.New("requisition exists")
		}
		return nil, err
	}

	for _, item := range req.Items {
		_, err := tx.Exec(
			`INSERT INTO store_requisition_items (tenant_id, requisition_id, inventory_item_id, expected_qty, actual_issued_qty, unit_cost_at_time)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			tenantID, r.ID, item.InventoryItemID, item.ExpectedQty, item.ActualIssuedQty, item.UnitCost,
		)
		if err != nil {
			return nil, err
		}
	}

	rows, err := tx.Query(
		`SELECT id, tenant_id, requisition_id, inventory_item_id, expected_qty, actual_issued_qty,
		 variance_qty, variance_pct, unit_cost_at_time, notes, created_at
		 FROM store_requisition_items WHERE tenant_id = $1 AND requisition_id = $2`,
		tenantID, r.ID,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var i StoreRequisitionItem
			var unitCost *float64
			if err := rows.Scan(&i.ID, &i.TenantID, &i.RequisitionID, &i.InventoryItemID,
				&i.ExpectedQty, &i.ActualIssuedQty, &i.VarianceQty, &i.VariancePct,
				&unitCost, &i.Notes, &i.CreatedAt); err == nil {
				i.UnitCostAtTime = unitCost
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

func nullIfEmptyStr(s *string) interface{} {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	return *s
}

// ProcessRequisition computes expected quantities from the recipe, checks
// variance against tenant thresholds, and deducts stock by FIFO.
func (s *Service) ProcessRequisition(ctx context.Context, tenantID, userID, requisitionID string, boarderCount int) (*StoreRequisition, error) {
	q := s.q(ctx)
	tx, ok := q.(*sql.Tx)
	if !ok {
		return nil, errors.New("transaction required")
	}

	// Load requisition
	var r StoreRequisition
	err := tx.QueryRow(
		`SELECT id, tenant_id, slip_number, requisition_date, meal_type, recipe_id, boarder_count_fed, status
		 FROM daily_store_requisitions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
		tenantID, requisitionID,
	).Scan(&r.ID, &r.TenantID, &r.SlipNumber, &r.RequisitionDate, &r.MealType, &r.RecipeID, &r.BoarderCountFed, &r.Status)
	if err != nil {
		return nil, err
	}

	// Load tenant variance thresholds
	var softPct, hardPct float64
	softPct, hardPct = 5, 10
	var settingsJSON []byte
	if err := tx.QueryRow(`SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = 'variance_thresholds'`, tenantID).Scan(&settingsJSON); err == nil {
		var ts map[string]float64
		if json.Unmarshal(settingsJSON, &ts) == nil {
			if v, ok := ts["soft_threshold_pct"]; ok {
				softPct = v
			}
			if v, ok := ts["hard_threshold_pct"]; ok {
				hardPct = v
			}
		}
	}

	// Load recipe items
	type recipeItem struct {
		InventoryItemID string
		QtyPer100       float64
	}
	var recipeItems []recipeItem
	if r.RecipeID != nil && *r.RecipeID != "" {
		rows, err := tx.Query(
			`SELECT inventory_item_id, qty_per_100 FROM recipe_items WHERE tenant_id = $1 AND recipe_id = $2`,
			tenantID, *r.RecipeID,
		)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var ri recipeItem
				if err := rows.Scan(&ri.InventoryItemID, &ri.QtyPer100); err == nil {
					recipeItems = append(recipeItems, ri)
				}
			}
		}
	}

	// Compute expected quantities
	expectedMap := make(map[string]float64)
	for _, ri := range recipeItems {
		expectedMap[ri.InventoryItemID] = ri.QtyPer100 * float64(boarderCount) / 100.0
	}

	// Load requisition items
	rows, err := tx.Query(
		`SELECT id, inventory_item_id, actual_issued_qty FROM store_requisition_items WHERE tenant_id = $1 AND requisition_id = $2`,
		tenantID, requisitionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type reqItem struct {
		ID             string
		InventoryItemID string
		ActualIssued   float64
	}
	var reqItems []reqItem
	for rows.Next() {
		var ri reqItem
		if err := rows.Scan(&ri.ID, &ri.InventoryItemID, &ri.ActualIssued); err == nil {
			reqItems = append(reqItems, ri)
		}
	}

	// Determine variance status
	status := "RECONCILED"
	for _, ri := range reqItems {
		expected := expectedMap[ri.InventoryItemID]
		var variancePct float64
		if expected > 0 {
			variancePct = (ri.ActualIssued - expected) / expected * 100
			if variancePct < 0 {
				variancePct = -variancePct
			}
		} else if ri.ActualIssued > 0 {
			variancePct = 100 // hard lock
		}

		// Update item expected_qty and variance
		_, err = tx.Exec(
			`UPDATE store_requisition_items SET expected_qty = $1, variance_qty = $2, variance_pct = $3
			 WHERE tenant_id = $4 AND id = $5`,
			expected, ri.ActualIssued-expected, variancePct, tenantID, ri.ID,
		)
		if err != nil {
			return nil, err
		}

		// Determine status
		if variancePct > hardPct {
			status = "PENDING_APPROVAL"
		} else if variancePct > softPct && status != "PENDING_APPROVAL" {
			status = "FLAGGED"
		}
	}

	// Update requisition status
	_, err = tx.Exec(
		`UPDATE daily_store_requisitions SET status = $1, boarder_count_fed = $2, updated_at = CURRENT_TIMESTAMP
		 WHERE tenant_id = $3 AND id = $4`,
		status, boarderCount, tenantID, requisitionID,
	)
	if err != nil {
		return nil, err
	}

	// If OK or soft warning, deduct stock by FIFO
	if status == "RECONCILED" || status == "FLAGGED" {
		for _, ri := range reqItems {
			remaining := ri.ActualIssued
			// Get lots ordered by received_at, id
			lotRows, err := tx.Query(
				`SELECT id, qty_remaining, unit_cost FROM inventory_lots
				 WHERE tenant_id = $1 AND inventory_item_id = $2 AND qty_remaining > 0
				 ORDER BY received_at, id FOR UPDATE`,
				tenantID, ri.InventoryItemID,
			)
			if err != nil {
				return nil, err
			}
			for lotRows.Next() && remaining > 0 {
				var lotID string
				var lotQty float64
				var lotCost float64
				if err := lotRows.Scan(&lotID, &lotQty, &lotCost); err != nil {
					lotRows.Close()
					return nil, err
				}
				consume := lotQty
				if consume > remaining {
					consume = remaining
				}
				// Update lot
				_, err = tx.Exec(
					`UPDATE inventory_lots SET qty_remaining = qty_remaining - $1 WHERE tenant_id = $2 AND id = $3`,
					consume, tenantID, lotID,
				)
				if err != nil {
					lotRows.Close()
					return nil, err
				}
				// Create movement
				_, err = tx.Exec(
					`INSERT INTO inventory_movements (tenant_id, lot_id, inventory_item_id, qty, unit_cost, ref_type, ref_id)
					 VALUES ($1, $2, $3, $4, $5, 'REQUISITION', $6)`,
					tenantID, lotID, ri.InventoryItemID, -consume, lotCost, requisitionID,
				)
				if err != nil {
					lotRows.Close()
					return nil, err
				}
				remaining -= consume
			}
			lotRows.Close()
			if remaining > 0 {
				return nil, errors.New("insufficient stock for item " + ri.InventoryItemID)
			}
		}
	}

	r.Status = status
	r.BoarderCountFed = boarderCount
	return &r, nil
}
