-- ============================================================================
-- 0000_core_tenancy_bootstrap.sql — core identity/tenancy roots
-- ============================================================================
--
-- 0001_baseline.sql was dumped from an already-provisioned database, so it
-- references `tenants`, `users`, `schools` and `tenant_memberships` without
-- ever creating them. On a fresh database the chain failed at
-- 0005_user_profile.sql ("relation users does not exist").
--
-- This migration is intentionally first and every statement is
-- IF NOT EXISTS, so an existing production database (where these tables
-- already exist with their real shape) is a no-op. Later migrations still add
-- their own columns (names, username, NEMIS, MoE profile, …).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id character varying(50) PRIMARY KEY,
    id uuid DEFAULT gen_random_uuid(),
    school_name character varying(255),
    subdomain character varying(63),
    active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_subdomain ON tenants (subdomain)
    WHERE subdomain IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
    user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email citext,
    email_norm text,
    phone_number character varying(20),
    password_hash text,
    status character varying(20) NOT NULL DEFAULT 'ACTIVE',
    is_active boolean NOT NULL DEFAULT true,
    locale character varying(10) NOT NULL DEFAULT 'en',
    failed_login_count integer NOT NULL DEFAULT 0,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    password_changed_at timestamp with time zone,
    must_change_password boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_norm ON users (email_norm)
    WHERE email_norm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone ON users (phone_number)
    WHERE phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS schools (
    tenant_id character varying(50) PRIMARY KEY,
    school_name character varying(255) NOT NULL,
    subdomain character varying(63) NOT NULL,
    knec_code character varying(20),
    kemis_code character varying(40),
    school_type character varying(50) NOT NULL DEFAULT 'PRIMARY',
    funding_mode character varying(30) NOT NULL DEFAULT 'PRIVATE',
    county character varying(50),
    sub_county character varying(50),
    address text,
    logo_ref character varying(255),
    stamp_ref character varying(255),
    head_signature_ref character varying(255),
    default_locale character varying(10) NOT NULL DEFAULT 'en',
    hosts_junior boolean NOT NULL DEFAULT false,
    license_tier character varying(30) NOT NULL DEFAULT 'STARTER',
    status character varying(20) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_schools_subdomain ON schools (subdomain);

CREATE TABLE IF NOT EXISTS streams (
    stream_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    stream_name character varying(50) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_streams_tenant_name
    ON streams (tenant_id, lower(stream_name));

CREATE TABLE IF NOT EXISTS cbc_assessment_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    student_id uuid NOT NULL,
    learning_area character varying(100) NOT NULL,
    strand character varying(150),
    sub_strand character varying(150),
    performance_level integer NOT NULL CHECK (performance_level BETWEEN 1 AND 4),
    recorded_by uuid,
    sync_id uuid NOT NULL UNIQUE,
    version bigint NOT NULL DEFAULT 1,
    recorded_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbc_events_tenant_student
    ON cbc_assessment_events (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS security_questions (
    question_id serial PRIMARY KEY,
    question_text text NOT NULL,
    display_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS terms (
    term_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    year_id uuid NOT NULL,
    term_number integer NOT NULL CHECK (term_number IN (1, 2, 3)),
    term_label character varying(50) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    midterm_start date,
    midterm_end date,
    is_current boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_terms_tenant_year ON terms (tenant_id, year_id);

CREATE TABLE IF NOT EXISTS school_payment_channels (
    channel_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    channel_type character varying(20) NOT NULL,
    shortcode_or_account character varying(30) NOT NULL,
    label character varying(100),
    environment character varying(20) NOT NULL DEFAULT 'sandbox',
    is_default boolean NOT NULL DEFAULT false,
    status character varying(20) NOT NULL DEFAULT 'ACTIVE',
    reference_format character varying(50) NOT NULL DEFAULT 'ADMISSION_NUMBER',
    routed_fee_categories text[],
    channel_token character varying(255),
    c2b_registered boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_channels_tenant
    ON school_payment_channels (tenant_id, status);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    membership_id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    tenant_id character varying(50) NOT NULL,
    role character varying(30) NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'ACTIVE',
    created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_memberships_user_tenant
    ON tenant_memberships (user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant
    ON tenant_memberships (tenant_id, status);
