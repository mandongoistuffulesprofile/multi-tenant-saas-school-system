package finance_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/db"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/finance"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/holdingtank"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/money"
)

// These tests exercise the paths that used to keep their own SQL — in-kind
// credit, the manual per-invoice allocation endpoint, holding-tank resolution
// and the votehead hint — against a real database, because their whole point is
// that they now agree with the shared allocator.

type seeded struct {
	tenantID   string
	userID     string
	learnerID  string
	admission  string
	invoiceID  string
	paymentID  string
	tuitionID  string
	boardingID string
	yearID     string
	termID     string
	lineIDs    map[string]string // votehead code -> invoice_line_id
}

func connectTestDB(t *testing.T) *db.DB {
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

// seedTenant creates a school with one learner, two mapped voteheads and one
// open invoice of 3000 tuition + 2000 boarding.
func seedTenant(t *testing.T, database *db.DB) *seeded {
	t.Helper()
	ctx := context.Background()
	suffix := strconv.FormatInt(time.Now().UnixNano(), 10)
	s := &seeded{
		tenantID:  "paths-" + suffix,
		userID:    uuid.NewString(),
		admission: "ADM-" + suffix[:8],
		lineIDs:   map[string]string{},
	}

	err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		if _, err := tx.Exec(`INSERT INTO schools (tenant_id, school_name, subdomain) VALUES ($1,$2,$3)`,
			s.tenantID, "Paths School", s.tenantID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO academic_years (tenant_id, year_label, start_date, end_date, is_current)
			VALUES ($1,'2026','2026-01-01','2026-12-31',true) RETURNING year_id`, s.tenantID).Scan(&s.yearID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO terms (tenant_id, year_id, term_number, term_label, start_date, end_date)
			VALUES ($1,$2,1,'Term 1','2026-01-05','2026-04-10') RETURNING term_id`, s.tenantID, s.yearID).Scan(&s.termID); err != nil {
			return err
		}

		// Voteheads plus the fee categories that point at them.
		for _, code := range []string{"TUITION", "BOARDING"} {
			var voteheadID, categoryID string
			if err := tx.QueryRow(`INSERT INTO voteheads (tenant_id, code, name) VALUES ($1,$2,$3)
				RETURNING id::text`, s.tenantID, code, strings.Title(strings.ToLower(code))).Scan(&voteheadID); err != nil {
				return err
			}
			if err := tx.QueryRow(`INSERT INTO fee_categories (tenant_id, code, name, votehead_id)
				VALUES ($1,$2,$3,$4::uuid) RETURNING category_id`, s.tenantID, code, code, voteheadID).Scan(&categoryID); err != nil {
				return err
			}
			if code == "TUITION" {
				s.tuitionID = voteheadID
			} else {
				s.boardingID = voteheadID
			}
		}

		if err := tx.QueryRow(`INSERT INTO learners (tenant_id, admission_number, first_name, last_name)
			VALUES ($1,$2,'Paths','Learner') RETURNING learner_id`, s.tenantID, s.admission).Scan(&s.learnerID); err != nil {
			return err
		}
		if err := tx.QueryRow(`INSERT INTO invoices
			(tenant_id, invoice_number, learner_id, academic_year_id, term_id, status,
			 total_amount, amount_paid, amount_outstanding, issue_date)
			VALUES ($1,$2,$3,$4,$5,'ISSUED',5000,0,5000,'2026-01-06') RETURNING invoice_id`,
			s.tenantID, "INV-P-"+suffix[:6], s.learnerID, s.yearID, s.termID).Scan(&s.invoiceID); err != nil {
			return err
		}
		for code, amount := range map[string]int64{"TUITION": 3000, "BOARDING": 2000} {
			var categoryID, lineID string
			if err := tx.QueryRow(`SELECT category_id FROM fee_categories WHERE tenant_id = $1 AND code = $2`,
				s.tenantID, code).Scan(&categoryID); err != nil {
				return err
			}
			if err := tx.QueryRow(`INSERT INTO invoice_lines
				(tenant_id, invoice_id, category_id, description, quantity, unit_amount, line_amount, academic_year_id, term_id)
				VALUES ($1,$2,$3,$4,1,$5,$5,$6,$7) RETURNING line_id`,
				s.tenantID, s.invoiceID, categoryID, code, amount, s.yearID, s.termID).Scan(&lineID); err != nil {
				return err
			}
			s.lineIDs[code] = lineID
		}

		return tx.QueryRow(`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status)
			VALUES ($1,$2,$3,'CASH',2000,'COMPLETED') RETURNING payment_id`,
			s.tenantID, "HINT-"+suffix[:6], s.learnerID).Scan(&s.paymentID)
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	t.Cleanup(func() {
		_ = database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
			for _, stmt := range []string{
				`DELETE FROM allocation_reconciliation_findings WHERE tenant_id = $1`,
				`DELETE FROM payment_allocations WHERE tenant_id = $1`,
				`DELETE FROM credits WHERE tenant_id = $1`,
				`DELETE FROM mpesa_holding_tank WHERE tenant_id = $1`,
				`DELETE FROM fee_categories WHERE tenant_id = $1`,
				`DELETE FROM voteheads WHERE tenant_id = $1`,
				`DELETE FROM terms WHERE tenant_id = $1`,
				`DELETE FROM academic_years WHERE tenant_id = $1`,
				`DELETE FROM schools WHERE tenant_id = $1`,
			} {
				if _, err := tx.Exec(stmt, s.tenantID); err != nil {
					t.Logf("cleanup %q: %v", stmt, err)
				}
			}
			return nil
		})
	})
	return s
}

