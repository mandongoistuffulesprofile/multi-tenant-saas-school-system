package finance

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/middleware"
	"github.com/mandongoistuffulesprofile/multi-tenant-saas-school-system/backend/internal/validation"
)

// feeLineDraft is one fee-structure line that will become an invoice line.
type feeLineDraft struct {
	learnerID   string
	admissionNo string
	categoryID  string
	amount      float64
	description string
}

// invoiceDraft groups the fee lines belonging to a single learner.
type invoiceDraft struct {
	learnerID   string
	admissionNo string
	lines       []feeLineDraft
	total       float64
}

// Write-side finance operations that the bursar's screens need: invoice
// runs, arrears reporting, reconciliation decisions, learner statements and
// the finance dashboard.

// CreateInvoiceRun generates invoices for a set of learners from the fee
// structures in force. A dry run reports the totals without writing.
func (h *Handler) CreateInvoiceRun(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var req struct {
		AcademicYearID string   `json:"academic_year_id" binding:"required"`
		TermID         string   `json:"term_id" binding:"required"`
		GradeIDs       []string `json:"grade_ids"`
		LearnerIDs     []string `json:"learner_ids"`
		DueDate        string   `json:"due_date"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	// Collect the learners in scope with the fee structures that apply.
	query := `
		SELECT l.learner_id, l.admission_number, fs.category_id, fs.amount_per_term, fc.name
		FROM learners l
		JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		JOIN fee_structures fs ON fs.grade_id = cg.grade_id AND fs.academic_year_id = $2 AND fs.tenant_id = l.tenant_id
		JOIN fee_categories fc ON fc.category_id = fs.category_id
		WHERE l.tenant_id = $1 AND l.status = 'ACTIVE'`
	args := []interface{}{tenantID, req.AcademicYearID}
	if len(req.GradeIDs) > 0 {
		query += " AND cg.grade_id = ANY($3)"
		args = append(args, req.GradeIDs)
	}
	if len(req.LearnerIDs) > 0 {
		query += fmt.Sprintf(" AND l.learner_id = ANY($%d)", len(args)+1)
		args = append(args, req.LearnerIDs)
	}
	query += " ORDER BY l.admission_number"

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	type feeLine struct {
		learnerID   string
		admissionNo string
		categoryID  string
		amount      float64
		description string
	}
	lines := make([]feeLine, 0)
	for rows.Next() {
		var f feeLine
		if err := rows.Scan(&f.learnerID, &f.admissionNo, &f.categoryID, &f.amount, &f.description); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		lines = append(lines, f)
	}
	rows.Close()

	// Group the lines per learner.
	drafts := make([]invoiceDraft, 0)
	index := map[string]int{}
	for _, l := range lines {
		i, ok := index[l.learnerID]
		if !ok {
			drafts = append(drafts, invoiceDraft{learnerID: l.learnerID, admissionNo: l.admissionNo})
			i = len(drafts) - 1
			index[l.learnerID] = i
		}
		drafts[i].lines = append(drafts[i].lines, feeLineDraft(l))
		drafts[i].total += l.amount
	}

	if c.Query("dry_run") == "true" {
		c.JSON(http.StatusOK, gin.H{
			"dry_run":       true,
			"invoice_count": len(drafts),
			"line_count":    len(lines),
			"total_amount":  sumAmounts(drafts),
		})
		return
	}

	created := 0
	skipped := 0
	for _, d := range drafts {
		// Skip learners who already have an invoice for this year and term.
		var existing int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM invoices WHERE tenant_id = $1 AND learner_id = $2 AND academic_year_id = $3 AND term_id = $4`,
			tenantID, d.learnerID, req.AcademicYearID, req.TermID).Scan(&existing); err == nil && existing > 0 {
			skipped++
			continue
		}

		invoiceNumber := "INV-" + req.AcademicYearID + "-" + d.admissionNo
		var invoiceID string
		err := tx.QueryRow(
			`INSERT INTO invoices (tenant_id, invoice_number, learner_id, academic_year_id, term_id, status, total_amount, amount_paid, amount_outstanding, issue_date, due_date, created_by)
			 VALUES ($1, $2, $3, $4, $5, 'ISSUED', $6, 0, $6, CURRENT_DATE, $7, $8)
			 ON CONFLICT (tenant_id, invoice_number) DO NOTHING
			 RETURNING invoice_id`,
			tenantID, invoiceNumber, d.learnerID, req.AcademicYearID, req.TermID,
			d.total, nullableString(req.DueDate), nullableString(userID)).Scan(&invoiceID)
		if err != nil {
			if err == sql.ErrNoRows {
				skipped++
				continue
			}
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}

		for _, l := range d.lines {
			_, _ = tx.Exec(
				`INSERT INTO invoice_lines (tenant_id, invoice_id, category_id, description, quantity, unit_amount, line_amount, academic_year_id, term_id)
				 VALUES ($1, $2, $3, $4, 1, $5, $5, $6, $7)`,
				tenantID, invoiceID, l.categoryID, l.description, l.amount, req.AcademicYearID, req.TermID)
		}
		created++
	}

	c.JSON(http.StatusCreated, gin.H{
		"invoice_count": created,
		"skipped":       skipped,
		"total_amount":  sumAmounts(drafts),
	})
}

