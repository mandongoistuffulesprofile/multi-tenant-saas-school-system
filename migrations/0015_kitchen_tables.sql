-- Migration 0015: kitchen/store engine tables (additive, new tables only)
-- Conventions: id uuid, quantities numeric(12,3), money numeric(12,2).
-- All tenant-scoped; composite PK (tenant_id, id) per spec §4.

CREATE TABLE public.meal_recipes (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    meal_type character varying(20) NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','SUPPER','TEA_SNACK')),
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT meal_recipes_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT meal_recipes_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE TABLE public.recipe_items (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    recipe_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    qty_per_100 numeric(12,3) NOT NULL CHECK (qty_per_100 > 0),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT recipe_items_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT recipe_items_tenant_recipe_item_unique UNIQUE (tenant_id, recipe_id, inventory_item_id),
    CONSTRAINT recipe_items_recipe_fkey FOREIGN KEY (tenant_id, recipe_id) REFERENCES public.meal_recipes (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT recipe_items_inventory_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.daily_store_requisitions (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    slip_number character varying(50) NOT NULL,
    requisition_date date NOT NULL DEFAULT CURRENT_DATE,
    meal_type character varying(20) NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','SUPPER','TEA_SNACK')),
    recipe_id uuid,
    boarder_count_fed integer NOT NULL DEFAULT 0,
    status character varying(20) NOT NULL DEFAULT 'RECONCILED' CHECK (status IN ('RECONCILED','FLAGGED','PENDING_APPROVAL','APPROVED','REJECTED')),
    approved_by uuid,
    approved_at timestamp with time zone,
    approval_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT daily_store_requisitions_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT daily_store_requisitions_tenant_slip_unique UNIQUE (tenant_id, slip_number),
    CONSTRAINT daily_store_requisitions_recipe_fkey FOREIGN KEY (tenant_id, recipe_id) REFERENCES public.meal_recipes (tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE public.store_requisition_items (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    requisition_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    expected_qty numeric(12,3) NOT NULL DEFAULT 0,
    actual_issued_qty numeric(12,3) NOT NULL DEFAULT 0,
    variance_qty numeric(12,3) GENERATED ALWAYS AS (actual_issued_qty - expected_qty) STORED,
    variance_pct numeric(12,2) GENERATED ALWAYS AS (
        CASE WHEN expected_qty > 0
             THEN round(abs(actual_issued_qty - expected_qty) / expected_qty * 100, 2)
             ELSE CASE WHEN actual_issued_qty > 0 THEN 100 ELSE 0 END
        END
    ) STORED,
    unit_cost_at_time numeric(12,4),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT store_requisition_items_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT store_requisition_items_tenant_req_item_unique UNIQUE (tenant_id, requisition_id, inventory_item_id),
    CONSTRAINT store_requisition_items_req_fkey FOREIGN KEY (tenant_id, requisition_id) REFERENCES public.daily_store_requisitions (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT store_requisition_items_inventory_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT
);

-- Tenant settings for variance thresholds (soft/hard)
CREATE TABLE public.tenant_settings (
    tenant_id character varying(50) NOT NULL,
    key character varying(100) NOT NULL,
    value jsonb NOT NULL DEFAULT '{}',
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT tenant_settings_pkey PRIMARY KEY (tenant_id, key)
);

-- Insert default variance thresholds
INSERT INTO public.tenant_settings (tenant_id, key, value) VALUES
    ('', 'variance_thresholds', '{"soft_threshold_pct": 5, "hard_threshold_pct": 10, "hard_lock_deduction": "post_and_flag"}')
ON CONFLICT DO NOTHING;

-- RLS for the new tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        VALUES ('meal_recipes'), ('recipe_items'), ('daily_store_requisitions'),
               ('store_requisition_items'), ('tenant_settings')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_isolation ON public.%I', t, t);
        EXECUTE format('CREATE POLICY %I_isolation ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t, t);
    END LOOP;
END $$;

-- Indexes for common queries
CREATE INDEX idx_daily_store_requisitions_date ON public.daily_store_requisitions (tenant_id, requisition_date);
CREATE INDEX idx_store_requisition_items_req ON public.store_requisition_items (tenant_id, requisition_id);
CREATE INDEX idx_tenant_settings_key ON public.tenant_settings (tenant_id, key);