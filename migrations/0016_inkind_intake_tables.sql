-- Migration 0016: in-kind intake logs, intake items, fee payment allocations (additive)
-- Conventions: id uuid, money numeric(12,2), quantities numeric(12,3).
-- All tenant-scoped; composite PK (tenant_id, id) per spec §4.

CREATE TABLE public.in_kind_intake_logs (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    student_id uuid NOT NULL,
    intake_date date NOT NULL DEFAULT CURRENT_DATE,
    received_by uuid,
    recorded_by uuid,
    intake_number character varying(50) NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','VOIDED')),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT in_kind_intake_logs_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT in_kind_intake_logs_tenant_number_unique UNIQUE (tenant_id, intake_number),
    CONSTRAINT in_kind_intake_logs_student_fkey FOREIGN KEY (student_id) REFERENCES public.learners (learner_id) ON DELETE RESTRICT,
    CONSTRAINT in_kind_intake_logs_received_fkey FOREIGN KEY (received_by) REFERENCES public.users (user_id) ON DELETE SET NULL,
    CONSTRAINT in_kind_intake_logs_recorded_fkey FOREIGN KEY (recorded_by) REFERENCES public.users (user_id) ON DELETE SET NULL
);

CREATE TABLE public.in_kind_intake_items (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    intake_log_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
    unit character varying(20) NOT NULL,
    rate_per_unit numeric(12,2) NOT NULL CHECK (rate_per_unit > 0),
    cash_equivalent numeric(12,2) NOT NULL DEFAULT 0,
    quality_grade character varying(20),
    verified_quantity numeric(12,3),
    verified_by uuid,
    verified_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT in_kind_intake_items_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT in_kind_intake_items_tenant_log_item_unique UNIQUE (tenant_id, intake_log_id, inventory_item_id),
    CONSTRAINT in_kind_intake_items_log_fkey FOREIGN KEY (tenant_id, intake_log_id) REFERENCES public.in_kind_intake_logs (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT in_kind_intake_items_inventory_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT in_kind_intake_items_verified_fkey FOREIGN KEY (verified_by) REFERENCES public.users (user_id) ON DELETE SET NULL
);

CREATE TABLE public.fee_payment_allocations (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    student_id uuid NOT NULL,
    payment_type character varying(30) NOT NULL DEFAULT 'IN_KIND' CHECK (payment_type IN ('CASH','MPESA','BANK_DIRECT','IN_KIND')),
    source_reference character varying(100),
    amount numeric(12,2) NOT NULL DEFAULT 0,
    allocated_to_invoice_id uuid,
    allocated_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fee_payment_allocations_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT fee_payment_allocations_student_fkey FOREIGN KEY (student_id) REFERENCES public.learners (learner_id) ON DELETE RESTRICT,
    CONSTRAINT fee_payment_allocations_allocated_fkey FOREIGN KEY (allocated_by) REFERENCES public.users (user_id) ON DELETE SET NULL
);

-- RLS
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        VALUES ('in_kind_intake_logs'), ('in_kind_intake_items'), ('fee_payment_allocations')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_isolation ON public.%I', t, t);
        EXECUTE format('CREATE POLICY %I_isolation ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t, t);
    END LOOP;
END $$;

-- Indexes
CREATE INDEX idx_in_kind_intake_logs_tenant_date ON public.in_kind_intake_logs (tenant_id, intake_date DESC);
CREATE INDEX idx_in_kind_intake_items_log ON public.in_kind_intake_items (tenant_id, intake_log_id);
CREATE INDEX idx_fee_payment_allocations_student ON public.fee_payment_allocations (tenant_id, student_id);