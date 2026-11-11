-- 0022_schema_integrity_hardening.sql
-- Add missing integrity constraints and worker RLS bypasses discovered in
-- production-readiness audit. Safe/idempotent where possible.

-- schools: ensure tenant_id is unique/primary key for FK and isolation integrity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.schools'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.schools ADD CONSTRAINT schools_pkey PRIMARY KEY (tenant_id);
  END IF;
END $$;

-- tenant_memberships: ensure unique membership per (user_id, tenant_id) and a PK.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_user_tenant
  ON public.tenant_memberships (user_id, tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tenant_memberships' AND column_name='membership_id'
  ) THEN
    ALTER TABLE public.tenant_memberships ADD COLUMN membership_id uuid DEFAULT gen_random_uuid();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tenant_memberships'::regclass AND contype = 'p'
  ) THEN
    UPDATE public.tenant_memberships SET membership_id = gen_random_uuid() WHERE membership_id IS NULL;
    ALTER TABLE public.tenant_memberships ALTER COLUMN membership_id SET NOT NULL;
    ALTER TABLE public.tenant_memberships ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (membership_id);
  END IF;
END $$;

-- Allow cross-tenant outbound message dispatch worker (app.worker = 'on'),
-- mirroring outbox/mpesa inbox RLS bypass patterns.
DROP POLICY IF EXISTS outbound_messages_isolation ON public.outbound_messages;
CREATE POLICY outbound_messages_isolation ON public.outbound_messages
    USING (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id())
    WITH CHECK (current_setting('app.worker', true) = 'on' OR tenant_id = current_tenant_id());

-- Attendance sync conflict/version support (safe if already present).
ALTER TABLE public.attendance_marks ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
UPDATE public.attendance_marks SET version = 1 WHERE version IS NULL;
