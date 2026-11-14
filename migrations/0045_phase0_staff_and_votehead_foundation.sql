-- ============================================================================
-- 0045_phase0_staff_and_votehead_foundation.sql
-- ============================================================================
-- Phase 0 of the boarding / extra-classes / TOD / staff-pay programme.
--
-- Three additions, no behaviour change on their own:
--
--   1. staff_profiles gains the person's name and employment status. The
--      platform onboarding path used to write those to `staff_memberships`,
--      a table that only existed in the archived migration set, so creating a
--      school with an admin name (and every staff seed row) failed with
--      "relation staff_memberships does not exist". Names now live beside the
--      rest of the staff profile, which the staff API already joins.
--
--   2. staff_compensation_profiles records what the school owes a staff
--      member: TSC, BOM or SUPPORT, plus the agreed monthly wage. TSC teachers
--      are paid by the commission, so the database refuses a non-zero wage for
--      them. SUPPORT staff (cook, driver, guard) often have no login at all,
--      so a profile may be payee-only: no membership, just a name and phone.
--
--   3. fee_categories gains votehead_id, the mapping from a billed fee line to
--      the votehead that funds it. Votehead cash and the allocation waterfall
--      both need it; without it an invoice line cannot say where its money
--      belongs.
--
-- Everything here is additive and idempotent so it can be re-run against a
-- database that already has part of the change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Staff profile identity
-- ----------------------------------------------------------------------------
ALTER TABLE public.staff_profiles
    ADD COLUMN IF NOT EXISTS first_name character varying(100),
    ADD COLUMN IF NOT EXISTS last_name character varying(100),
    ADD COLUMN IF NOT EXISTS employment_status character varying(20) NOT NULL DEFAULT 'ACTIVE';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.staff_profiles'::regclass
          AND conname = 'staff_profiles_employment_status_chk'
    ) THEN
        ALTER TABLE public.staff_profiles
            ADD CONSTRAINT staff_profiles_employment_status_chk
            CHECK (employment_status IN ('ACTIVE', 'SUSPENDED', 'LEFT')) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.staff_profiles VALIDATE CONSTRAINT staff_profiles_employment_status_chk;

-- ----------------------------------------------------------------------------
-- 2. Staff compensation profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_compensation_profiles (
    compensation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    membership_id uuid
        REFERENCES public.tenant_memberships (membership_id) ON DELETE CASCADE,
    payee_name character varying(150) NOT NULL,
    payee_phone character varying(20),
    employment_type character varying(10) NOT NULL,
    monthly_wage numeric(12,2) NOT NULL DEFAULT 0,
    -- Bank details are stored as the last four digits plus an internal
    -- reference. The account number itself is never persisted.
    bank_account_last4 character varying(4),
    bank_reference character varying(100),
    is_active boolean NOT NULL DEFAULT true,
    notes text,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT staff_compensation_employment_type_chk
        CHECK (employment_type IN ('TSC', 'BOM', 'SUPPORT')),
    -- A TSC teacher is paid by the commission; the school owes them no wage.
    CONSTRAINT staff_compensation_tsc_no_wage_chk
        CHECK (employment_type <> 'TSC' OR monthly_wage = 0),
    CONSTRAINT staff_compensation_wage_non_negative_chk
        CHECK (monthly_wage >= 0),
    -- Only SUPPORT payees may exist without a portal membership.
    CONSTRAINT staff_compensation_membership_required_chk
        CHECK (membership_id IS NOT NULL OR employment_type = 'SUPPORT'),
    CONSTRAINT staff_compensation_last4_chk
        CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^[0-9]{4}$')
);

-- One compensation profile per staff member, per school.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_compensation_tenant_membership
    ON public.staff_compensation_profiles (tenant_id, membership_id)
    WHERE membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_compensation_tenant_active
    ON public.staff_compensation_profiles (tenant_id, employment_type, is_active);

-- RLS: same isolation contract as every other tenant table.
ALTER TABLE public.staff_compensation_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_compensation_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_compensation_profiles_isolation ON public.staff_compensation_profiles;
CREATE POLICY staff_compensation_profiles_isolation ON public.staff_compensation_profiles
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- 3. Fee category -> votehead mapping
-- ----------------------------------------------------------------------------
ALTER TABLE public.fee_categories
    ADD COLUMN IF NOT EXISTS votehead_id uuid;

DO $$
BEGIN
    -- voteheads is keyed by (tenant_id, id), so the mapping is tenant-scoped by
    -- construction and cannot point at another school's votehead.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fee_categories'::regclass
          AND conname = 'fee_categories_votehead_fkey'
    ) THEN
        ALTER TABLE public.fee_categories
            ADD CONSTRAINT fee_categories_votehead_fkey
            FOREIGN KEY (tenant_id, votehead_id)
            REFERENCES public.voteheads (tenant_id, id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;

ALTER TABLE public.fee_categories VALIDATE CONSTRAINT fee_categories_votehead_fkey;

CREATE INDEX IF NOT EXISTS idx_fee_categories_votehead
    ON public.fee_categories (tenant_id, votehead_id)
    WHERE votehead_id IS NOT NULL;
