-- Migration 0017: wizard_state table (additive)
-- Server-side draft so any step can be resumed from any device.
-- Each step atomically commits and writes an audit event.
-- The wizard_type restricts to the two onboarding wizards.

CREATE TABLE public.wizard_state (
    tenant_id character varying(50) NOT NULL,
    wizard_type character varying(30) NOT NULL CHECK (wizard_type IN ('SUPER_ADMIN','SCHOOL_ADMIN')),
    current_step integer NOT NULL DEFAULT 1,
    status character varying(30) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
    draft jsonb NOT NULL DEFAULT '{}',
    version integer NOT NULL DEFAULT 1,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT wizard_state_pkey PRIMARY KEY (tenant_id, wizard_type),
    CONSTRAINT wizard_state_unique_step UNIQUE (tenant_id, wizard_type, current_step)
);

-- RLS
DO $$
BEGIN
    EXECUTE 'ALTER TABLE public.wizard_state ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.wizard_state FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS wizard_state_isolation ON public.wizard_state';
    EXECUTE 'CREATE POLICY wizard_state_isolation ON public.wizard_state
        USING (tenant_id = current_tenant_id())
        WITH CHECK (tenant_id = current_tenant_id())';
END $$;