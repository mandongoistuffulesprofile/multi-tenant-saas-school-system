-- Migration 016: Create invoices and invoice lines (M10)
CREATE TABLE IF NOT EXISTS invoices (
    invoice_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    learner_id UUID NOT NULL REFERENCES learners(learner_id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(year_id) ON DELETE CASCADE,
    term_id UUID REFERENCES terms(term_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID, CANCELLED
    currency VARCHAR(3) DEFAULT 'KES',
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_outstanding NUMERIC(12,2) NOT NULL DEFAULT 0,
    issue_date DATE,
    due_date DATE,
    paid_at TIMESTAMP WITH TIME ZONE,
    voided_at TIMESTAMP WITH TIME ZONE,
    void_reason TEXT,
    created_by UUID REFERENCES users(user_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_learner ON invoices(learner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

-- RLS for invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_isolation ON invoices
    FOR ALL USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS invoice_lines (
    line_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) NOT NULL REFERENCES schools(tenant_id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES fee_categories(category_id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    academic_year_id UUID REFERENCES academic_years(year_id),
    term_id UUID REFERENCES terms(term_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_tenant ON invoice_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_category ON invoice_lines(category_id);

-- RLS for invoice_lines
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_lines_isolation ON invoice_lines
    FOR ALL USING (tenant_id = current_tenant_id());
