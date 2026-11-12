-- ============================================================================
-- 0001_baseline.sql — canonical schema for Shule Yetu / SkulApp
--
-- Compatible with PostgreSQL 15, 16, 17 LTS (removes PG 18 named NOT NULL constraints)
-- Uses standard ANSI CHECK constraints with NOT VALID / VALIDATE pattern for
-- zero-downtime deployments on managed LTS databases (RDS, Cloud SQL, Azure).
-- ============================================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET search_path = public, pg_catalog;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- RLS context functions
DROP FUNCTION IF EXISTS public.current_tenant_id();
CREATE FUNCTION public.current_tenant_id() RETURNS character varying
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    tid VARCHAR(50);
BEGIN
    SELECT current_setting('app.current_tenant_id', true) INTO tid;
    RETURN tid;
END;
$$;

DROP FUNCTION IF EXISTS public.current_user_id();
CREATE FUNCTION public.current_user_id() RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    uid UUID;
BEGIN
    SELECT current_setting('app.current_user_id', true)::UUID INTO uid;
    RETURN uid;
END;
$$;

SET default_tablespace = '';
SET default_table_access_method = heap;

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- academic_years
CREATE TABLE IF NOT EXISTS public.academic_years (
    year_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    year_label character varying(20) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE academic_years ADD CONSTRAINT pk_academic_years PRIMARY KEY (year_id);
ALTER TABLE academic_years ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE academic_years ADD CONSTRAINT chk_academic_years_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE academic_years VALIDATE CONSTRAINT chk_academic_years_tenant_not_null;

-- access_logs
CREATE TABLE IF NOT EXISTS public.access_logs (
    log_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    user_id uuid,
    action character varying(50) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id uuid NOT NULL,
    ip_address inet,
    user_agent text,
    accessed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE access_logs ADD CONSTRAINT pk_access_logs PRIMARY KEY (log_id);
ALTER TABLE access_logs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE access_logs ADD CONSTRAINT chk_access_logs_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE access_logs VALIDATE CONSTRAINT chk_access_logs_tenant_not_null;

-- adjustments
CREATE TABLE IF NOT EXISTS public.adjustments (
    adjustment_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    invoice_id uuid NOT NULL,
    adjustment_type character varying(20) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    reason character varying(255) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE adjustments ADD CONSTRAINT pk_adjustments PRIMARY KEY (adjustment_id);
ALTER TABLE adjustments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE adjustments ADD CONSTRAINT chk_adjustments_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE adjustments VALIDATE CONSTRAINT chk_adjustments_tenant_not_null;

-- assessment_events
CREATE TABLE IF NOT EXISTS public.assessment_events (
    event_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    term_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    learning_area_id uuid NOT NULL,
    assessment_type character varying(30) NOT NULL,
    scoring_mode character varying(20) NOT NULL,
    assessment_window character varying(20) NOT NULL,
    weighting_profile_id uuid,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    max_score numeric(12,2),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE assessment_events ADD CONSTRAINT pk_assessment_events PRIMARY KEY (event_id);
ALTER TABLE assessment_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assessment_events ALTER COLUMN status SET NOT NULL;
ALTER TABLE assessment_events ADD CONSTRAINT chk_assessment_events_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE assessment_events VALIDATE CONSTRAINT chk_assessment_events_tenant_not_null;

-- assessment_result_history
CREATE TABLE IF NOT EXISTS public.assessment_result_history (
    history_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    result_id uuid NOT NULL,
    event_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    sub_strand_id uuid,
    level_code character varying(10),
    points numeric(12,2),
    raw_score numeric(12,2),
    max_score numeric(12,2),
    state character varying(20) NOT NULL,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    change_reason text
);
ALTER TABLE assessment_result_history ADD CONSTRAINT pk_assessment_result_history PRIMARY KEY (history_id);
ALTER TABLE assessment_result_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assessment_result_history ADD CONSTRAINT chk_assessment_result_history_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE assessment_result_history VALIDATE CONSTRAINT chk_assessment_result_history_tenant_not_null;

-- assessment_results
CREATE TABLE IF NOT EXISTS public.assessment_results (
    result_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    event_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    sub_strand_id uuid,
    level_code character varying(10),
    points numeric(12,2),
    raw_score numeric(12,2),
    max_score numeric(12,2),
    teacher_id uuid,
    remarks text,
    client_uuid uuid,
    version integer DEFAULT 1,
    state character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    device_id uuid,
    client_ts timestamp with time zone,
    server_ts timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE assessment_results ADD CONSTRAINT pk_assessment_results PRIMARY KEY (result_id);
ALTER TABLE assessment_results ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assessment_results ALTER COLUMN state SET NOT NULL;
ALTER TABLE assessment_results ADD CONSTRAINT chk_assessment_results_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE assessment_results VALIDATE CONSTRAINT chk_assessment_results_tenant_not_null;
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_results_client_uuid ON assessment_results (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;

-- attendance_marks
CREATE TABLE IF NOT EXISTS public.attendance_marks (
    mark_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    register_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    status character varying(20) NOT NULL,
    marked_by uuid,
    marked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    notes text,
    client_uuid uuid,
    device_id uuid,
    client_ts timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE attendance_marks ADD CONSTRAINT pk_attendance_marks PRIMARY KEY (mark_id);
ALTER TABLE attendance_marks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE attendance_marks ALTER COLUMN status SET NOT NULL;
ALTER TABLE attendance_marks ADD CONSTRAINT chk_attendance_marks_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE attendance_marks VALIDATE CONSTRAINT chk_attendance_marks_tenant_not_null;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_marks_client_uuid ON attendance_marks (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;

-- attendance_registers
CREATE TABLE IF NOT EXISTS public.attendance_registers (
    register_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    class_group_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    stream_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    term_id uuid NOT NULL,
    register_date date NOT NULL,
    session_type character varying(20) DEFAULT 'MORNING'::character varying NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    marked_by uuid,
    marked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE attendance_registers ADD CONSTRAINT pk_attendance_registers PRIMARY KEY (register_id);
ALTER TABLE attendance_registers ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE attendance_registers ALTER COLUMN session_type SET NOT NULL;
ALTER TABLE attendance_registers ALTER COLUMN status SET NOT NULL;
ALTER TABLE attendance_registers ADD CONSTRAINT chk_attendance_registers_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE attendance_registers VALIDATE CONSTRAINT chk_attendance_registers_tenant_not_null;

-- audit_events (partitioned)
CREATE TABLE IF NOT EXISTS public.audit_events (
    audit_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    user_id uuid,
    action character varying(50) NOT NULL,
    table_name character varying(50) NOT NULL,
    record_id uuid,
    old_values jsonb,
    new_values jsonb,
    reason text,
    device_id uuid,
    ip_address inet,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
)
PARTITION BY RANGE (created_at);
ALTER TABLE audit_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE audit_events ADD CONSTRAINT chk_audit_events_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE audit_events VALIDATE CONSTRAINT chk_audit_events_tenant_not_null;

CREATE TABLE IF NOT EXISTS public.audit_events_y2026m10 PARTITION OF public.audit_events
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
ALTER TABLE audit_events_y2026m10 ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE audit_events_y2026m10 ADD CONSTRAINT chk_audit_events_y2026m10_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE audit_events_y2026m10 VALIDATE CONSTRAINT chk_audit_events_y2026m10_tenant_not_null;

-- audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
    id bigint NOT NULL,
    user_id uuid,
    event text NOT NULL,
    ip inet,
    user_agent text,
    request_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE IF NOT EXISTS public.audit_log_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER TABLE audit_log ALTER COLUMN id SET DEFAULT nextval('audit_log_id_seq');
ALTER TABLE audit_log ALTER COLUMN event SET NOT NULL;
ALTER TABLE audit_log ADD CONSTRAINT pk_audit_log PRIMARY KEY (id);
ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;

-- breach_register
CREATE TABLE IF NOT EXISTS public.breach_register (
    breach_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    breach_title character varying(200) NOT NULL,
    description text NOT NULL,
    discovered_at timestamp with time zone NOT NULL,
    reported_to_authority boolean DEFAULT false,
    authority_reported_at timestamp with time zone,
    affected_data_subjects integer DEFAULT 0,
    severity character varying(20) DEFAULT 'LOW'::character varying NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    resolution_notes text,
    reported_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE breach_register ADD CONSTRAINT pk_breach_register PRIMARY KEY (breach_id);
ALTER TABLE breach_register ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE breach_register ALTER COLUMN severity SET NOT NULL;
ALTER TABLE breach_register ALTER COLUMN status SET NOT NULL;
ALTER TABLE breach_register ADD CONSTRAINT chk_breach_register_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE breach_register VALIDATE CONSTRAINT chk_breach_register_tenant_not_null;

-- broadcast_recipients
CREATE TABLE IF NOT EXISTS public.broadcast_recipients (
    recipient_id uuid DEFAULT gen_random_uuid(),
    broadcast_id uuid NOT NULL,
    recipient_type character varying(20) NOT NULL,
    recipient_id_ref uuid NOT NULL,
    channel character varying(20) NOT NULL,
    recipient_address character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(50) DEFAULT ''::character varying NOT NULL
);
ALTER TABLE broadcast_recipients ADD CONSTRAINT pk_broadcast_recipients PRIMARY KEY (recipient_id);
ALTER TABLE broadcast_recipients ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE broadcast_recipients ALTER COLUMN recipient_type SET NOT NULL;
ALTER TABLE broadcast_recipients ALTER COLUMN channel SET NOT NULL;
ALTER TABLE broadcast_recipients ALTER COLUMN recipient_address SET NOT NULL;
ALTER TABLE broadcast_recipients ALTER COLUMN status SET NOT NULL;
ALTER TABLE broadcast_recipients ADD CONSTRAINT chk_broadcast_recipients_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE broadcast_recipients VALIDATE CONSTRAINT chk_broadcast_recipients_tenant_not_null;

-- broadcasts
CREATE TABLE IF NOT EXISTS public.broadcasts (
    broadcast_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    broadcast_name character varying(150) NOT NULL,
    channel character varying(20) NOT NULL,
    target_audience character varying(50) NOT NULL,
    target_grade_ids jsonb DEFAULT '[]'::jsonb,
    subject character varying(200),
    body_text text NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    total_recipients integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE broadcasts ADD CONSTRAINT pk_broadcasts PRIMARY KEY (broadcast_id);
ALTER TABLE broadcasts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE broadcasts ALTER COLUMN channel SET NOT NULL;
ALTER TABLE broadcasts ALTER COLUMN target_audience SET NOT NULL;
ALTER TABLE broadcasts ALTER COLUMN body_text SET NOT NULL;
ALTER TABLE broadcasts ALTER COLUMN status SET NOT NULL;
ALTER TABLE broadcasts ADD CONSTRAINT chk_broadcasts_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE broadcasts VALIDATE CONSTRAINT chk_broadcasts_tenant_not_null;

-- capitation_receipts
CREATE TABLE IF NOT EXISTS public.capitation_receipts (
    receipt_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    receipt_number character varying(50) NOT NULL,
    capitation_period character varying(20) NOT NULL,
    learner_count integer DEFAULT 0 NOT NULL,
    amount_per_learner numeric(12,2) DEFAULT 0 NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    received_at date,
    reference character varying(100),
    status character varying(20) DEFAULT 'RECEIVED'::character varying NOT NULL,
    allocated_to_invoices boolean DEFAULT false,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE capitation_receipts ADD CONSTRAINT pk_capitation_receipts PRIMARY KEY (receipt_id);
ALTER TABLE capitation_receipts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE capitation_receipts ALTER COLUMN receipt_number SET NOT NULL;
ALTER TABLE capitation_receipts ALTER COLUMN capitation_period SET NOT NULL;
ALTER TABLE capitation_receipts ALTER COLUMN status SET NOT NULL;
ALTER TABLE capitation_receipts ADD CONSTRAINT chk_capitation_receipts_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE capitation_receipts VALIDATE CONSTRAINT chk_capitation_receipts_tenant_not_null;

-- class_groups
CREATE TABLE IF NOT EXISTS public.class_groups (
    class_group_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    year_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    stream_id uuid NOT NULL,
    class_teacher_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE class_groups ADD CONSTRAINT pk_class_groups PRIMARY KEY (class_group_id);
ALTER TABLE class_groups ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE class_groups ADD CONSTRAINT chk_class_groups_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE class_groups VALIDATE CONSTRAINT chk_class_groups_tenant_not_null;

-- competency_ratings
CREATE TABLE IF NOT EXISTS public.competency_ratings (
    rating_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    result_id uuid NOT NULL,
    competency_code character varying(20) NOT NULL,
    rating_level character varying(20) NOT NULL,
    rated_by uuid,
    rated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE competency_ratings ADD CONSTRAINT pk_competency_ratings PRIMARY KEY (rating_id);
ALTER TABLE competency_ratings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE competency_ratings ALTER COLUMN competency_code SET NOT NULL;
ALTER TABLE competency_ratings ALTER COLUMN rating_level SET NOT NULL;
ALTER TABLE competency_ratings ADD CONSTRAINT chk_competency_ratings_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE competency_ratings VALIDATE CONSTRAINT chk_competency_ratings_tenant_not_null;

-- consent_notices
CREATE TABLE IF NOT EXISTS public.consent_notices (
    notice_id uuid DEFAULT gen_random_uuid(),
    notice_code character varying(50) NOT NULL,
    title character varying(150) NOT NULL,
    content_text text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true,
    requires_renewal boolean DEFAULT false,
    renewal_period_days integer,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE consent_notices ADD CONSTRAINT pk_consent_notices PRIMARY KEY (notice_id);
ALTER TABLE consent_notices ALTER COLUMN notice_code SET NOT NULL;
ALTER TABLE consent_notices ALTER COLUMN title SET NOT NULL;
ALTER TABLE consent_notices ALTER COLUMN content_text SET NOT NULL;
ALTER TABLE consent_notices ALTER COLUMN version SET NOT NULL;

-- consent_records
CREATE TABLE IF NOT EXISTS public.consent_records (
    consent_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    user_id uuid NOT NULL,
    notice_id uuid NOT NULL,
    notice_version integer NOT NULL,
    granted boolean DEFAULT false NOT NULL,
    granted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE consent_records ADD CONSTRAINT pk_consent_records PRIMARY KEY (consent_id);
ALTER TABLE consent_records ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE consent_records ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE consent_records ALTER COLUMN notice_id SET NOT NULL;
ALTER TABLE consent_records ALTER COLUMN notice_version SET NOT NULL;
ALTER TABLE consent_records ALTER COLUMN granted SET NOT NULL;
ALTER TABLE consent_records ADD CONSTRAINT chk_consent_records_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE consent_records VALIDATE CONSTRAINT chk_consent_records_tenant_not_null;

-- credits
CREATE TABLE IF NOT EXISTS public.credits (
    credit_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    reason character varying(255) NOT NULL,
    source_payment_id uuid,
    expires_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE credits ADD CONSTRAINT pk_credits PRIMARY KEY (credit_id);
ALTER TABLE credits ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE credits ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE credits ALTER COLUMN reason SET NOT NULL;
ALTER TABLE credits ADD CONSTRAINT chk_credits_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE credits VALIDATE CONSTRAINT chk_credits_tenant_not_null;

-- curriculum_versions
CREATE TABLE IF NOT EXISTS public.curriculum_versions (
    version_id uuid DEFAULT gen_random_uuid(),
    version_label character varying(50) NOT NULL,
    description text,
    is_published boolean DEFAULT false,
    effective_from date,
    effective_to date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE curriculum_versions ADD CONSTRAINT pk_curriculum_versions PRIMARY KEY (version_id);
ALTER TABLE curriculum_versions ALTER COLUMN version_label SET NOT NULL;

-- delivery_receipts
CREATE TABLE IF NOT EXISTS public.delivery_receipts (
    receipt_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    message_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    provider_status character varying(50),
    delivered_at timestamp with time zone,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE delivery_receipts ADD CONSTRAINT pk_delivery_receipts PRIMARY KEY (receipt_id);
ALTER TABLE delivery_receipts ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE delivery_receipts ALTER COLUMN message_id SET NOT NULL;
ALTER TABLE delivery_receipts ALTER COLUMN channel SET NOT NULL;
ALTER TABLE delivery_receipts ADD CONSTRAINT chk_delivery_receipts_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE delivery_receipts VALIDATE CONSTRAINT chk_delivery_receipts_tenant_not_null;

-- devices
CREATE TABLE IF NOT EXISTS public.devices (
    device_id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    tenant_id character varying(50),
    fingerprint character varying(255) NOT NULL,
    label character varying(100),
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE devices ADD CONSTRAINT pk_devices PRIMARY KEY (device_id);
ALTER TABLE devices ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE devices ALTER COLUMN fingerprint SET NOT NULL;
ALTER TABLE devices ADD CONSTRAINT chk_devices_user_not_null CHECK (user_id IS NOT NULL) NOT VALID;
ALTER TABLE devices VALIDATE CONSTRAINT chk_devices_user_not_null;

-- dpia_records
CREATE TABLE IF NOT EXISTS public.dpia_records (
    dpia_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    processing_activity character varying(200) NOT NULL,
    description text NOT NULL,
    risk_level character varying(20) DEFAULT 'LOW'::character varying NOT NULL,
    mitigation_measures text,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    assessed_by uuid,
    assessed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    review_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE dpia_records ADD CONSTRAINT pk_dpia_records PRIMARY KEY (dpia_id);
ALTER TABLE dpia_records ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dpia_records ALTER COLUMN processing_activity SET NOT NULL;
ALTER TABLE dpia_records ALTER COLUMN risk_level SET NOT NULL;
ALTER TABLE dpia_records ALTER COLUMN status SET NOT NULL;
ALTER TABLE dpia_records ADD CONSTRAINT chk_dpia_records_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE dpia_records VALIDATE CONSTRAINT chk_dpia_records_tenant_not_null;

-- dsr_requests
CREATE TABLE IF NOT EXISTS public.dsr_requests (
    request_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    user_id uuid NOT NULL,
    request_type character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    description text,
    response_data jsonb DEFAULT '{}'::jsonb,
    responded_by uuid,
    responded_at timestamp with time zone,
    due_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE dsr_requests ADD CONSTRAINT pk_dsr_requests PRIMARY KEY (request_id);
ALTER TABLE dsr_requests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE dsr_requests ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE dsr_requests ALTER COLUMN request_type SET NOT NULL;
ALTER TABLE dsr_requests ALTER COLUMN status SET NOT NULL;
ALTER TABLE dsr_requests ADD CONSTRAINT chk_dsr_requests_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE dsr_requests VALIDATE CONSTRAINT chk_dsr_requests_tenant_not_null;

-- email_log
CREATE TABLE IF NOT EXISTS public.email_log (
    id bigint NOT NULL,
    user_id uuid,
    email_norm text,
    kind text NOT NULL,
    ip inet,
    request_id text,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE IF NOT EXISTS public.email_log_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER TABLE email_log ALTER COLUMN id SET DEFAULT nextval('email_log_id_seq');
ALTER TABLE email_log ALTER COLUMN kind SET NOT NULL;
ALTER TABLE email_log ADD CONSTRAINT pk_email_log PRIMARY KEY (id);
ALTER SEQUENCE public.email_log_id_seq OWNED BY public.email_log.id;

-- enrolments
CREATE TABLE IF NOT EXISTS public.enrolments (
    enrolment_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    class_group_id uuid NOT NULL,
    year_id uuid NOT NULL,
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    started_on date NOT NULL,
    ended_on date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE enrolments ADD CONSTRAINT pk_enrolments PRIMARY KEY (enrolment_id);
ALTER TABLE enrolments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE enrolments ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE enrolments ALTER COLUMN class_group_id SET NOT NULL;
ALTER TABLE enrolments ALTER COLUMN year_id SET NOT NULL;
ALTER TABLE enrolments ADD CONSTRAINT chk_enrolments_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE enrolments VALIDATE CONSTRAINT chk_enrolments_tenant_not_null;

-- evidence_files
CREATE TABLE IF NOT EXISTS public.evidence_files (
    evidence_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    result_id uuid NOT NULL,
    file_ref character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_size integer NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE evidence_files ADD CONSTRAINT pk_evidence_files PRIMARY KEY (evidence_id);
ALTER TABLE evidence_files ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE evidence_files ALTER COLUMN result_id SET NOT NULL;
ALTER TABLE evidence_files ALTER COLUMN file_ref SET NOT NULL;
ALTER TABLE evidence_files ALTER COLUMN file_name SET NOT NULL;
ALTER TABLE evidence_files ALTER COLUMN mime_type SET NOT NULL;
ALTER TABLE evidence_files ALTER COLUMN file_size SET NOT NULL;
ALTER TABLE evidence_files ADD CONSTRAINT chk_evidence_files_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE evidence_files VALIDATE CONSTRAINT chk_evidence_files_tenant_not_null;

-- exam_windows
CREATE TABLE IF NOT EXISTS public.exam_windows (
    window_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    exam_type character varying(30) NOT NULL,
    window_label character varying(100) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE exam_windows ADD CONSTRAINT pk_exam_windows PRIMARY KEY (window_id);
ALTER TABLE exam_windows ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE exam_windows ALTER COLUMN exam_type SET NOT NULL;
ALTER TABLE exam_windows ALTER COLUMN window_label SET NOT NULL;
ALTER TABLE exam_windows ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE exam_windows ALTER COLUMN end_date SET NOT NULL;
ALTER TABLE exam_windows ADD CONSTRAINT chk_exam_windows_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE exam_windows VALIDATE CONSTRAINT chk_exam_windows_tenant_not_null;

-- exports
CREATE TABLE IF NOT EXISTS public.exports (
    export_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    export_type character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    file_ref character varying(255),
    file_name character varying(255),
    file_size integer,
    record_count integer DEFAULT 0,
    parameters jsonb DEFAULT '{}'::jsonb,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone
);
ALTER TABLE exports ADD CONSTRAINT pk_exports PRIMARY KEY (export_id);
ALTER TABLE exports ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE exports ALTER COLUMN export_type SET NOT NULL;
ALTER TABLE exports ALTER COLUMN status SET NOT NULL;
ALTER TABLE exports ADD CONSTRAINT chk_exports_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE exports VALIDATE CONSTRAINT chk_exports_tenant_not_null;

-- fee_categories
CREATE TABLE IF NOT EXISTS public.fee_categories (
    category_id uuid DEFAULT gen_random_uuid(),
    code character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_tuition boolean DEFAULT false,
    is_optional boolean DEFAULT false,
    requires_consent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    tenant_id character varying(50),
    is_active boolean DEFAULT true NOT NULL
);
ALTER TABLE fee_categories ADD CONSTRAINT pk_fee_categories PRIMARY KEY (category_id);
ALTER TABLE fee_categories ALTER COLUMN code SET NOT NULL;
ALTER TABLE fee_categories ALTER COLUMN name SET NOT NULL;
ALTER TABLE fee_categories ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE fee_categories ADD CONSTRAINT chk_fee_categories_code_not_null CHECK (code IS NOT NULL) NOT VALID;
ALTER TABLE fee_categories VALIDATE CONSTRAINT chk_fee_categories_code_not_null;

-- fee_structures
CREATE TABLE IF NOT EXISTS public.fee_structures (
    structure_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    academic_year_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    category_id uuid NOT NULL,
    amount_per_term numeric(12,2) DEFAULT 0 NOT NULL,
    amount_per_year numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    is_mandatory boolean DEFAULT true,
    payment_frequency character varying(20) DEFAULT 'PER_TERM'::character varying,
    due_day integer DEFAULT 5,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE fee_structures ADD CONSTRAINT pk_fee_structures PRIMARY KEY (structure_id);
ALTER TABLE fee_structures ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE fee_structures ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE fee_structures ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE fee_structures ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE fee_structures ADD CONSTRAINT chk_fee_structures_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE fee_structures VALIDATE CONSTRAINT chk_fee_structures_tenant_not_null;

-- gate_devices
CREATE TABLE IF NOT EXISTS public.gate_devices (
    device_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    device_name character varying(100) NOT NULL,
    device_type character varying(30) DEFAULT 'KIOSK'::character varying NOT NULL,
    location character varying(100),
    pairing_code character varying(20) NOT NULL,
    is_paired boolean DEFAULT false,
    paired_at timestamp with time zone,
    paired_by uuid,
    last_seen_at timestamp with time zone,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE gate_devices ADD CONSTRAINT pk_gate_devices PRIMARY KEY (device_id);
ALTER TABLE gate_devices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE gate_devices ALTER COLUMN device_name SET NOT NULL;
ALTER TABLE gate_devices ALTER COLUMN device_type SET NOT NULL;
ALTER TABLE gate_devices ALTER COLUMN pairing_code SET NOT NULL;
ALTER TABLE gate_devices ALTER COLUMN status SET NOT NULL;
ALTER TABLE gate_devices ADD CONSTRAINT chk_gate_devices_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE gate_devices VALIDATE CONSTRAINT chk_gate_devices_tenant_not_null;

-- gate_events
CREATE TABLE IF NOT EXISTS public.gate_events (
    event_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    device_id uuid NOT NULL,
    tag_id uuid,
    holder_type character varying(20),
    holder_id uuid,
    event_type character varying(20) NOT NULL,
    event_ts timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    verified boolean DEFAULT false,
    verified_by uuid,
    verified_at timestamp with time zone,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE gate_events ADD CONSTRAINT pk_gate_events PRIMARY KEY (event_id);
ALTER TABLE gate_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE gate_events ALTER COLUMN device_id SET NOT NULL;
ALTER TABLE gate_events ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE gate_events ADD CONSTRAINT chk_gate_events_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE gate_events VALIDATE CONSTRAINT chk_gate_events_tenant_not_null;

-- grades
CREATE TABLE IF NOT EXISTS public.grades (
    grade_id character varying(20) NOT NULL,
    grade_label character varying(50) NOT NULL,
    level_band character varying(20) NOT NULL,
    lessons_per_week integer NOT NULL
);
ALTER TABLE grades ADD CONSTRAINT pk_grades PRIMARY KEY (grade_id);
ALTER TABLE grades ALTER COLUMN grade_label SET NOT NULL;
ALTER TABLE grades ALTER COLUMN level_band SET NOT NULL;
ALTER TABLE grades ALTER COLUMN lessons_per_week SET NOT NULL;

-- guardian_claim_codes
CREATE TABLE IF NOT EXISTS public.guardian_claim_codes (
    claim_code_id uuid DEFAULT gen_random_uuid(),
    learner_id uuid,
    guardian_id uuid,
    code_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE guardian_claim_codes ADD CONSTRAINT pk_guardian_claim_codes PRIMARY KEY (claim_code_id);
ALTER TABLE guardian_claim_codes ALTER COLUMN code_hash SET NOT NULL;
ALTER TABLE guardian_claim_codes ALTER COLUMN expires_at SET NOT NULL;

-- guardians
CREATE TABLE IF NOT EXISTS public.guardians (
    guardian_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    phone_number character varying(20) NOT NULL,
    alt_phone character varying(20),
    id_no_enc text,
    email character varying(100),
    language character varying(10) DEFAULT 'en'::character varying,
    user_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE guardians ADD CONSTRAINT pk_guardians PRIMARY KEY (guardian_id);
ALTER TABLE guardians ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE guardians ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE guardians ALTER COLUMN last_name SET NOT NULL;
ALTER TABLE guardians ALTER COLUMN phone_number SET NOT NULL;
ALTER TABLE guardians ADD CONSTRAINT chk_guardians_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE guardians VALIDATE CONSTRAINT chk_guardians_tenant_not_null;

-- impersonation_sessions
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
    session_id uuid DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    target_tenant_id character varying(50) NOT NULL,
    reason text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE impersonation_sessions ADD CONSTRAINT pk_impersonation_sessions PRIMARY KEY (session_id);
ALTER TABLE impersonation_sessions ALTER COLUMN admin_user_id SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN target_user_id SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN target_tenant_id SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN reason SET NOT NULL;
ALTER TABLE impersonation_sessions ALTER COLUMN expires_at SET NOT NULL;

-- import_batches
CREATE TABLE IF NOT EXISTS public.import_batches (
    batch_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    import_type character varying(30) NOT NULL,
    file_name character varying(255) NOT NULL,
    total_rows integer DEFAULT 0,
    success_rows integer DEFAULT 0,
    error_rows integer DEFAULT 0,
    status character varying(30) DEFAULT 'PENDING'::character varying,
    error_report_ref character varying(255),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    committed_at timestamp with time zone
);
ALTER TABLE import_batches ADD CONSTRAINT pk_import_batches PRIMARY KEY (batch_id);
ALTER TABLE import_batches ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE import_batches ALTER COLUMN import_type SET NOT NULL;
ALTER TABLE import_batches ALTER COLUMN file_name SET NOT NULL;
ALTER TABLE import_batches ADD CONSTRAINT chk_import_batches_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE import_batches VALIDATE CONSTRAINT chk_import_batches_tenant_not_null;

-- import_rows
CREATE TABLE IF NOT EXISTS public.import_rows (
    row_id uuid DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw_data jsonb NOT NULL,
    is_valid boolean DEFAULT false,
    error_message text,
    committed boolean DEFAULT false
);
ALTER TABLE import_rows ADD CONSTRAINT pk_import_rows PRIMARY KEY (row_id);
ALTER TABLE import_rows ALTER COLUMN batch_id SET NOT NULL;
ALTER TABLE import_rows ALTER COLUMN row_number SET NOT NULL;
ALTER TABLE import_rows ALTER COLUMN raw_data SET NOT NULL;

-- invoice_lines
CREATE TABLE IF NOT EXISTS public.invoice_lines (
    line_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    invoice_id uuid NOT NULL,
    category_id uuid NOT NULL,
    description character varying(255) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_amount numeric(12,2) DEFAULT 0 NOT NULL,
    line_amount numeric(12,2) DEFAULT 0 NOT NULL,
    academic_year_id uuid,
    term_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE invoice_lines ADD CONSTRAINT pk_invoice_lines PRIMARY KEY (line_id);
ALTER TABLE invoice_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN invoice_id SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN description SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN quantity SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN unit_amount SET NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN line_amount SET NOT NULL;
ALTER TABLE invoice_lines ADD CONSTRAINT chk_invoice_lines_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE invoice_lines VALIDATE CONSTRAINT chk_invoice_lines_tenant_not_null;

-- invoices
CREATE TABLE IF NOT EXISTS public.invoices (
    invoice_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    invoice_number character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    term_id uuid,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0 NOT NULL,
    amount_outstanding numeric(12,2) DEFAULT 0 NOT NULL,
    issue_date date,
    due_date date,
    paid_at timestamp with time zone,
    voided_at timestamp with time zone,
    void_reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE invoices ADD CONSTRAINT pk_invoices PRIMARY KEY (invoice_id);
ALTER TABLE invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN invoice_number SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN status SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN total_amount SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN amount_paid SET NOT NULL;
ALTER TABLE invoices ALTER COLUMN amount_outstanding SET NOT NULL;
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE invoices VALIDATE CONSTRAINT chk_invoices_tenant_not_null;

-- knec_export_batches
CREATE TABLE IF NOT EXISTS public.knec_export_batches (
    batch_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    tool_id uuid NOT NULL,
    batch_reference character varying(100) NOT NULL,
    learner_count integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    file_ref character varying(255),
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);
ALTER TABLE knec_export_batches ADD CONSTRAINT pk_knec_export_batches PRIMARY KEY (batch_id);
ALTER TABLE knec_export_batches ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE knec_export_batches ALTER COLUMN tool_id SET NOT NULL;
ALTER TABLE knec_export_batches ALTER COLUMN batch_reference SET NOT NULL;
ALTER TABLE knec_export_batches ALTER COLUMN status SET NOT NULL;
ALTER TABLE knec_export_batches ADD CONSTRAINT chk_knec_export_batches_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE knec_export_batches VALIDATE CONSTRAINT chk_knec_export_batches_tenant_not_null;

-- knec_submission_status
CREATE TABLE IF NOT EXISTS public.knec_submission_status (
    submission_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    tool_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    export_ref character varying(100),
    exported_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    export_payload jsonb DEFAULT '{}'::jsonb,
    variance_report jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE knec_submission_status ADD CONSTRAINT pk_knec_submission_status PRIMARY KEY (submission_id);
ALTER TABLE knec_submission_status ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE knec_submission_status ALTER COLUMN tool_id SET NOT NULL;
ALTER TABLE knec_submission_status ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE knec_submission_status ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE knec_submission_status ALTER COLUMN status SET NOT NULL;
ALTER TABLE knec_submission_status ADD CONSTRAINT chk_knec_submission_status_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE knec_submission_status VALIDATE CONSTRAINT chk_knec_submission_status_tenant_not_null;

-- knec_tools
CREATE TABLE IF NOT EXISTS public.knec_tools (
    tool_id uuid DEFAULT gen_random_uuid(),
    tool_code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    grade_id character varying(20) NOT NULL,
    assessment_year integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE knec_tools ADD CONSTRAINT pk_knec_tools PRIMARY KEY (tool_id);
ALTER TABLE knec_tools ALTER COLUMN tool_code SET NOT NULL;
ALTER TABLE knec_tools ALTER COLUMN name SET NOT NULL;
ALTER TABLE knec_tools ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE knec_tools ALTER COLUMN assessment_year SET NOT NULL;

-- learner_fee_options
CREATE TABLE IF NOT EXISTS public.learner_fee_options (
    option_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    category_id uuid NOT NULL,
    structure_id uuid NOT NULL,
    opted_in boolean DEFAULT false,
    opted_at timestamp with time zone,
    opted_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE learner_fee_options ADD CONSTRAINT pk_learner_fee_options PRIMARY KEY (option_id);
ALTER TABLE learner_fee_options ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE learner_fee_options ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE learner_fee_options ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE learner_fee_options ALTER COLUMN structure_id SET NOT NULL;
ALTER TABLE learner_fee_options ADD CONSTRAINT chk_learner_fee_options_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE learner_fee_options VALIDATE CONSTRAINT chk_learner_fee_options_tenant_not_null;

-- learner_guardians
CREATE TABLE IF NOT EXISTS public.learner_guardians (
    link_id uuid DEFAULT gen_random_uuid(),
    learner_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    relationship character varying(50) NOT NULL,
    is_primary_payer boolean DEFAULT false,
    is_emergency_contact boolean DEFAULT false,
    can_collect boolean DEFAULT false,
    can_view_fees boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE learner_guardians ADD CONSTRAINT pk_learner_guardians PRIMARY KEY (link_id);
ALTER TABLE learner_guardians ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE learner_guardians ALTER COLUMN guardian_id SET NOT NULL;
ALTER TABLE learner_guardians ALTER COLUMN relationship SET NOT NULL;

-- learner_remarks
CREATE TABLE IF NOT EXISTS public.learner_remarks (
    remark_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    event_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    remark_text text NOT NULL,
    remark_type character varying(20) DEFAULT 'GENERAL'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE learner_remarks ADD CONSTRAINT pk_learner_remarks PRIMARY KEY (remark_id);
ALTER TABLE learner_remarks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE learner_remarks ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE learner_remarks ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE learner_remarks ALTER COLUMN remark_text SET NOT NULL;
ALTER TABLE learner_remarks ALTER COLUMN remark_type SET NOT NULL;
ALTER TABLE learner_remarks ADD CONSTRAINT chk_learner_remarks_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE learner_remarks VALIDATE CONSTRAINT chk_learner_remarks_tenant_not_null;

-- learner_status_history
CREATE TABLE IF NOT EXISTS public.learner_status_history (
    history_id uuid DEFAULT gen_random_uuid(),
    learner_id uuid NOT NULL,
    tenant_id character varying(50) NOT NULL,
    previous_status character varying(30),
    new_status character varying(30) NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE learner_status_history ADD CONSTRAINT pk_learner_status_history PRIMARY KEY (history_id);
ALTER TABLE learner_status_history ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE learner_status_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE learner_status_history ALTER COLUMN new_status SET NOT NULL;
ALTER TABLE learner_status_history ADD CONSTRAINT chk_learner_status_history_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE learner_status_history VALIDATE CONSTRAINT chk_learner_status_history_tenant_not_null;

-- learners
CREATE TABLE IF NOT EXISTS public.learners (
    learner_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    admission_number character varying(50) NOT NULL,
    upi_nemis_number character varying(50),
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    last_name character varying(100) NOT NULL,
    date_of_birth date,
    gender character varying(20),
    birth_cert_no_enc text,
    sne_enc text,
    photo_ref character varying(255),
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    admitted_on date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    boarding_type character varying(20) DEFAULT 'DAY'::character varying,
    CONSTRAINT learners_boarding_type_check CHECK (((boarding_type)::text = ANY ((ARRAY['DAY'::character varying, 'BOARDING'::character varying])::text[])))
);
ALTER TABLE learners ADD CONSTRAINT pk_learners PRIMARY KEY (learner_id);
ALTER TABLE learners ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE learners ALTER COLUMN admission_number SET NOT NULL;
ALTER TABLE learners ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE learners ALTER COLUMN last_name SET NOT NULL;
ALTER TABLE learners ADD CONSTRAINT chk_learners_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE learners VALIDATE CONSTRAINT chk_learners_tenant_not_null;

-- learning_areas
CREATE TABLE IF NOT EXISTS public.learning_areas (
    area_id uuid DEFAULT gen_random_uuid(),
    version_id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    grade_band character varying(20),
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE learning_areas ADD CONSTRAINT pk_learning_areas PRIMARY KEY (area_id);
ALTER TABLE learning_areas ALTER COLUMN version_id SET NOT NULL;
ALTER TABLE learning_areas ALTER COLUMN code SET NOT NULL;
ALTER TABLE learning_areas ALTER COLUMN name SET NOT NULL;

-- login_attempts
CREATE TABLE IF NOT EXISTS public.login_attempts (
    attempt_id bigint NOT NULL,
    user_id uuid,
    email_norm text,
    ip inet NOT NULL,
    user_agent text,
    success boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE SEQUENCE IF NOT EXISTS public.login_attempts_attempt_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER TABLE login_attempts ALTER COLUMN attempt_id SET DEFAULT nextval('login_attempts_attempt_id_seq');
ALTER TABLE login_attempts ALTER COLUMN ip SET NOT NULL;
ALTER TABLE login_attempts ALTER COLUMN success SET NOT NULL;
ALTER TABLE login_attempts ADD CONSTRAINT pk_login_attempts PRIMARY KEY (attempt_id);
ALTER SEQUENCE public.login_attempts_attempt_id_seq OWNED BY public.login_attempts.attempt_id;

-- message_templates
CREATE TABLE IF NOT EXISTS public.message_templates (
    template_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50),
    template_name character varying(150) NOT NULL,
    channel character varying(20) NOT NULL,
    subject character varying(200),
    body_text text NOT NULL,
    body_html text,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE message_templates ADD CONSTRAINT pk_message_templates PRIMARY KEY (template_id);
ALTER TABLE message_templates ALTER COLUMN template_name SET NOT NULL;
ALTER TABLE message_templates ALTER COLUMN channel SET NOT NULL;
ALTER TABLE message_templates ALTER COLUMN body_text SET NOT NULL;

-- migration_runs
CREATE TABLE IF NOT EXISTS public.migration_runs (
    migration_id character varying(50) NOT NULL,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    success boolean DEFAULT true,
    error_message text
);
ALTER TABLE migration_runs ADD CONSTRAINT pk_migration_runs PRIMARY KEY (migration_id);
ALTER TABLE migration_runs ALTER COLUMN migration_id SET NOT NULL;

-- mpesa_stk_requests
CREATE TABLE IF NOT EXISTS public.mpesa_stk_requests (
    stk_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    channel_id uuid NOT NULL,
    checkout_request_id character varying(100) NOT NULL,
    merchant_request_id character varying(100) NOT NULL,
    phone_number character varying(20) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    account_reference character varying(100),
    transaction_desc character varying(100),
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    callback_received_at timestamp with time zone,
    callback_payload jsonb DEFAULT '{}'::jsonb,
    mpesa_trans_id character varying(100),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE mpesa_stk_requests ADD CONSTRAINT pk_mpesa_stk_requests PRIMARY KEY (stk_id);
ALTER TABLE mpesa_stk_requests ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mpesa_stk_requests ALTER COLUMN channel_id SET NOT NULL;
ALTER TABLE mpesa_stk_requests ALTER COLUMN checkout_request_id SET NOT NULL;
ALTER TABLE mpesa_stk_requests ALTER COLUMN merchant_request_id SET NOT NULL;
ALTER TABLE mpesa_stk_requests ALTER COLUMN phone_number SET NOT NULL;
ALTER TABLE mpesa_stk_requests ALTER COLUMN status SET NOT NULL;
ALTER TABLE mpesa_stk_requests ADD CONSTRAINT chk_mpesa_stk_requests_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE mpesa_stk_requests VALIDATE CONSTRAINT chk_mpesa_stk_requests_tenant_not_null;

-- mpesa_transactions
CREATE TABLE IF NOT EXISTS public.mpesa_transactions (
    trans_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    channel_id uuid NOT NULL,
    external_trans_id character varying(100) NOT NULL,
    shortcode character varying(20) NOT NULL,
    channel_type character varying(20) NOT NULL,
    bill_ref character varying(100),
    msisdn_masked character varying(20),
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    transaction_date timestamp with time zone,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    tenant_resolved boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE mpesa_transactions ADD CONSTRAINT pk_mpesa_transactions PRIMARY KEY (trans_id);
ALTER TABLE mpesa_transactions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN channel_id SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN external_trans_id SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN shortcode SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN channel_type SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN amount SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN status SET NOT NULL;
ALTER TABLE mpesa_transactions ALTER COLUMN raw_payload SET NOT NULL;
ALTER TABLE mpesa_transactions ADD CONSTRAINT chk_mpesa_transactions_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE mpesa_transactions VALIDATE CONSTRAINT chk_mpesa_transactions_tenant_not_null;

-- node_mappings
CREATE TABLE IF NOT EXISTS public.node_mappings (
    mapping_id uuid DEFAULT gen_random_uuid(),
    sub_strand_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    academic_year_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE node_mappings ADD CONSTRAINT pk_node_mappings PRIMARY KEY (mapping_id);
ALTER TABLE node_mappings ALTER COLUMN sub_strand_id SET NOT NULL;
ALTER TABLE node_mappings ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE node_mappings ALTER COLUMN academic_year_id SET NOT NULL;

-- opt_outs
CREATE TABLE IF NOT EXISTS public.opt_outs (
    opt_out_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    user_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    reason character varying(100),
    opted_out_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    opted_back_in_at timestamp with time zone,
    is_active boolean DEFAULT true
);
ALTER TABLE opt_outs ADD CONSTRAINT pk_opt_outs PRIMARY KEY (opt_out_id);
ALTER TABLE opt_outs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE opt_outs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE opt_outs ALTER COLUMN channel SET NOT NULL;
ALTER TABLE opt_outs ADD CONSTRAINT chk_opt_outs_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE opt_outs VALIDATE CONSTRAINT chk_opt_outs_tenant_not_null;

-- otp_challenges
CREATE TABLE IF NOT EXISTS public.otp_challenges (
    challenge_id uuid DEFAULT gen_random_uuid(),
    phone_number character varying(20) NOT NULL,
    code_hash character varying(255) NOT NULL,
    purpose character varying(30) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE otp_challenges ADD CONSTRAINT pk_otp_challenges PRIMARY KEY (challenge_id);
ALTER TABLE otp_challenges ALTER COLUMN phone_number SET NOT NULL;
ALTER TABLE otp_challenges ALTER COLUMN code_hash SET NOT NULL;
ALTER TABLE otp_challenges ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE otp_challenges ALTER COLUMN expires_at SET NOT NULL;

-- outbound_messages
CREATE TABLE IF NOT EXISTS public.outbound_messages (
    message_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    template_id uuid,
    recipient_type character varying(20) NOT NULL,
    recipient_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    recipient_address character varying(255) NOT NULL,
    subject character varying(200),
    body_text text NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    provider_message_id character varying(100),
    provider_response jsonb DEFAULT '{}'::jsonb,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    error_message text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE outbound_messages ADD CONSTRAINT pk_outbound_messages PRIMARY KEY (message_id);
ALTER TABLE outbound_messages ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN recipient_type SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN channel SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN recipient_address SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN body_text SET NOT NULL;
ALTER TABLE outbound_messages ALTER COLUMN status SET NOT NULL;
ALTER TABLE outbound_messages ADD CONSTRAINT chk_outbound_messages_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE outbound_messages VALIDATE CONSTRAINT chk_outbound_messages_tenant_not_null;

-- outbox
CREATE TABLE IF NOT EXISTS public.outbox (
    outbox_id uuid DEFAULT gen_random_uuid(),
    aggregate_type character varying(50) NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    payload jsonb NOT NULL,
    tenant_id character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    attempt_count integer DEFAULT 0
);
ALTER TABLE outbox ADD CONSTRAINT pk_outbox PRIMARY KEY (outbox_id);
ALTER TABLE outbox ALTER COLUMN aggregate_type SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN aggregate_id SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN event_type SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN payload SET NOT NULL;
ALTER TABLE outbox ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE outbox ADD CONSTRAINT chk_outbox_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE outbox VALIDATE CONSTRAINT chk_outbox_tenant_not_null;

-- password_reset_tokens
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    reset_id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    token_prefix character varying(8) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    used_by_ip inet,
    invalidated boolean DEFAULT false NOT NULL,
    created_by_ip inet,
    created_by_ua text,
    request_id text
);
ALTER TABLE password_reset_tokens ADD CONSTRAINT pk_password_reset_tokens PRIMARY KEY (reset_id);
ALTER TABLE password_reset_tokens ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE password_reset_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE password_reset_tokens ALTER COLUMN token_prefix SET NOT NULL;
ALTER TABLE password_reset_tokens ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE password_reset_tokens ALTER COLUMN invalidated SET NOT NULL;

-- payment_allocations
CREATE TABLE IF NOT EXISTS public.payment_allocations (
    allocation_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    allocated_amount numeric(12,2) DEFAULT 0 NOT NULL,
    allocated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    allocated_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE payment_allocations ADD CONSTRAINT pk_payment_allocations PRIMARY KEY (allocation_id);
ALTER TABLE payment_allocations ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payment_allocations ALTER COLUMN payment_id SET NOT NULL;
ALTER TABLE payment_allocations ALTER COLUMN invoice_id SET NOT NULL;
ALTER TABLE payment_allocations ALTER COLUMN allocated_amount SET NOT NULL;
ALTER TABLE payment_allocations ADD CONSTRAINT chk_payment_allocations_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE payment_allocations VALIDATE CONSTRAINT chk_payment_allocations_tenant_not_null;

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
    payment_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    payment_reference character varying(100) NOT NULL,
    learner_id uuid NOT NULL,
    source character varying(20) NOT NULL,
    channel_id uuid,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    mpesa_trans_id character varying(100),
    received_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    recorded_by uuid,
    idempotency_key character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE payments ADD CONSTRAINT pk_payments PRIMARY KEY (payment_id);
ALTER TABLE payments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN payment_reference SET NOT NULL;
ALTER TABLE payments ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN source SET NOT NULL;
ALTER TABLE payments ALTER COLUMN amount SET NOT NULL;
ALTER TABLE payments ALTER COLUMN status SET NOT NULL;
ALTER TABLE payments ADD CONSTRAINT chk_payments_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE payments VALIDATE CONSTRAINT chk_payments_tenant_not_null;

-- plans
CREATE TABLE IF NOT EXISTS public.plans (
    plan_id uuid DEFAULT gen_random_uuid(),
    plan_code character varying(30) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    price_monthly numeric(12,2) DEFAULT 0 NOT NULL,
    price_yearly numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    max_learners integer DEFAULT 0 NOT NULL,
    max_staff integer DEFAULT 0 NOT NULL,
    features jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE plans ADD CONSTRAINT pk_plans PRIMARY KEY (plan_id);
ALTER TABLE plans ALTER COLUMN plan_code SET NOT NULL;
ALTER TABLE plans ALTER COLUMN name SET NOT NULL;
ALTER TABLE plans ALTER COLUMN price_monthly SET NOT NULL;
ALTER TABLE plans ALTER COLUMN price_yearly SET NOT NULL;
ALTER TABLE plans ALTER COLUMN max_learners SET NOT NULL;
ALTER TABLE plans ALTER COLUMN max_staff SET NOT NULL;

-- platform_invoices
CREATE TABLE IF NOT EXISTS public.platform_invoices (
    invoice_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    invoice_number character varying(50) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    issue_date date,
    due_date date,
    paid_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE platform_invoices ADD CONSTRAINT pk_platform_invoices PRIMARY KEY (invoice_id);
ALTER TABLE platform_invoices ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE platform_invoices ALTER COLUMN invoice_number SET NOT NULL;
ALTER TABLE platform_invoices ALTER COLUMN amount SET NOT NULL;
ALTER TABLE platform_invoices ALTER COLUMN status SET NOT NULL;
ALTER TABLE platform_invoices ADD CONSTRAINT chk_platform_invoices_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE platform_invoices VALIDATE CONSTRAINT chk_platform_invoices_tenant_not_null;

-- receipt_sequences
CREATE TABLE IF NOT EXISTS public.receipt_sequences (
    sequence_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    prefix character varying(20) DEFAULT 'RCP'::character varying NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    reset_frequency character varying(20) DEFAULT 'YEARLY'::character varying,
    current_period character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE receipt_sequences ADD CONSTRAINT pk_receipt_sequences PRIMARY KEY (sequence_id);
ALTER TABLE receipt_sequences ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE receipt_sequences ALTER COLUMN prefix SET NOT NULL;
ALTER TABLE receipt_sequences ALTER COLUMN last_number SET NOT NULL;
ALTER TABLE receipt_sequences ALTER COLUMN current_period SET NOT NULL;
ALTER TABLE receipt_sequences ADD CONSTRAINT chk_receipt_sequences_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE receipt_sequences VALIDATE CONSTRAINT chk_receipt_sequences_tenant_not_null;

-- reconciliation_runs
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
    run_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    run_date date NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    total_expected numeric(12,2) DEFAULT 0 NOT NULL,
    total_received numeric(12,2) DEFAULT 0 NOT NULL,
    total_outstanding numeric(12,2) DEFAULT 0 NOT NULL,
    unmatched_transactions integer DEFAULT 0,
    status character varying(20) DEFAULT 'IN_PROGRESS'::character varying NOT NULL,
    exception_count integer DEFAULT 0,
    created_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE reconciliation_runs ADD CONSTRAINT pk_reconciliation_runs PRIMARY KEY (run_id);
ALTER TABLE reconciliation_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN run_date SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN period_start SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN period_end SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN total_expected SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN total_received SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN total_outstanding SET NOT NULL;
ALTER TABLE reconciliation_runs ALTER COLUMN status SET NOT NULL;
ALTER TABLE reconciliation_runs ADD CONSTRAINT chk_reconciliation_runs_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE reconciliation_runs VALIDATE CONSTRAINT chk_reconciliation_runs_tenant_not_null;

-- refresh_tokens
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    token_id uuid DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    device_fingerprint character varying(255)
);
ALTER TABLE refresh_tokens ADD CONSTRAINT pk_refresh_tokens PRIMARY KEY (token_id);
ALTER TABLE refresh_tokens ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN expires_at SET NOT NULL;

-- refunds
CREATE TABLE IF NOT EXISTS public.refunds (
    refund_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    payment_id uuid NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'KES'::character varying,
    reason character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    mpesa_b2c_request_id character varying(100),
    processed_at timestamp with time zone,
    processed_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE refunds ADD CONSTRAINT pk_refunds PRIMARY KEY (refund_id);
ALTER TABLE refunds ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN payment_id SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN amount SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN currency SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN reason SET NOT NULL;
ALTER TABLE refunds ALTER COLUMN status SET NOT NULL;
ALTER TABLE refunds ADD CONSTRAINT chk_refunds_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE refunds VALIDATE CONSTRAINT chk_refunds_tenant_not_null;

-- report_card_comments
CREATE TABLE IF NOT EXISTS public.report_card_comments (
    comment_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    card_id uuid NOT NULL,
    learning_area_id uuid NOT NULL,
    comment_text text NOT NULL,
    teacher_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE report_card_comments ADD CONSTRAINT pk_report_card_comments PRIMARY KEY (comment_id);
ALTER TABLE report_card_comments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE report_card_comments ALTER COLUMN card_id SET NOT NULL;
ALTER TABLE report_card_comments ALTER COLUMN learning_area_id SET NOT NULL;
ALTER TABLE report_card_comments ALTER COLUMN comment_text SET NOT NULL;
ALTER TABLE report_card_comments ADD CONSTRAINT chk_report_card_comments_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE report_card_comments VALIDATE CONSTRAINT chk_report_card_comments_tenant_not_null;

-- report_cards
CREATE TABLE IF NOT EXISTS public.report_cards (
    card_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    run_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    card_number character varying(50) NOT NULL,
    academic_year_id uuid NOT NULL,
    term_id uuid,
    grade_id character varying(20) NOT NULL,
    overall_grade character varying(10),
    total_score numeric(12,2),
    max_score numeric(12,2),
    percentage numeric(5,2),
    "position" integer,
    comment text,
    head_teacher_comment text,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    pdf_ref character varying(255),
    published_at timestamp with time zone,
    published_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE report_cards ADD CONSTRAINT pk_report_cards PRIMARY KEY (card_id);
ALTER TABLE report_cards ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN learner_id SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN card_number SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE report_cards ALTER COLUMN status SET NOT NULL;
ALTER TABLE report_cards ADD CONSTRAINT chk_report_cards_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE report_cards VALIDATE CONSTRAINT chk_report_cards_tenant_not_null;

-- report_runs
CREATE TABLE IF NOT EXISTS public.report_runs (
    run_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50) NOT NULL,
    template_id uuid NOT NULL,
    academic_year_id uuid NOT NULL,
    term_id uuid,
    grade_id character varying(20),
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    learner_count integer DEFAULT 0,
    generated_count integer DEFAULT 0,
    error_message text,
    file_ref character varying(255),
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone
);
ALTER TABLE report_runs ADD CONSTRAINT pk_report_runs PRIMARY KEY (run_id);
ALTER TABLE report_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE report_runs ALTER COLUMN template_id SET NOT NULL;
ALTER TABLE report_runs ALTER COLUMN academic_year_id SET NOT NULL;
ALTER TABLE report_runs ALTER COLUMN status SET NOT NULL;
ALTER TABLE report_runs ADD CONSTRAINT chk_report_runs_tenant_not_null CHECK (tenant_id IS NOT NULL) NOT VALID;
ALTER TABLE report_runs VALIDATE CONSTRAINT chk_report_runs_tenant_not_null;

-- report_templates
CREATE TABLE IF NOT EXISTS public.report_templates (
    template_id uuid DEFAULT gen_random_uuid(),
    tenant_id character varying(50),
    template_name character varying(150) NOT NULL,
    template_type character varying(30) NOT NULL,
    grade_band character varying(20) NOT NULL,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE report_templates ADD CONSTRAINT pk_report_templates PRIMARY KEY (template_id);
ALTER TABLE report_templates ALTER COLUMN template_name SET NOT NULL;
ALTER TABLE report_templates ALTER COLUMN template_type SET NOT NULL;
ALTER TABLE report_templates ALTER COLUMN grade_band SET NOT NULL;

-- RLS ENABLE & POLICIES
-- Enable RLS on all tenant-scoped tables
-- This is applied via separate migration 0009_force_rls.sql
-- but we document the intent here for completeness

-- Note: All tenant-scoped tables should have:
-- ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation_<table> ON <table>
--     FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', true));
-- CREATE POLICY platform_admin_<table> ON <table>
--     FOR ALL USING (current_setting('app.current_user_role', true) = 'SAAS_ADMIN');