-- Migration 0014: in-kind engine tables + funding sources / voteheads (additive, new tables only)
-- Conventions: id uuid, money numeric(12,2), quantities numeric(12,3).
-- All tenant-scoped; composite PK (tenant_id, id) per spec §4.

CREATE TABLE public.inventory_items (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    unit character varying(20) NOT NULL DEFAULT 'kg',
    standard_unit_weight_kg numeric(12,3),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_items_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT inventory_items_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE public.in_kind_rates (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    inventory_item_id uuid NOT NULL,
    term_id uuid NOT NULL,
    rate_per_unit numeric(12,2) NOT NULL CHECK (rate_per_unit > 0),
    is_current boolean DEFAULT true,
    effective_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT in_kind_rates_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT in_kind_rates_tenant_item_term_key UNIQUE (tenant_id, inventory_item_id, term_id),
    CONSTRAINT in_kind_rates_item_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT in_kind_rates_term_fkey FOREIGN KEY (term_id) REFERENCES public.terms (term_id) ON DELETE RESTRICT
);

CREATE TABLE public.inventory_lots (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    source_type character varying(50) NOT NULL,
    source_id uuid,
    inventory_item_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    qty_received numeric(12,3) NOT NULL CHECK (qty_received > 0),
    qty_remaining numeric(12,3) NOT NULL CHECK (qty_remaining >= 0),
    unit_cost numeric(12,4) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_lots_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT inventory_lots_item_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT inventory_lots_tenant_qty_check CHECK (qty_remaining <= qty_received)
);

CREATE TABLE public.inventory_movements (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lot_id uuid,
    inventory_item_id uuid NOT NULL,
    qty numeric(12,3) NOT NULL CHECK (qty <> 0),
    unit_cost numeric(12,4) NOT NULL,
    ref_type character varying(50) NOT NULL,
    ref_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_movements_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT inventory_movements_lot_fkey FOREIGN KEY (tenant_id, lot_id) REFERENCES public.inventory_lots (tenant_id, id) ON DELETE SET NULL,
    CONSTRAINT inventory_movements_item_fkey FOREIGN KEY (tenant_id, inventory_item_id) REFERENCES public.inventory_items (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.funding_sources (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT funding_sources_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT funding_sources_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE public.voteheads (
    tenant_id character varying(50) NOT NULL,
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    funding_source_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT voteheads_pkey PRIMARY KEY (tenant_id, id),
    CONSTRAINT voteheads_tenant_code_unique UNIQUE (tenant_id, code),
    CONSTRAINT voteheads_funding_source_fkey FOREIGN KEY (tenant_id, funding_source_id) REFERENCES public.funding_sources (tenant_id, id) ON DELETE SET NULL
);

-- RLS for the new tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        VALUES ('inventory_items'), ('in_kind_rates'), ('inventory_lots'), ('inventory_movements'),
               ('funding_sources'), ('voteheads')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_isolation ON public.%I', t, t);
        EXECUTE format('CREATE POLICY %I_isolation ON public.%I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t, t);
    END LOOP;
END $$;

-- journal_lines -> votehead FK (voteheads now exist)
ALTER TABLE public.journal_lines
    ADD CONSTRAINT journal_lines_votehead_fkey
    FOREIGN KEY (tenant_id, votehead_id) REFERENCES public.voteheads (tenant_id, id)
    ON DELETE SET NULL;