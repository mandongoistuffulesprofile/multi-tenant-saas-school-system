-- Migration: 002_in_kind_kitchen_admin_customization.sql
-- In-kind fee payment engine, kitchen/bulk cafeteria management, admin customization interfaces
-- Based on Gemini chat knowledge base for Shule Yetu multi-tenant school SaaS

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ======================================================================
-- IN-KIND FEE PAYMENT ENGINE
-- ======================================================================

-- Admin-defined commodity rates per tenant (e.g., maize=50/kg, beans=120/kg)
-- These rates are used to auto-calculate cash-equivalent value of in-kind payments
CREATE TABLE IF NOT EXISTS in_kind_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    commodity_name VARCHAR(128) NOT NULL,
    unit VARCHAR(32) NOT NULL, -- 'kg', 'bag', 'litre', 'piece', etc.
    rate_per_unit NUMERIC(12, 2) NOT NULL CHECK (rate_per_unit > 0),
    is_active BOOLEAN DEFAULT TRUE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE, -- NULL = ongoing
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_commodity_rate_period UNIQUE (tenant_id, commodity_name, unit, effective_from)
);

-- Generic inventory items for commodities and kitchen supplies
CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    item_type VARCHAR(32) NOT NULL CHECK (item_type IN ('commodity', 'kitchen_supply', 'non_food', 'other')),
    unit VARCHAR(32) NOT NULL, -- 'kg', 'bag', 'litre', 'piece', 'packet', etc.
    unit_weight_kg NUMERIC(8, 3), -- for conversion (e.g., 1 bag = 90kg)
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_item_name UNIQUE (tenant_id, item_name)
);

-- In-kind payment intake log (paper-first workflow)
-- Records physical commodities received; auto-values against in_kind_rates
CREATE TABLE IF NOT EXISTS in_kind_intake_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    intake_date DATE NOT NULL DEFAULT CURRENT_DATE,
    received_by UUID REFERENCES users(id) ON DELETE SET NULL, -- staff who recorded intake
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL, -- user who entered into system (async)
    intake_number VARCHAR(64) NOT NULL, -- paper receipt number
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'POSTED')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_intake_number UNIQUE (tenant_id, intake_number)
);

-- Line items for in-kind intake logs
CREATE TABLE IF NOT EXISTS in_kind_intake_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    intake_log_id UUID NOT NULL REFERENCES in_kind_intake_logs(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    unit VARCHAR(32) NOT NULL, -- snapshot of unit at time of intake
    rate_per_unit NUMERIC(12, 2) NOT NULL, -- snapshot of rate from in_kind_rates at intake time
    cash_equivalent NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * rate_per_unit) STORED,
    quality_grade VARCHAR(32), -- e.g., 'GRADE_1', 'GRADE_2', 'REJECTED'
    verified_quantity NUMERIC(12, 3), -- after physical verification
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dual-ledger fee payments: extend existing fee_payments or create parallel table
-- This tracks both cash (M-Pesa) and in-kind payments per student
CREATE TABLE IF NOT EXISTS fee_payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    payment_type VARCHAR(16) NOT NULL CHECK (payment_type IN ('CASH', 'IN_KIND', 'BURSARY', 'WAIVER')),
    source_reference UUID, -- FK to fee_payments.id (cash) OR in_kind_intake_logs.id (in-kind)
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0), -- cash equivalent value
    allocated_to_invoice_id UUID, -- future: FK to invoices
    allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    allocated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================================================================
-- KITCHEN / BULK CAFETERIA MANAGEMENT
-- ======================================================================