func (s *seeded) invoiceOutstanding(t *testing.T, database *db.DB, invoiceID string) string {
	t.Helper()
	var outstanding string
	err := database.WithTenant(context.Background(), s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT amount_outstanding::text FROM invoices WHERE invoice_id = $1::uuid`,
			invoiceID).Scan(&outstanding)
	})
	if err != nil {
		t.Fatalf("invoice outstanding: %v", err)
	}
	return outstanding
}

func (s *seeded) lineOutstanding(t *testing.T, database *db.DB, code string) string {
	t.Helper()
	var outstanding string
	err := database.WithTenant(context.Background(), s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT outstanding::text FROM v_line_outstanding WHERE line_id = $1::uuid`,
			s.lineIDs[code]).Scan(&outstanding)
	})
	if err != nil {
		t.Fatalf("line outstanding %s: %v", code, err)
	}
	return outstanding
}

// TestVoteheadHintFromReference checks that a reference naming a votehead is
// split into the account that finds the learner and the votehead that decides
// where the money lands — and that an unknown code leaves both untouched.
func TestVoteheadHintFromReference(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)
	ctx := context.Background()

	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		account, hint := finance.ResolveReferenceHint(ctx, tx, s.tenantID, s.admission+"/BOARDING")
		if account != s.admission {
			t.Fatalf("account = %q, want %q", account, s.admission)
		}
		if hint != s.boardingID {
			t.Fatalf("hint = %q, want boarding votehead %q", hint, s.boardingID)
		}

		account, hint = finance.ResolveReferenceHint(ctx, tx, s.tenantID, s.admission+"/NOT_A_VOTEHEAD")
		if account != s.admission+"/NOT_A_VOTEHEAD" {
			t.Fatalf("unknown hint must not strip the reference, got account %q", account)
		}
		if hint != "" {
			t.Fatalf("unknown hint produced votehead %q", hint)
		}

		// A bare admission number is still a bare admission number.
		account, hint = finance.ResolveReferenceHint(ctx, tx, s.tenantID, s.admission)
		if account != s.admission || hint != "" {
			t.Fatalf("bare reference resolved to (%q, %q)", account, hint)
		}
		return nil
	}); err != nil {
		t.Fatalf("resolve hint: %v", err)
	}
}

