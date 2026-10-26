-- Migration 0013: double-entry ledger tables (additive, new tables only)
-- id type: uuid (matches baseline conventions). Money: numeric(12,2).
-- RLS: enabled via force loop in migrations/0009_force_rls.sql; isolation
-- policies added below. Composite FKs where they reference tenant tables.

CREATE TABLE public.ledger_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(20) NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
    funding_source_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ledger_accounts_pkey PRIMARY KEY (id),
    CONSTRAINT ledger_accounts_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE TABLE public.journal_entries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    entry_date timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_type character varying(50),
    source_id uuid,
    memo text,
    reverses_entry_id uuid,
    is_test boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT journal_entries_pkey PRIMARY KEY (id)
);

CREATE TABLE public.journal_lines (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    entry_id uuid NOT NULL,
    account_id uuid NOT NULL,
    student_id uuid,
    votehead_id uuid,
    debit numeric(12,2) DEFAULT 0 NOT NULL,
    credit numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT journal_lines_pkey PRIMARY KEY (id),
    CONSTRAINT journal_lines_debit_credit_one_zero CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0)),
    CONSTRAINT journal_lines_entry_fkey FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE,
    CONSTRAINT journal_lines_account_fkey FOREIGN KEY (account_id) REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT
);

-- RLS policies
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_accounts_isolation ON public.ledger_accounts;
CREATE POLICY ledger_accounts_isolation ON public.ledger_accounts
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_entries_isolation ON public.journal_entries;
CREATE POLICY journal_entries_isolation ON public.journal_entries
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS journal_lines_isolation ON public.journal_lines;
CREATE POLICY journal_lines_isolation ON public.journal_lines
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Composite FK after tenant-scoped parent exists (same-tenant reference safety).
-- NOTE: existing learners/users PK is single-column (learner_id, user_id).
-- New tables (voteheads, funding_sources, inventory_lots, etc.) will use
-- composite PKs (tenant_id, id). For existing tables we use single-column FK.
ALTER TABLE public.journal_lines
    ADD CONSTRAINT journal_lines_student_fkey
    FOREIGN KEY (student_id) REFERENCES public.learners (learner_id) ON DELETE SET NULL;
-- votehead FK is added in migrations/0014 once voteheads exists.