func sumAmounts(drafts []invoiceDraft) float64 {
	total := 0.0
	for _, d := range drafts {
		total += d.total
	}
	return total
}

// ArrearsReport returns learners with outstanding balances, bucketed by age.
func (h *Handler) ArrearsReport(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	minAmount := 0.0
	if v := c.Query("min_amount"); v != "" {
		minAmount = parseFloat(v)
	}

	rows, err := tx.Query(
		`SELECT l.learner_id, l.admission_number, l.first_name, l.last_name,
			COALESCE(g.grade_label, ''), COALESCE(s.stream_name, ''),
			COALESCE(SUM(i.amount_outstanding), 0),
			COUNT(i.invoice_id),
			MAX(i.due_date)
		 FROM learners l
		 LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 LEFT JOIN streams s ON s.stream_id = cg.stream_id
		 JOIN invoices i ON i.learner_id = l.learner_id AND i.tenant_id = l.tenant_id
		 WHERE l.tenant_id = $1 AND i.amount_outstanding > $2
		 GROUP BY l.learner_id, l.admission_number, l.first_name, l.last_name, g.grade_label, s.stream_name
		 ORDER BY 7 DESC`,
		tenantID, minAmount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type arrears struct {
		LearnerID     string  `json:"learner_id"`
		AdmissionNo   string  `json:"admission_number"`
		LearnerName   string  `json:"learner_name"`
		GradeLabel    string  `json:"grade_label"`
		StreamName    string  `json:"stream_name"`
		Outstanding   float64 `json:"outstanding"`
		InvoiceCount  int     `json:"invoice_count"`
		OldestDueDate string  `json:"oldest_due_date"`
		Bucket        string  `json:"bucket"`
	}
	items := make([]arrears, 0)
	total := 0.0
	for rows.Next() {
		var a arrears
		var firstName, lastName, dueDate sql.NullString
		if err := rows.Scan(&a.LearnerID, &a.AdmissionNo, &firstName, &lastName, &a.GradeLabel,
			&a.StreamName, &a.Outstanding, &a.InvoiceCount, &dueDate); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		a.LearnerName = strings.TrimSpace(firstName.String + " " + lastName.String)
		a.OldestDueDate = dueDate.String
		a.Bucket = arrearsBucket(a.Outstanding)
		total += a.Outstanding
		items = append(items, a)
	}
	c.JSON(http.StatusOK, gin.H{"learners": items, "count": len(items), "total_outstanding": total})
}

func arrearsBucket(amount float64) string {
	switch {
	case amount >= 50000:
		return "90_PLUS"
	case amount >= 20000:
		return "60_90"
	case amount >= 5000:
		return "30_60"
	default:
		return "0_30"
	}
}

// SendArrearsReminders queues reminder messages for selected learners.
func (h *Handler) SendArrearsReminders(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var req struct {
		LearnerIDs []string `json:"learner_ids" binding:"required"`
		TemplateID string   `json:"template_id"`
		BodyText   string   `json:"body_text"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	templateID := interface{}(nil)
	if strings.TrimSpace(req.TemplateID) != "" {
		templateID = req.TemplateID
	}
	body := req.BodyText
	if body == "" {
		body = "Your child has an outstanding balance. Please pay at the earliest convenience."
	}

	queued := 0
	excluded := 0
	for _, learnerID := range req.LearnerIDs {
		rows, err := tx.Query(
			`SELECT gd.guardian_id, gd.phone_number
			 FROM learner_guardians lg
			 JOIN guardians gd ON gd.guardian_id = lg.guardian_id
			 WHERE lg.learner_id = $1 AND lg.is_primary_payer AND gd.tenant_id = $2`,
			learnerID, tenantID)
		if err != nil {
			continue
		}
		for rows.Next() {
			var guardianID, address string
			if err := rows.Scan(&guardianID, &address); err != nil {
				continue
			}
			_, err := tx.Exec(
				`INSERT INTO outbound_messages (tenant_id, template_id, recipient_type, recipient_id, channel, recipient_address, body_text, status, created_by)
				 VALUES ($1, $2, 'GUARDIAN', $3, 'SMS', $4, $5, 'QUEUED', $6)`,
				tenantID, templateID, guardianID, address, body, nullableString(userID))
			if err != nil {
				continue
			}
			queued++
		}
		rows.Close()
		excluded++
	}

	c.JSON(http.StatusCreated, gin.H{"queued": queued, "learners": excluded})
}

// MatchReconciliation links an unmatched M-Pesa transaction to an invoice.
func (h *Handler) MatchReconciliation(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	transactionID := c.Param("txn_id")
	var req struct {
		InvoiceID string  `json:"invoice_id" binding:"required"`
		LearnerID string  `json:"learner_id"`
		Amount    float64 `json:"amount"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var transactionAmount float64
	var billRef, status string
	err := tx.QueryRow(
		`SELECT amount, COALESCE(bill_ref, ''), status FROM mpesa_transactions WHERE trans_id = $1 AND tenant_id = $2`,
		transactionID, tenantID).Scan(&transactionAmount, &billRef, &status)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Transaction not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	if status == "MATCHED" {
		validation.Conflict(c, "Transaction is already matched")
		return
	}

	// The learner is resolved from the bill reference (admission number),
	// never from the phone number.
	learnerID := req.LearnerID
	if learnerID == "" && billRef != "" {
		_ = tx.QueryRow(
			`SELECT learner_id FROM learners WHERE tenant_id = $1 AND admission_number = $2`,
			tenantID, billRef).Scan(&learnerID)
	}
	if learnerID == "" {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "learner_id", Code: "REQUIRED", Message: "'learner_id' is required when the transaction has no bill reference"},
		})
		return
	}

	amount := req.Amount
	if amount == 0 {
		amount = transactionAmount
	}

	// Record the payment and allocate it to the invoice.
	var paymentID string
	err = tx.QueryRow(
		`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status, mpesa_trans_id, recorded_by)
		 VALUES ($1, $2, $3, 'MPESA', $4, 'COMPLETED', $5, $6) RETURNING payment_id`,
		tenantID, "MPESA-"+shortID(transactionID), learnerID, amount, transactionID, nullableString(userID)).Scan(&paymentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	_, _ = tx.Exec(
		`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount, allocated_by)
		 VALUES ($1, $2, $3, $4, $5)`,
		tenantID, paymentID, req.InvoiceID, amount, nullableString(userID))

	_, _ = tx.Exec(
		`UPDATE invoices SET amount_paid = amount_paid + $1,
		   amount_outstanding = GREATEST(amount_outstanding - $1, 0),
		   status = CASE WHEN amount_outstanding - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
		   updated_at = now()
		 WHERE invoice_id = $2 AND tenant_id = $3`, amount, req.InvoiceID, tenantID)

	_, _ = tx.Exec(
		`UPDATE mpesa_transactions SET status = 'MATCHED', updated_at = now() WHERE trans_id = $1 AND tenant_id = $2`,
		transactionID, tenantID)

	c.JSON(http.StatusOK, gin.H{"payment_id": paymentID, "transaction_id": transactionID, "status": "MATCHED"})
}