// TestReceiptLandsOnHintedVotehead proves the hint changes where money lands,
// not just what the parser returns.
func TestReceiptLandsOnHintedVotehead(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)

	if err := database.WithTenant(context.Background(), s.tenantID, "", func(tx *db.Tx) error {
		_, err := finance.ApplyReceipt(context.Background(), tx, finance.ReceiptApplication{
			TenantID:     s.tenantID,
			UserID:       s.userID,
			PaymentID:    s.paymentID,
			LearnerID:    s.learnerID,
			Amount:       money.FromCents(200000),
			HintVotehead: s.boardingID,
			Rule:         finance.AllocationPriority,
			Reference:    "HINT",
		})
		return err
	}); err != nil {
		t.Fatalf("apply hinted receipt: %v", err)
	}

	if got := s.lineOutstanding(t, database, "BOARDING"); got != "0.00" {
		t.Fatalf("boarding line outstanding = %s, want 0.00", got)
	}
	if got := s.lineOutstanding(t, database, "TUITION"); got != "3000.00" {
		t.Fatalf("tuition line should be untouched, outstanding %s", got)
	}
}

// TestManualAllocationRefusal drives the real endpoint through the tenant
// transaction middleware: an over-allocation must be refused, and a valid one
// must leave a line-level allocation behind.
func TestManualAllocationRefusal(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)
	service := finance.NewService(database)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("tenant_id", s.tenantID)
		c.Set("user_id", s.userID)
		c.Next()
	})
	router.Use(middleware.TenantTxMiddleware(database.DB, nil))
	router.POST("/allocate", func(c *gin.Context) {
		var body struct {
			Amount float64 `json:"amount"`
		}
		_ = c.ShouldBindJSON(&body)
		_, err := service.AllocatePayment(c.Request.Context(), s.tenantID, finance.PaymentAllocation{
			PaymentID:       s.paymentID,
			InvoiceID:       s.invoiceID,
			AllocatedAmount: body.Amount,
			AllocatedBy:     s.userID,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	post := func(amount float64) (*httptest.ResponseRecorder, string) {
		body, _ := json.Marshal(gin.H{"amount": amount})
		req := httptest.NewRequest(http.MethodPost, "/allocate", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		var parsed struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
		return rec, parsed.Message
	}

	// More than the invoice owes: refused, as before the rewrite.
	rec, message := post(9000)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("over-allocation returned %d, want 400 (body %s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(message, "exceeds") {
		t.Fatalf("refusal message %q does not explain the excess", message)
	}
	if got := s.lineOutstanding(t, database, "TUITION"); got != "3000.00" {
		t.Fatalf("a refused allocation changed the tuition line: %s", got)
	}

	// A valid allocation settles the oldest line and records it against the line.
	rec, message = post(1000)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid allocation returned %d: %s", rec.Code, message)
	}
	if got := s.invoiceOutstanding(t, database, s.invoiceID); got != "4000.00" {
		t.Fatalf("invoice outstanding = %s after 1000 allocation, want 4000.00", got)
	}
	var lineAllocations int
	if err := database.WithTenant(context.Background(), s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM payment_allocations
			WHERE tenant_id = $1 AND payment_id = $2::uuid AND invoice_line_id IS NOT NULL`,
			s.tenantID, s.paymentID).Scan(&lineAllocations)
	}); err != nil {
		t.Fatalf("count allocations: %v", err)
	}
	if lineAllocations == 0 {
		t.Fatal("the manual allocation wrote no line-level row")
	}
}

// TestInKindCreditLandsOnVotehead covers the produce-intake path: it must use
// the votehead it was given, cap at the debt, and record line allocations.
func TestInKindCreditLandsOnVotehead(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)
	handler := finance.NewHandler(finance.NewService(database))

	result, err := handler.CreditStudentInvoiceForInKind(
		s.tenantID, s.userID, s.learnerID, "BOARDING", money.FromCents(250000), "MAIZE-1",
	)
	if err != nil {
		t.Fatalf("in-kind credit: %v", err)
	}
	if result == nil {
		t.Fatal("in-kind credit returned no result")
	}
	if result.InvoiceID != s.invoiceID {
		t.Fatalf("credited invoice %s, want %s", result.InvoiceID, s.invoiceID)
	}
	// 2500 of produce against a 2000 boarding line: capped at the debt.
	if result.NewOutstanding >= result.PreviousOutstanding {
		t.Fatalf("outstanding did not fall: %v -> %v", result.PreviousOutstanding, result.NewOutstanding)
	}
	if got := s.lineOutstanding(t, database, "BOARDING"); got != "0.00" {
		t.Fatalf("boarding line outstanding = %s after in-kind credit, want 0.00", got)
	}
	if got := s.lineOutstanding(t, database, "TUITION"); got != "3000.00" {
		t.Fatalf("tuition line should be untouched, outstanding %s", got)
	}

	var paymentSource string
	if err := database.WithTenant(context.Background(), s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT source FROM payments WHERE payment_id = $1::uuid`, result.PaymentID).Scan(&paymentSource)
	}); err != nil {
		t.Fatalf("read in-kind payment: %v", err)
	}
	if paymentSource != "IN_KIND_PRODUCE" {
		t.Fatalf("in-kind payment source = %s", paymentSource)
	}
}

// TestHoldingTankResolution covers a deposit that lands in the holding tank and
// is then matched to a learner: it must become a payment, settle lines and not
// leave the money sitting on a status flag.
func TestHoldingTankResolution(t *testing.T) {
	database := connectTestDB(t)
	s := seedTenant(t, database)
	ctx := context.Background()

	var entryID string
	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`INSERT INTO mpesa_holding_tank
			(tenant_id, transaction_code, msisdn, reference, amount, sender_phone, raw_webhook_payload, status)
			VALUES ($1,$2,'254700000000',$3,1500,'254700000000','{}'::jsonb,'UNALLOCATED')
			RETURNING id::text`,
			s.tenantID, "TANK-"+s.tenantID, "REF-"+s.tenantID).Scan(&entryID)
	}); err != nil {
		t.Fatalf("seed holding tank: %v", err)
	}

	// Drive the real endpoint: the tenant transaction must be in the request
	// context, because RLS filters the holding entry without it.
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("tenant_id", s.tenantID)
		c.Set("user_id", s.userID)
		c.Next()
	})
	router.Use(middleware.TenantTxMiddleware(database.DB, nil))
	router.POST("/holding/:id/resolve", holdingtank.NewHandler(holdingtank.NewService(database)).ResolveHoldingTank)

	body, _ := json.Marshal(gin.H{"student_id": s.learnerID})
	req := httptest.NewRequest(http.MethodPost, "/holding/"+entryID+"/resolve", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("resolve holding tank returned %d: %s", rec.Code, rec.Body.String())
	}

	var status string
	var paymentID string
	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		if err := tx.QueryRow(`SELECT status FROM mpesa_holding_tank WHERE id = $1::uuid`, entryID).Scan(&status); err != nil {
			return err
		}
		return tx.QueryRow(`SELECT payment_id::text FROM payments WHERE tenant_id = $1 AND source = 'MPESA'
			AND amount = 1500 AND learner_id = $2::uuid`, s.tenantID, s.learnerID).Scan(&paymentID)
	}); err != nil {
		t.Fatalf("verify resolution: %v", err)
	}
	if status != "ALLOCATED" {
		t.Fatalf("holding entry status = %s, want ALLOCATED", status)
	}

	var allocated string
	if err := database.WithTenant(ctx, s.tenantID, "", func(tx *db.Tx) error {
		return tx.QueryRow(`SELECT COALESCE(SUM(allocated_amount),0)::text
			FROM payment_allocations WHERE tenant_id = $1 AND payment_id = $2::uuid`,
			s.tenantID, paymentID).Scan(&allocated)
	}); err != nil {
		t.Fatalf("sum allocations: %v", err)
	}
	if money.New(allocated).StringFixed(2) != "1500.00" {
		t.Fatalf("holding-tank deposit allocated %s, want 1500.00", allocated)
	}
	if got := s.invoiceOutstanding(t, database, s.invoiceID); got != "3500.00" {
		t.Fatalf("invoice outstanding = %s after 1500 deposit, want 3500.00", got)
	}
}
