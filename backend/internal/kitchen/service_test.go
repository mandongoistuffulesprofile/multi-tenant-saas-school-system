package kitchen

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
)

// Needs TEST_DATABASE_URL and is skipped otherwise, like the other RLS tests.
func kitchenTestDB(t *testing.T) *db.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	database, err := db.Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// tenantTx opens a transaction with tenant context, the way the HTTP middleware
// does, and returns the context the service reads it from.
func tenantTx(t *testing.T, database *db.DB, tenantID string) (*sqlx.Tx, context.Context) {
	t.Helper()
	tx, err := database.BeginTxx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(`SELECT set_config('app.current_tenant_id', $1, true)`, tenantID); err != nil {
		tx.Rollback()
		t.Fatalf("tenant context: %v", err)
	}
	return tx, middleware.WithTx(context.Background(), tx)
}

type kitchenStock struct {
	database *db.DB
	tenantID string
	itemID   string
	recipeID string
}

// The kitchen writes used to fail every real request with "transaction
// required" (they asserted *sql.Tx while the middleware hands over *sqlx.Tx),
// and ListRecipes ordered by a recipe_name column that does not exist. This
// drives the handlers' service layer end to end against the real schema.
func TestRequisitionVarianceControlsStockDeduction(t *testing.T) {
	database := kitchenTestDB(t)
	stock := kitchenStock{
		database: database,
		tenantID: fmt.Sprintf("kitchen-test-%d", time.Now().UnixNano()%1e9),
	}

	tx, _ := tenantTx(t, database, stock.tenantID)
	if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1, 'Kitchen School', $1)`, stock.tenantID); err != nil {
		t.Fatalf("school: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO inventory_items (tenant_id, code, name, unit)
		 VALUES ($1, 'MAIZE', 'Maize flour', 'kg') RETURNING id`, stock.tenantID).Scan(&stock.itemID); err != nil {
		t.Fatalf("inventory item: %v", err)
	}
	if err := tx.QueryRow(
		`INSERT INTO meal_recipes (tenant_id, name, meal_type)
		 VALUES ($1, 'Ugali', 'LUNCH') RETURNING id`, stock.tenantID).Scan(&stock.recipeID); err != nil {
		t.Fatalf("recipe: %v", err)
	}
	// 10kg of flour feeds 100 boarders.
	if _, err := tx.Exec(
		`INSERT INTO recipe_items (tenant_id, recipe_id, inventory_item_id, qty_per_100)
		 VALUES ($1, $2, $3, 10)`, stock.tenantID, stock.recipeID, stock.itemID); err != nil {
		t.Fatalf("recipe item: %v", err)
	}
	if _, err := tx.Exec(
		`INSERT INTO inventory_lots (tenant_id, source_type, inventory_item_id, qty_received, qty_remaining, unit_cost)
		 VALUES ($1, 'OPENING', $2, 15, 15, 50)`, stock.tenantID, stock.itemID); err != nil {
		t.Fatalf("lot: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}

	svc := NewService(database)

	readTx, readCtx := tenantTx(t, database, stock.tenantID)
	recipes, err := svc.ListRecipes(readCtx, stock.tenantID, "", false)
	if err != nil {
		t.Fatalf("list recipes: %v", err)
	}
	if len(recipes) != 1 || recipes[0].RecipeName != "Ugali" {
		t.Fatalf("recipes %+v, want the Ugali recipe named", recipes)
	}
	readTx.Rollback()

	// 12kg issued against 10kg expected is a 20% variance: past the hard
	// threshold, so it waits for approval and must not touch stock.
	over, overCtx := tenantTx(t, database, stock.tenantID)
	requisition, err := svc.CreateRequisition(overCtx, stock.tenantID, "", CreateRequisitionRequest{
		SlipNumber:      "SLIP-OVER",
		RequisitionDate: "2026-11-15",
		MealType:        "LUNCH",
		RecipeID:        &stock.recipeID,
		BoarderCountFed: 100,
		Items: []CreateRequisitionItemRequest{
			{InventoryItemID: stock.itemID, ExpectedQty: 0, ActualIssuedQty: 12},
		},
	})
	if err != nil {
		t.Fatalf("create requisition: %v", err)
	}
	if len(requisition.Items) != 1 {
		t.Fatalf("requisition items %d, want 1", len(requisition.Items))
	}
	processed, err := svc.ProcessRequisition(overCtx, stock.tenantID, "", requisition.ID, 100)
	if err != nil {
		t.Fatalf("process over-issue: %v", err)
	}
	if processed.Status != "PENDING_APPROVAL" {
		t.Fatalf("status %s, want PENDING_APPROVAL for a 20%% variance", processed.Status)
	}
	if got := stockRemaining(t, over, stock); got != 15 {
		t.Fatalf("stock %.3f after a pending requisition, want 15", got)
	}
	if err := over.Commit(); err != nil {
		t.Fatalf("commit over-issue: %v", err)
	}

	// 10kg against 10kg expected reconciles and consumes exactly 10kg.
	okTx, okCtx := tenantTx(t, database, stock.tenantID)
	exact, err := svc.CreateRequisition(okCtx, stock.tenantID, "", CreateRequisitionRequest{
		SlipNumber:      "SLIP-EXACT",
		RequisitionDate: "2026-11-15",
		MealType:        "LUNCH",
		RecipeID:        &stock.recipeID,
		BoarderCountFed: 100,
		Items: []CreateRequisitionItemRequest{
			{InventoryItemID: stock.itemID, ExpectedQty: 0, ActualIssuedQty: 10},
		},
	})
	if err != nil {
		t.Fatalf("create second requisition: %v", err)
	}
	processed, err = svc.ProcessRequisition(okCtx, stock.tenantID, "", exact.ID, 100)
	if err != nil {
		t.Fatalf("process exact issue: %v", err)
	}
	if processed.Status != "RECONCILED" {
		t.Fatalf("status %s, want RECONCILED for an exact issue", processed.Status)
	}
	if got := stockRemaining(t, okTx, stock); got != 5 {
		t.Fatalf("stock %.3f after issuing 10 of 15, want 5", got)
	}
	if err := okTx.Commit(); err != nil {
		t.Fatalf("commit exact issue: %v", err)
	}
}

func stockRemaining(t *testing.T, tx *sqlx.Tx, stock kitchenStock) float64 {
	t.Helper()
	var remaining float64
	if err := tx.QueryRow(
		`SELECT COALESCE(SUM(qty_remaining), 0)::float8 FROM inventory_lots
		  WHERE tenant_id = $1 AND inventory_item_id = $2`,
		stock.tenantID, stock.itemID).Scan(&remaining); err != nil {
		t.Fatalf("read stock: %v", err)
	}
	return remaining
}