// FlagRefundForReconciliation marks a transaction for a refund.
func (h *Handler) FlagRefundForReconciliation(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	transactionID := c.Param("txn_id")
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	var learnerID string
	var amount float64
	err := tx.QueryRow(
		`SELECT COALESCE(bill_ref, ''), amount FROM mpesa_transactions WHERE trans_id = $1 AND tenant_id = $2`,
		transactionID, tenantID).Scan(&learnerID, &amount)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Transaction not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// The refund references a payment row, so make sure one exists for this
	// transaction before raising the refund.
	var paymentID string
	err = tx.QueryRow(
		`SELECT payment_id FROM payments WHERE tenant_id = $1 AND mpesa_trans_id = $2 LIMIT 1`,
		tenantID, transactionID).Scan(&paymentID)
	if err == sql.ErrNoRows {
		resolvedLearner := learnerID
		if resolvedLearner == "" {
			_ = tx.QueryRow(
				`SELECT learner_id FROM learners WHERE tenant_id = $1 AND admission_number = $2`,
				tenantID, learnerID).Scan(&resolvedLearner)
		}
		if resolvedLearner == "" {
			validation.BadRequest(c, "Invalid request", []validation.FieldError{
				{Field: "learner_id", Code: "REQUIRED", Message: "the transaction has no bill reference; provide 'learner_id'"},
			})
			return
		}
		err = tx.QueryRow(
			`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status, mpesa_trans_id, recorded_by)
			 VALUES ($1, $2, $3, 'MPESA', $4, 'COMPLETED', $5, $6) RETURNING payment_id`,
			tenantID, "MPESA-"+shortID(transactionID), resolvedLearner, amount, transactionID,
			nullableString(userID)).Scan(&paymentID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	var refundID string
	err = tx.QueryRow(
		`INSERT INTO refunds (tenant_id, payment_id, amount, reason, status, created_by)
		 VALUES ($1, $2, $3, $4, 'PENDING', $5) RETURNING refund_id`,
		tenantID, paymentID, amount, req.Reason, nullableString(userID)).Scan(&refundID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	_, _ = tx.Exec(
		`UPDATE mpesa_transactions SET status = 'REFUND_FLAGGED', updated_at = now() WHERE trans_id = $1 AND tenant_id = $2`,
		transactionID, tenantID)

	c.JSON(http.StatusCreated, gin.H{"refund_id": refundID, "transaction_id": transactionID})
}

// LearnerStatement returns everything owed and paid for one learner.
func (h *Handler) LearnerStatement(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	learnerID := c.Param("learner_id")
	tenantID := c.GetString("tenant_id")

	var learnerName, admissionNo string
	err := tx.QueryRow(
		`SELECT first_name || ' ' || last_name, admission_number FROM learners WHERE learner_id = $1 AND tenant_id = $2`,
		learnerID, tenantID).Scan(&learnerName, &admissionNo)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "Learner not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	invoices := make([]gin.H, 0)
	rows, err := tx.Query(
		`SELECT invoice_id, invoice_number, status, total_amount, amount_paid, amount_outstanding, due_date
		 FROM invoices WHERE tenant_id = $1 AND learner_id = $2 ORDER BY issue_date DESC`, tenantID, learnerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	totalOutstanding := 0.0
	for rows.Next() {
		var id, number, status string
		var total, paid, outstanding float64
		var dueDate sql.NullString
		if err := rows.Scan(&id, &number, &status, &total, &paid, &outstanding, &dueDate); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		totalOutstanding += outstanding
		invoices = append(invoices, gin.H{
			"invoice_id": id, "invoice_number": number, "status": status,
			"total_amount": total, "amount_paid": paid, "amount_outstanding": outstanding,
			"due_date": dueDate.String,
		})
	}
	rows.Close()

	payments := make([]gin.H, 0)
	rows, err = tx.Query(
		`SELECT payment_id, payment_reference, source, amount, status, received_at
		 FROM payments WHERE tenant_id = $1 AND learner_id = $2 ORDER BY received_at DESC LIMIT 50`, tenantID, learnerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	for rows.Next() {
		var id, reference, source, status, receivedAt string
		var amount float64
		if err := rows.Scan(&id, &reference, &source, &amount, &status, &receivedAt); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		payments = append(payments, gin.H{
			"payment_id": id, "payment_reference": reference, "source": source,
			"amount": amount, "status": status, "received_at": receivedAt,
		})
	}
	rows.Close()

	adjustments := make([]gin.H, 0)
	rows, err = tx.Query(
		`SELECT a.adjustment_id, a.adjustment_type, a.amount, a.reason, a.created_at
		 FROM adjustments a JOIN invoices i ON i.invoice_id = a.invoice_id
		 WHERE a.tenant_id = $1 AND i.learner_id = $2 ORDER BY a.created_at DESC`, tenantID, learnerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	for rows.Next() {
		var id, adjType, reason, createdAt string
		var amount float64
		if err := rows.Scan(&id, &adjType, &amount, &reason, &createdAt); err != nil {
			rows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		adjustments = append(adjustments, gin.H{
			"adjustment_id": id, "adjustment_type": adjType, "amount": amount,
			"reason": reason, "created_at": createdAt,
		})
	}
	rows.Close()

	c.JSON(http.StatusOK, gin.H{
		"learner_id":        learnerID,
		"learner_name":      learnerName,
		"admission_number":  admissionNo,
		"invoices":          invoices,
		"payments":          payments,
		"adjustments":       adjustments,
		"total_outstanding": totalOutstanding,
	})
}

// FinanceDashboard returns the tiles the bursar dashboard shows.
func (h *Handler) FinanceDashboard(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")

	var collected, outstanding float64
	var invoiceCount, unmatched int
	_ = tx.QueryRow(
		`SELECT COALESCE(SUM(amount_paid), 0) FROM invoices WHERE tenant_id = $1`, tenantID).Scan(&collected)
	_ = tx.QueryRow(
		`SELECT COALESCE(SUM(amount_outstanding), 0) FROM invoices WHERE tenant_id = $1`, tenantID).Scan(&outstanding)
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM invoices WHERE tenant_id = $1`, tenantID).Scan(&invoiceCount)
	_ = tx.QueryRow(
		`SELECT COUNT(*) FROM mpesa_transactions WHERE tenant_id = $1 AND status = 'UNMATCHED'`, tenantID).Scan(&unmatched)

	byGrade := make([]gin.H, 0)
	rows, err := tx.Query(
		`SELECT COALESCE(g.grade_label, 'Unassigned'),
			COALESCE(SUM(i.total_amount), 0),
			COALESCE(SUM(i.amount_paid), 0),
			COALESCE(SUM(i.amount_outstanding), 0)
		 FROM invoices i
		 LEFT JOIN learners l ON l.learner_id = i.learner_id
		 LEFT JOIN enrolments e ON e.learner_id = l.learner_id AND e.status = 'ACTIVE'
		 LEFT JOIN class_groups cg ON cg.class_group_id = e.class_group_id
		 LEFT JOIN grades g ON g.grade_id = cg.grade_id
		 WHERE i.tenant_id = $1 GROUP BY g.grade_label ORDER BY g.grade_label`, tenantID)
	if err == nil {
		for rows.Next() {
			var label string
			var total, paid, out float64
			if err := rows.Scan(&label, &total, &paid, &out); err == nil {
				byGrade = append(byGrade, gin.H{
					"grade_label": label, "total_amount": total,
					"amount_paid": paid, "amount_outstanding": out,
				})
			}
		}
		rows.Close()
	}

	c.JSON(http.StatusOK, gin.H{
		"collected":       collected,
		"outstanding":     outstanding,
		"invoice_count":   invoiceCount,
		"unmatched_count": unmatched,
		"collection_rate": collectionRate(collected, outstanding),
		"by_grade":        byGrade,
	})
}

func collectionRate(collected, outstanding float64) float64 {
	total := collected + outstanding
	if total == 0 {
		return 0
	}
	return collected / total * 100
}

// CapitationSummary totals the capitation receipts received by the school.
func (h *Handler) CapitationSummary(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	tenantID := c.GetString("tenant_id")
	rows, err := tx.Query(
		`SELECT receipt_number, capitation_period, learner_count, amount_per_learner, total_amount, status, received_at
		 FROM capitation_receipts WHERE tenant_id = $1 ORDER BY capitation_period DESC`, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	defer rows.Close()

	type receipt struct {
		ReceiptNumber    string  `json:"receipt_number"`
		Period           string  `json:"capitation_period"`
		LearnerCount     int     `json:"learner_count"`
		AmountPerLearner float64 `json:"amount_per_learner"`
		TotalAmount      float64 `json:"total_amount"`
		Status           string  `json:"status"`
		ReceivedAt       string  `json:"received_at"`
	}
	receipts := make([]receipt, 0)
	total := 0.0
	for rows.Next() {
		var r receipt
		var receivedAt sql.NullString
		if err := rows.Scan(&r.ReceiptNumber, &r.Period, &r.LearnerCount, &r.AmountPerLearner,
			&r.TotalAmount, &r.Status, &receivedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
			return
		}
		r.ReceivedAt = receivedAt.String
		total += r.TotalAmount
		receipts = append(receipts, r)
	}
	c.JSON(http.StatusOK, gin.H{"receipts": receipts, "total_received": total})
}

// CreateCapitationReceipt records a capitation grant received.
func (h *Handler) CreateCapitationReceipt(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var req struct {
		ReceiptNumber    string  `json:"receipt_number" binding:"required"`
		CapitationPeriod string  `json:"capitation_period" binding:"required"`
		LearnerCount     int     `json:"learner_count"`
		AmountPerLearner float64 `json:"amount_per_learner"`
		ReceivedAt       string  `json:"received_at"`
		Reference        string  `json:"reference"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")

	total := float64(req.LearnerCount) * req.AmountPerLearner
	var receiptID string
	err := tx.QueryRow(
		`INSERT INTO capitation_receipts
		 (tenant_id, receipt_number, capitation_period, learner_count, amount_per_learner, total_amount, received_at, reference, created_by)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING receipt_id`,
		tenantID, req.ReceiptNumber, req.CapitationPeriod, req.LearnerCount,
		req.AmountPerLearner, total, nullableString(req.ReceivedAt), nullableString(req.Reference),
		nullableString(userID)).Scan(&receiptID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"receipt_id": receiptID, "total_amount": total})
}

// STKStatus reports the state of an STK push.
func (h *Handler) STKStatus(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	stkID := c.Param("id")
	tenantID := c.GetString("tenant_id")
	var status, checkoutRequestID string
	var callbackPayload []byte
	err := tx.QueryRow(
		`SELECT status, checkout_request_id, callback_payload FROM mpesa_stk_requests WHERE stk_id = $1 AND tenant_id = $2`,
		stkID, tenantID).Scan(&status, &checkoutRequestID, &callbackPayload)
	if err == sql.ErrNoRows {
		validation.NotFound(c, "STK request not found")
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"stk_id": stkID, "status": status, "checkout_request_id": checkoutRequestID,
	})
}

// RecordPayment handles the bursar's manual cash/bank receipt. The
// idempotency key makes a double submit harmless.
func (h *Handler) RecordPayment(c *gin.Context) {
	tx := middleware.TxFromGin(c)
	if tx == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": "no tenant transaction"})
		return
	}
	var req struct {
		PaymentReference string  `json:"payment_reference" binding:"required"`
		LearnerID        string  `json:"learner_id" binding:"required"`
		Source           string  `json:"source" binding:"required"`
		Amount           float64 `json:"amount" binding:"required"`
		InvoiceID        string  `json:"invoice_id"`
	}
	if errs := validation.BindJSON(c, &req); errs != nil {
		validation.BadRequest(c, "Invalid request", errs)
		return
	}
	source := strings.ToUpper(strings.TrimSpace(req.Source))
	switch source {
	case "CASH", "BANK", "CHEQUE", "CREDIT":
	default:
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "source", Code: "INVALID_VALUE", Message: "'source' must be CASH, BANK, CHEQUE or CREDIT"},
		})
		return
	}
	if req.Amount <= 0 {
		validation.BadRequest(c, "Invalid request", []validation.FieldError{
			{Field: "amount", Code: "OUT_OF_RANGE", Message: "'amount' must be greater than zero"},
		})
		return
	}

	tenantID := c.GetString("tenant_id")
	userID := c.GetString("user_id")
	idempotencyKey := c.GetHeader("Idempotency-Key")
	if idempotencyKey == "" {
		idempotencyKey = req.PaymentReference
	}
	// The unique index on idempotency_key spans the whole table, so the
	// tenant has to be part of the key.
	idempotencyKey = tenantID + ":" + idempotencyKey

	// Replay protection: the same key returns the original payment.
	var existingID string
	err := tx.QueryRow(
		`SELECT payment_id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2`,
		tenantID, idempotencyKey).Scan(&existingID)
	if err == nil {
		c.JSON(http.StatusOK, gin.H{"payment_id": existingID, "idempotent_replay": true})
		return
	}

	var paymentID string
	err = tx.QueryRow(
		`INSERT INTO payments (tenant_id, payment_reference, learner_id, source, amount, status, recorded_by, idempotency_key)
		 VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7) RETURNING payment_id`,
		tenantID, req.PaymentReference, req.LearnerID, source, req.Amount,
		nullableString(userID), idempotencyKey).Scan(&paymentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "DB_ERROR", "message": err.Error()})
		return
	}

	// Allocate to the oldest unpaid invoice when no invoice was chosen.
	allocationInvoice := req.InvoiceID
	if allocationInvoice == "" {
		var invoiceID string
		if err := tx.QueryRow(
			`SELECT invoice_id FROM invoices WHERE tenant_id = $1 AND learner_id = $2 AND amount_outstanding > 0
			 ORDER BY due_date NULLS LAST, issue_date LIMIT 1`,
			tenantID, req.LearnerID).Scan(&invoiceID); err == nil {
			allocationInvoice = invoiceID
		}
	}
	if allocationInvoice != "" {
		_, _ = tx.Exec(
			`INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, allocated_amount, allocated_by)
			 VALUES ($1, $2, $3, $4, $5)`,
			tenantID, paymentID, allocationInvoice, req.Amount, nullableString(userID))
		_, _ = tx.Exec(
			`UPDATE invoices SET amount_paid = amount_paid + $1,
			   amount_outstanding = GREATEST(amount_outstanding - $1, 0),
			   status = CASE WHEN amount_outstanding - $1 <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
			   updated_at = now()
			 WHERE invoice_id = $2 AND tenant_id = $3`, req.Amount, allocationInvoice, tenantID)
	}

	c.JSON(http.StatusCreated, gin.H{
		"payment_id": paymentID,
		"invoice_id": allocationInvoice,
	})
}

// ---------- helpers ----------

func nullableString(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func parseFloat(s string) float64 {
	var f float64
	_, _ = fmt.Sscanf(s, "%f", &f)
	return f
}

// shortID trims a uuid to a short, human-friendly reference fragment.
func shortID(id string) string {
	clean := strings.ReplaceAll(id, "-", "")
	if len(clean) > 8 {
		return clean[:8]
	}
	return clean
}