-- Meal recipes with ingredient quantities (for bulk cooking cost calculation)
CREATE TABLE IF NOT EXISTS meal_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipe_name VARCHAR(255) NOT NULL,
    meal_type VARCHAR(32) NOT NULL CHECK (meal_type IN ('BREAKFAST', 'MID_MORNING', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER')),
    servings_per_batch INTEGER NOT NULL CHECK (servings_per_batch > 0), -- how many portions one batch yields
    instructions TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_recipe_name UNIQUE (tenant_id, recipe_name)
);

-- Recipe ingredients (links to inventory_items with quantities per batch)
CREATE TABLE IF NOT EXISTS meal_recipe_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    recipe_id UUID NOT NULL REFERENCES meal_recipes(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    quantity_per_batch NUMERIC(12, 3) NOT NULL CHECK (quantity_per_batch > 0),
    unit VARCHAR(32) NOT NULL, -- snapshot of unit
    is_optional BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_recipe_ingredient UNIQUE (recipe_id, inventory_item_id)
);

-- Daily store requisitions (paper-first: kitchen staff writes on paper, admin enters async)
CREATE TABLE IF NOT EXISTS daily_store_requisitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
    meal_type VARCHAR(32) NOT NULL CHECK (meal_type IN ('BREAKFAST', 'MID_MORNING', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER')),
    expected_servings INTEGER NOT NULL CHECK (expected_servings > 0),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL, -- kitchen staff
    entered_by UUID REFERENCES users(id) ON DELETE SET NULL, -- admin who entered from paper
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'RECONCILED', 'CANCELLED')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
    issued_at TIMESTAMPTZ,
    reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reconciled_at TIMESTAMPTZ,
    paper_ref_number VARCHAR(64), -- paper requisition form number
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_requisition_date_meal UNIQUE (tenant_id, requisition_date, meal_type, paper_ref_number)
);

-- Store requisition line items (auto-populated from meal recipes, editable by kitchen)
CREATE TABLE IF NOT EXISTS store_requisition_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    requisition_id UUID NOT NULL REFERENCES daily_store_requisitions(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    recipe_id UUID REFERENCES meal_recipes(id) ON DELETE SET NULL, -- source recipe if auto-populated
    requested_quantity NUMERIC(12, 3) NOT NULL CHECK (requested_quantity > 0),
    unit VARCHAR(32) NOT NULL, -- snapshot of unit
    approved_quantity NUMERIC(12, 3), -- after admin review
    issued_quantity NUMERIC(12, 3), -- actual quantity issued from store
    actual_quantity_used NUMERIC(12, 3), -- recorded after cooking (reconciliation)
    variance_quantity NUMERIC(12, 3) GENERATED ALWAYS AS (COALESCE(issued_quantity, 0) - COALESCE(actual_quantity_used, 0)) STORED,
    variance_percentage NUMERIC(8, 2) GENERATED ALWAYS AS (
        CASE WHEN issued_quantity > 0 THEN
            ((COALESCE(issued_quantity, 0) - COALESCE(actual_quantity_used, 0)) / issued_quantity) * 100
        ELSE NULL END
    ) STORED,
    unit_cost NUMERIC(12, 2), -- cost per unit at time of requisition (from latest rate)
    line_total NUMERIC(12, 2) GENERATED ALWAYS AS (COALESCE(issued_quantity, 0) * COALESCE(unit_cost, 0)) STORED,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================================================================
-- ADMIN CUSTOMIZATION INTERFACES
-- ======================================================================

-- Admin configuration for in-kind payment variance thresholds
CREATE TABLE IF NOT EXISTS admin_in_kind_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    setting_key VARCHAR(64) NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_setting_key UNIQUE (tenant_id, setting_key)
);

-- Default admin settings (inserted via seed or application)
-- Example settings:
-- 'in_kind_variance_threshold_percent': {"warning": 5, "critical": 15}
-- 'in_kind_auto_post_on_verify': true
-- 'kitchen_variance_threshold_percent': {"warning": 3, "critical": 10}
-- 'kitchen_reconciliation_required': true
-- 'meal_costing_method': 'RECIPE_BASED' or 'ACTUAL_CONSUMPTION'

-- ======================================================================
-- ROW-LEVEL SECURITY
-- ======================================================================

ALTER TABLE in_kind_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_kind_intake_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE in_kind_intake_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_store_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_requisition_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_in_kind_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON in_kind_rates;
CREATE POLICY tenant_isolation_policy ON in_kind_rates FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON inventory_items;
CREATE POLICY tenant_isolation_policy ON inventory_items FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON in_kind_intake_logs;
CREATE POLICY tenant_isolation_policy ON in_kind_intake_logs FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON in_kind_intake_items;
CREATE POLICY tenant_isolation_policy ON in_kind_intake_items FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON fee_payment_allocations;
CREATE POLICY tenant_isolation_policy ON fee_payment_allocations FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON meal_recipes;
CREATE POLICY tenant_isolation_policy ON meal_recipes FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON meal_recipe_ingredients;
CREATE POLICY tenant_isolation_policy ON meal_recipe_ingredients FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON daily_store_requisitions;
CREATE POLICY tenant_isolation_policy ON daily_store_requisitions FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON store_requisition_items;
CREATE POLICY tenant_isolation_policy ON store_requisition_items FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation_policy ON admin_in_kind_settings;
CREATE POLICY tenant_isolation_policy ON admin_in_kind_settings FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- ======================================================================
-- INDEXES FOR PERFORMANCE
-- ======================================================================

CREATE INDEX IF NOT EXISTS idx_in_kind_rates_tenant_active ON in_kind_rates(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_in_kind_rates_commodity ON in_kind_rates(tenant_id, commodity_name, effective_from);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_type ON inventory_items(tenant_id, item_type, is_active);

CREATE INDEX IF NOT EXISTS idx_in_kind_intake_logs_tenant_student ON in_kind_intake_logs(tenant_id, student_id, intake_date);
CREATE INDEX IF NOT EXISTS idx_in_kind_intake_logs_status ON in_kind_intake_logs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_in_kind_intake_items_intake ON in_kind_intake_items(intake_log_id);

CREATE INDEX IF NOT EXISTS idx_fee_payment_allocations_tenant_student ON fee_payment_allocations(tenant_id, student_id, allocation_date);
CREATE INDEX IF NOT EXISTS idx_fee_payment_allocations_source ON fee_payment_allocations(source_reference);

CREATE INDEX IF NOT EXISTS idx_meal_recipes_tenant_type ON meal_recipes(tenant_id, meal_type, is_active);

CREATE INDEX IF NOT EXISTS idx_daily_store_requisitions_tenant_date ON daily_store_requisitions(tenant_id, requisition_date, meal_type);
CREATE INDEX IF NOT EXISTS idx_daily_store_requisitions_status ON daily_store_requisitions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_store_requisition_items_requisition ON store_requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_store_requisition_items_variance ON store_requisition_items(tenant_id, variance_percentage) WHERE variance_percentage IS NOT NULL;

-- ======================================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ======================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_in_kind_rates_updated_at BEFORE UPDATE ON in_kind_rates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_in_kind_intake_logs_updated_at BEFORE UPDATE ON in_kind_intake_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meal_recipes_updated_at BEFORE UPDATE ON meal_recipes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_store_requisitions_updated_at BEFORE UPDATE ON daily_store_requisitions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_in_kind_settings_updated_at BEFORE UPDATE ON admin_in_kind_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ======================================================================
-- SEED DEFAULT ADMIN SETTINGS (example - run per tenant)
-- ======================================================================

-- INSERT INTO admin_in_kind_settings (tenant_id, setting_key, setting_value, description) VALUES
-- ('<tenant-id>', 'in_kind_variance_threshold_percent', '{"warning": 5, "critical": 15}', 'Variance thresholds for in-kind payment quality/quantity verification'),
-- ('<tenant-id>', 'in_kind_auto_post_on_verify', 'true', 'Automatically post to fee ledger when intake is verified'),
-- ('<tenant-id>', 'kitchen_variance_threshold_percent', '{"warning": 3, "critical": 10}', 'Variance thresholds for kitchen requisition reconciliation'),
-- ('<tenant-id>', 'kitchen_reconciliation_required', 'true', 'Require daily reconciliation of store requisitions'),
-- ('<tenant-id>', 'meal_costing_method', '"RECIPE_BASED"', 'Costing method: RECIPE_BASED or ACTUAL_CONSUMPTION')
-- ON CONFLICT (tenant_id, setting_key) DO NOTHING;