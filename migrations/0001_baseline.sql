-- ============================================================================
-- 0001_baseline.sql — canonical schema for SkulApp / EduKe
--
-- Generated from the working development database (PostgreSQL 18) on
-- 2026-10-23, then reviewed. This replaces the contradictory slice0..slice8
-- migrations, which referenced a `schools` table that no migration created,
-- `users(user_id)` that did not exist, and mixed VARCHAR/UUID tenant ids.
--
-- Requires PostgreSQL 18+ (the dump uses named NOT NULL constraints).
-- No data. Seed data lives in migrations/seed/.
-- ============================================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET search_path = public, pg_catalog;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: current_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: current_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

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


--
-- Name: set_tenant_context(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_tenant_context() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- This function is called via SET LOCAL app.current_tenant_id per transaction
    -- The trigger ensures the context is set before any DML
    NULL;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_years; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_years (
    year_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    year_label character varying(20) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_current boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_logs (
    log_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    user_id uuid,
    action character varying(50) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id uuid NOT NULL,
    ip_address inet,
    user_agent text,
    accessed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adjustments (
    adjustment_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    invoice_id uuid NOT NULL,
    adjustment_type character varying(20) NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    reason character varying(255) NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: assessment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_events (
    event_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: assessment_result_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_result_history (
    history_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: assessment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_results (
    result_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: attendance_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_marks (
    mark_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: attendance_registers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_registers (
    register_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    audit_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: audit_events_y2026m10; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events_y2026m10 (
    audit_id uuid DEFAULT public.uuid_generate_v4() CONSTRAINT audit_events_audit_id_not_null NOT NULL,
    tenant_id character varying(50) CONSTRAINT audit_events_tenant_id_not_null NOT NULL,
    user_id uuid,
    action character varying(50) CONSTRAINT audit_events_action_not_null NOT NULL,
    table_name character varying(50) CONSTRAINT audit_events_table_name_not_null NOT NULL,
    record_id uuid,
    old_values jsonb,
    new_values jsonb,
    reason text,
    device_id uuid,
    ip_address inet,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP CONSTRAINT audit_events_created_at_not_null NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    user_id uuid,
    event text NOT NULL,
    ip inet,
    user_agent text,
    request_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: breach_register; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.breach_register (
    breach_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: broadcast_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_recipients (
    recipient_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcasts (
    broadcast_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: capitation_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capitation_receipts (
    receipt_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: class_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_groups (
    class_group_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    year_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    stream_id uuid NOT NULL,
    class_teacher_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: competency_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competency_ratings (
    rating_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    result_id uuid NOT NULL,
    competency_code character varying(20) NOT NULL,
    rating_level character varying(20) NOT NULL,
    rated_by uuid,
    rated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: consent_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_notices (
    notice_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    consent_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credits (
    credit_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: curriculum_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_versions (
    version_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    version_label character varying(50) NOT NULL,
    description text,
    is_published boolean DEFAULT false,
    effective_from date,
    effective_to date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: delivery_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_receipts (
    receipt_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    message_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    provider_status character varying(50),
    delivered_at timestamp with time zone,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    device_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id character varying(50),
    fingerprint character varying(255) NOT NULL,
    label character varying(100),
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: dpia_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dpia_records (
    dpia_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: dsr_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dsr_requests (
    request_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id bigint NOT NULL,
    user_id uuid,
    email_norm text,
    kind text NOT NULL,
    ip inet,
    request_id text,
    sent_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: email_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_log_id_seq OWNED BY public.email_log.id;


--
-- Name: enrolments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrolments (
    enrolment_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    class_group_id uuid NOT NULL,
    year_id uuid NOT NULL,
    status character varying(30) DEFAULT 'ACTIVE'::character varying,
    started_on date NOT NULL,
    ended_on date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: evidence_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_files (
    evidence_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    result_id uuid NOT NULL,
    file_ref character varying(255) NOT NULL,
    file_name character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_size integer NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: exam_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_windows (
    window_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    exam_type character varying(30) NOT NULL,
    window_label character varying(100) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: exports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exports (
    export_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: fee_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_categories (
    category_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: fee_structures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fee_structures (
    structure_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: gate_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gate_devices (
    device_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: gate_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gate_events (
    event_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: grades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grades (
    grade_id character varying(20) NOT NULL,
    grade_label character varying(50) NOT NULL,
    level_band character varying(20) NOT NULL,
    lessons_per_week integer NOT NULL
);


--
-- Name: guardian_claim_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardian_claim_codes (
    claim_code_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    learner_id uuid,
    guardian_id uuid,
    code_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: guardians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guardians (
    guardian_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: impersonation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impersonation_sessions (
    session_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    admin_user_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    target_tenant_id character varying(50) NOT NULL,
    reason text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    batch_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_rows (
    row_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    raw_data jsonb NOT NULL,
    is_valid boolean DEFAULT false,
    error_message text,
    committed boolean DEFAULT false
);


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_lines (
    line_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    invoice_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: knec_export_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knec_export_batches (
    batch_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: knec_submission_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knec_submission_status (
    submission_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: knec_tools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knec_tools (
    tool_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tool_code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    grade_id character varying(20) NOT NULL,
    assessment_year integer NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: learner_fee_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_fee_options (
    option_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: learner_guardians; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_guardians (
    link_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    learner_id uuid NOT NULL,
    guardian_id uuid NOT NULL,
    relationship character varying(50) NOT NULL,
    is_primary_payer boolean DEFAULT false,
    is_emergency_contact boolean DEFAULT false,
    can_collect boolean DEFAULT false,
    can_view_fees boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: learner_remarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_remarks (
    remark_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    event_id uuid NOT NULL,
    learner_id uuid NOT NULL,
    remark_text text NOT NULL,
    remark_type character varying(20) DEFAULT 'GENERAL'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: learner_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_status_history (
    history_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    learner_id uuid NOT NULL,
    tenant_id character varying(50) NOT NULL,
    previous_status character varying(30),
    new_status character varying(30) NOT NULL,
    reason text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: learners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learners (
    learner_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: learning_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_areas (
    area_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    version_id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    grade_band character varying(20),
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    attempt_id bigint NOT NULL,
    user_id uuid,
    email_norm text,
    ip inet NOT NULL,
    user_agent text,
    success boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: login_attempts_attempt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_attempts_attempt_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts_attempt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_attempts_attempt_id_seq OWNED BY public.login_attempts.attempt_id;


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    template_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: migration_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_runs (
    migration_id character varying(50) NOT NULL,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    success boolean DEFAULT true,
    error_message text
);


--
-- Name: mpesa_stk_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mpesa_stk_requests (
    stk_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: mpesa_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mpesa_transactions (
    trans_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: node_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_mappings (
    mapping_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sub_strand_id uuid NOT NULL,
    grade_id character varying(20) NOT NULL,
    academic_year_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_outs (
    opt_out_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    user_id uuid NOT NULL,
    channel character varying(20) NOT NULL,
    reason character varying(100),
    opted_out_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    opted_back_in_at timestamp with time zone,
    is_active boolean DEFAULT true
);


--
-- Name: otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_challenges (
    challenge_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    phone_number character varying(20) NOT NULL,
    code_hash character varying(255) NOT NULL,
    purpose character varying(30) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: outbound_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_messages (
    message_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox (
    outbox_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    aggregate_type character varying(50) NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type character varying(50) NOT NULL,
    event_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payload jsonb NOT NULL,
    tenant_id character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    attempt_count integer DEFAULT 0
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    reset_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: payment_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_allocations (
    allocation_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    payment_id uuid NOT NULL,
    invoice_id uuid NOT NULL,
    allocated_amount numeric(12,2) DEFAULT 0 NOT NULL,
    allocated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    allocated_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    payment_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    plan_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: platform_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_invoices (
    invoice_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: receipt_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receipt_sequences (
    sequence_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    prefix character varying(20) DEFAULT 'RCP'::character varying NOT NULL,
    last_number integer DEFAULT 0 NOT NULL,
    reset_frequency character varying(20) DEFAULT 'YEARLY'::character varying,
    current_period character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reconciliation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_runs (
    run_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    token_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    device_fingerprint character varying(255)
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    refund_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: report_card_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_card_comments (
    comment_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    card_id uuid NOT NULL,
    learning_area_id uuid NOT NULL,
    comment_text text NOT NULL,
    teacher_id uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: report_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_cards (
    card_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: report_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_runs (
    run_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
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


--
-- Name: report_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_templates (
    template_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50),
    template_name character varying(150) NOT NULL,
    template_type character varying(30) NOT NULL,
    grade_band character varying(20) NOT NULL,
    is_default boolean DEFAULT false,
    is_active boolean DEFAULT true,
    template_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: reset_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reset_challenges (
    challenge_id bigint NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by_ip inet,
    request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reset_challenges_challenge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reset_challenges_challenge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reset_challenges_challenge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reset_challenges_challenge_id_seq OWNED BY public.reset_challenges.challenge_id;


--
-- Name: retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policies (
    policy_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    resource_type character varying(50) NOT NULL,
    retention_days integer NOT NULL,
    action_after_retention character varying(30) NOT NULL,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: rfid_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfid_tags (
    tag_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    tag_uid character varying(50) NOT NULL,
    holder_type character varying(20) NOT NULL,
    holder_id uuid NOT NULL,
    is_active boolean DEFAULT true,
    issued_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deactivated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: school_finance_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_finance_settings (
    setting_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    tuition_invoicing boolean DEFAULT false,
    optional_services boolean DEFAULT false,
    capitation_tracking boolean DEFAULT false,
    allowed_fee_categories jsonb DEFAULT '[]'::jsonb,
    arrears_reminders boolean DEFAULT true,
    report_withholding boolean DEFAULT false,
    gate_arrears_denial boolean DEFAULT false,
    preset_label character varying(30) DEFAULT 'CUSTOM'::character varying,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: school_payment_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_payment_channels (
    channel_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    channel_type character varying(20) NOT NULL,
    shortcode_or_account character varying(50) NOT NULL,
    label character varying(100) NOT NULL,
    environment character varying(20) DEFAULT 'sandbox'::character varying,
    is_default boolean DEFAULT false,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    reference_format character varying(30) DEFAULT 'ADMISSION_NO'::character varying,
    routed_fee_categories jsonb DEFAULT '[]'::jsonb,
    secret_refs jsonb DEFAULT '{}'::jsonb,
    channel_token character varying(100) NOT NULL,
    c2b_registered boolean DEFAULT false,
    c2b_registered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: school_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.school_settings (
    setting_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    tenant_id character varying(50) NOT NULL,
    school_name character varying(150) NOT NULL,
    subdomain character varying(100) NOT NULL,
    license_tier character varying(30) DEFAULT 'STANDARD'::character varying,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    knec_code character varying(50),
    kemis_code character varying(50),
    school_type character varying(30) DEFAULT 'PRIVATE'::character varying,
    funding_mode character varying(30) DEFAULT 'CUSTOM'::character varying,
    county character varying(100),
    sub_county character varying(100),
    address text,
    logo_ref character varying(255),
    stamp_ref character varying(255),
    head_signature_ref character varying(255),
    default_locale character varying(10) DEFAULT 'en'::character varying,
    hosts_junior boolean DEFAULT false
);


--
-- Name: security_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_questions (
    question_id integer NOT NULL,
    question_text text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL
);


--
-- Name: security_questions_question_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_questions_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_questions_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_questions_question_id_seq OWNED BY public.security_questions.question_id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    session_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    session_token text NOT NULL,
    user_agent text,
    ip inet,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL
);


--
-- Name: staff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_profiles (
    profile_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    membership_id uuid NOT NULL,
    tsc_number character varying(50),
    national_id character varying(50),
    subjects jsonb DEFAULT '[]'::jsonb,
    employment_date date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: strands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strands (
    strand_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    area_id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: streams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.streams (
    stream_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    stream_name character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sub_strands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sub_strands (
    sub_strand_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    strand_id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    subscription_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    plan_id uuid NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ends_at timestamp with time zone,
    auto_renew boolean DEFAULT true,
    payment_channel_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_conflicts (
    conflict_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    client_version integer NOT NULL,
    server_version integer NOT NULL,
    client_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    server_values jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved boolean DEFAULT false,
    resolution_values jsonb DEFAULT '{}'::jsonb,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_log (
    sync_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    device_id uuid NOT NULL,
    sync_type character varying(20) NOT NULL,
    items_sent integer DEFAULT 0,
    items_received integer DEFAULT 0,
    conflicts integer DEFAULT 0,
    started_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone,
    status character varying(20) DEFAULT 'IN_PROGRESS'::character varying NOT NULL,
    error_message text
);


--
-- Name: teaching_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teaching_assignments (
    assignment_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    staff_membership_id uuid NOT NULL,
    class_group_id uuid NOT NULL,
    subject_id character varying(50) NOT NULL,
    academic_year_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tenant_curriculum_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_curriculum_pins (
    pin_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    version_id uuid NOT NULL,
    pinned_by uuid,
    pinned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_memberships (
    membership_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id character varying(50) NOT NULL,
    role character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tenant_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_usage (
    usage_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    period_month character varying(7) NOT NULL,
    active_learners integer DEFAULT 0,
    active_staff integer DEFAULT 0,
    sms_sent integer DEFAULT 0,
    reports_generated integer DEFAULT 0,
    assessments_recorded integer DEFAULT 0,
    payments_processed integer DEFAULT 0,
    gate_taps integer DEFAULT 0,
    storage_mb integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: terms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terms (
    term_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    year_id uuid NOT NULL,
    term_number integer NOT NULL,
    term_label character varying(50) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    midterm_start date,
    midterm_end date,
    is_current boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transfers (
    transfer_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id character varying(50) NOT NULL,
    learner_id uuid NOT NULL,
    transfer_type character varying(20) NOT NULL,
    reason text,
    destination_school character varying(150),
    source_school character varying(150),
    transfer_date date NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_security_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_security_answers (
    answer_id bigint NOT NULL,
    user_id uuid NOT NULL,
    question_id integer NOT NULL,
    answer_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_security_answers_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_security_answers_answer_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_security_answers_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_security_answers_answer_id_seq OWNED BY public.user_security_answers.answer_id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(100),
    phone_number character varying(20) NOT NULL,
    password_hash character varying(255) NOT NULL,
    locale character varying(10) DEFAULT 'en'::character varying,
    status character varying(20) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    email_norm text,
    CONSTRAINT users_email_or_phone CHECK (((email IS NOT NULL) OR (phone_number IS NOT NULL)))
);


--
-- Name: weighting_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weighting_profiles (
    profile_id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    grade_id character varying(20) NOT NULL,
    weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_default boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: audit_events_y2026m10; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ATTACH PARTITION public.audit_events_y2026m10 FOR VALUES FROM ('2026-10-01 00:00:00+03') TO ('2026-11-01 00:00:00+03');


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: email_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log ALTER COLUMN id SET DEFAULT nextval('public.email_log_id_seq'::regclass);


--
-- Name: login_attempts attempt_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN attempt_id SET DEFAULT nextval('public.login_attempts_attempt_id_seq'::regclass);


--
-- Name: reset_challenges challenge_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_challenges ALTER COLUMN challenge_id SET DEFAULT nextval('public.reset_challenges_challenge_id_seq'::regclass);


--
-- Name: security_questions question_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_questions ALTER COLUMN question_id SET DEFAULT nextval('public.security_questions_question_id_seq'::regclass);


--
-- Name: user_security_answers answer_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_security_answers ALTER COLUMN answer_id SET DEFAULT nextval('public.user_security_answers_answer_id_seq'::regclass);


--
-- Name: academic_years academic_years_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_pkey PRIMARY KEY (year_id);


--
-- Name: academic_years academic_years_tenant_id_year_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_tenant_id_year_label_key UNIQUE (tenant_id, year_label);


--
-- Name: access_logs access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_pkey PRIMARY KEY (log_id);


--
-- Name: adjustments adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_pkey PRIMARY KEY (adjustment_id);


--
-- Name: assessment_events assessment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_pkey PRIMARY KEY (event_id);


--
-- Name: assessment_result_history assessment_result_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_pkey PRIMARY KEY (history_id);


--
-- Name: assessment_results assessment_results_event_id_learner_id_sub_strand_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_event_id_learner_id_sub_strand_id_key UNIQUE (event_id, learner_id, sub_strand_id);


--
-- Name: assessment_results assessment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_pkey PRIMARY KEY (result_id);


--
-- Name: attendance_marks attendance_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_pkey PRIMARY KEY (mark_id);


--
-- Name: attendance_marks attendance_marks_register_id_learner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_register_id_learner_id_key UNIQUE (register_id, learner_id);


--
-- Name: attendance_registers attendance_registers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_pkey PRIMARY KEY (register_id);


--
-- Name: attendance_registers attendance_registers_tenant_id_class_group_id_register_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_tenant_id_class_group_id_register_date_key UNIQUE (tenant_id, class_group_id, register_date, session_type);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (audit_id, created_at);


--
-- Name: audit_events_y2026m10 audit_events_y2026m10_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events_y2026m10
    ADD CONSTRAINT audit_events_y2026m10_pkey PRIMARY KEY (audit_id, created_at);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: breach_register breach_register_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breach_register
    ADD CONSTRAINT breach_register_pkey PRIMARY KEY (breach_id);


--
-- Name: broadcast_recipients broadcast_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_pkey PRIMARY KEY (recipient_id);


--
-- Name: broadcasts broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (broadcast_id);


--
-- Name: capitation_receipts capitation_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capitation_receipts
    ADD CONSTRAINT capitation_receipts_pkey PRIMARY KEY (receipt_id);


--
-- Name: capitation_receipts capitation_receipts_tenant_id_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capitation_receipts
    ADD CONSTRAINT capitation_receipts_tenant_id_receipt_number_key UNIQUE (tenant_id, receipt_number);


--
-- Name: class_groups class_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_pkey PRIMARY KEY (class_group_id);


--
-- Name: class_groups class_groups_tenant_id_year_id_grade_id_stream_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_tenant_id_year_id_grade_id_stream_id_key UNIQUE (tenant_id, year_id, grade_id, stream_id);


--
-- Name: competency_ratings competency_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_ratings
    ADD CONSTRAINT competency_ratings_pkey PRIMARY KEY (rating_id);


--
-- Name: competency_ratings competency_ratings_result_id_competency_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_ratings
    ADD CONSTRAINT competency_ratings_result_id_competency_code_key UNIQUE (result_id, competency_code);


--
-- Name: consent_notices consent_notices_notice_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_notice_code_key UNIQUE (notice_code);


--
-- Name: consent_notices consent_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_pkey PRIMARY KEY (notice_id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (consent_id);


--
-- Name: consent_records consent_records_tenant_id_user_id_notice_id_notice_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_tenant_id_user_id_notice_id_notice_version_key UNIQUE (tenant_id, user_id, notice_id, notice_version);


--
-- Name: credits credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_pkey PRIMARY KEY (credit_id);


--
-- Name: curriculum_versions curriculum_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_versions
    ADD CONSTRAINT curriculum_versions_pkey PRIMARY KEY (version_id);


--
-- Name: curriculum_versions curriculum_versions_version_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_versions
    ADD CONSTRAINT curriculum_versions_version_label_key UNIQUE (version_label);


--
-- Name: delivery_receipts delivery_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_pkey PRIMARY KEY (receipt_id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (device_id);


--
-- Name: dpia_records dpia_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpia_records
    ADD CONSTRAINT dpia_records_pkey PRIMARY KEY (dpia_id);


--
-- Name: dsr_requests dsr_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsr_requests
    ADD CONSTRAINT dsr_requests_pkey PRIMARY KEY (request_id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: enrolments enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_pkey PRIMARY KEY (enrolment_id);


--
-- Name: enrolments enrolments_tenant_id_learner_id_year_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_tenant_id_learner_id_year_id_key UNIQUE (tenant_id, learner_id, year_id);


--
-- Name: evidence_files evidence_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_files
    ADD CONSTRAINT evidence_files_pkey PRIMARY KEY (evidence_id);


--
-- Name: exam_windows exam_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_windows
    ADD CONSTRAINT exam_windows_pkey PRIMARY KEY (window_id);


--
-- Name: exports exports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_pkey PRIMARY KEY (export_id);


--
-- Name: fee_categories fee_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_categories
    ADD CONSTRAINT fee_categories_pkey PRIMARY KEY (category_id);


--
-- Name: fee_structures fee_structures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_pkey PRIMARY KEY (structure_id);


--
-- Name: fee_structures fee_structures_tenant_id_academic_year_id_grade_id_category_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_tenant_id_academic_year_id_grade_id_category_key UNIQUE (tenant_id, academic_year_id, grade_id, category_id);


--
-- Name: gate_devices gate_devices_pairing_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_devices
    ADD CONSTRAINT gate_devices_pairing_code_key UNIQUE (pairing_code);


--
-- Name: gate_devices gate_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_devices
    ADD CONSTRAINT gate_devices_pkey PRIMARY KEY (device_id);


--
-- Name: gate_events gate_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_events
    ADD CONSTRAINT gate_events_pkey PRIMARY KEY (event_id);


--
-- Name: grades grades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grades
    ADD CONSTRAINT grades_pkey PRIMARY KEY (grade_id);


--
-- Name: guardian_claim_codes guardian_claim_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardian_claim_codes
    ADD CONSTRAINT guardian_claim_codes_pkey PRIMARY KEY (claim_code_id);


--
-- Name: guardians guardians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_pkey PRIMARY KEY (guardian_id);


--
-- Name: impersonation_sessions impersonation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (batch_id);


--
-- Name: import_rows import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_rows
    ADD CONSTRAINT import_rows_pkey PRIMARY KEY (row_id);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (line_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (invoice_id);


--
-- Name: invoices invoices_tenant_id_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_invoice_number_key UNIQUE (tenant_id, invoice_number);


--
-- Name: knec_export_batches knec_export_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_export_batches
    ADD CONSTRAINT knec_export_batches_pkey PRIMARY KEY (batch_id);


--
-- Name: knec_submission_status knec_submission_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_pkey PRIMARY KEY (submission_id);


--
-- Name: knec_submission_status knec_submission_status_tenant_id_tool_id_academic_year_id_g_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_tenant_id_tool_id_academic_year_id_g_key UNIQUE (tenant_id, tool_id, academic_year_id, grade_id);


--
-- Name: knec_tools knec_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_tools
    ADD CONSTRAINT knec_tools_pkey PRIMARY KEY (tool_id);


--
-- Name: knec_tools knec_tools_tool_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_tools
    ADD CONSTRAINT knec_tools_tool_code_key UNIQUE (tool_code);


--
-- Name: learner_fee_options learner_fee_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_pkey PRIMARY KEY (option_id);


--
-- Name: learner_fee_options learner_fee_options_tenant_id_learner_id_category_id_struct_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_tenant_id_learner_id_category_id_struct_key UNIQUE (tenant_id, learner_id, category_id, structure_id);


--
-- Name: learner_guardians learner_guardians_learner_id_guardian_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_guardians
    ADD CONSTRAINT learner_guardians_learner_id_guardian_id_key UNIQUE (learner_id, guardian_id);


--
-- Name: learner_guardians learner_guardians_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_guardians
    ADD CONSTRAINT learner_guardians_pkey PRIMARY KEY (link_id);


--
-- Name: learner_remarks learner_remarks_event_id_learner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_event_id_learner_id_key UNIQUE (event_id, learner_id);


--
-- Name: learner_remarks learner_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_pkey PRIMARY KEY (remark_id);


--
-- Name: learner_status_history learner_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_status_history
    ADD CONSTRAINT learner_status_history_pkey PRIMARY KEY (history_id);


--
-- Name: learners learners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT learners_pkey PRIMARY KEY (learner_id);


--
-- Name: learning_areas learning_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_areas
    ADD CONSTRAINT learning_areas_pkey PRIMARY KEY (area_id);


--
-- Name: learning_areas learning_areas_version_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_areas
    ADD CONSTRAINT learning_areas_version_id_code_key UNIQUE (version_id, code);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (template_id);


--
-- Name: message_templates message_templates_tenant_id_template_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_tenant_id_template_name_key UNIQUE (tenant_id, template_name);


--
-- Name: migration_runs migration_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_runs
    ADD CONSTRAINT migration_runs_pkey PRIMARY KEY (migration_id);


--
-- Name: mpesa_stk_requests mpesa_stk_requests_checkout_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_stk_requests
    ADD CONSTRAINT mpesa_stk_requests_checkout_request_id_key UNIQUE (checkout_request_id);


--
-- Name: mpesa_stk_requests mpesa_stk_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_stk_requests
    ADD CONSTRAINT mpesa_stk_requests_pkey PRIMARY KEY (stk_id);


--
-- Name: mpesa_transactions mpesa_transactions_external_trans_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_external_trans_id_key UNIQUE (external_trans_id);


--
-- Name: mpesa_transactions mpesa_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_pkey PRIMARY KEY (trans_id);


--
-- Name: node_mappings node_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_mappings
    ADD CONSTRAINT node_mappings_pkey PRIMARY KEY (mapping_id);


--
-- Name: node_mappings node_mappings_sub_strand_id_grade_id_academic_year_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_mappings
    ADD CONSTRAINT node_mappings_sub_strand_id_grade_id_academic_year_id_key UNIQUE (sub_strand_id, grade_id, academic_year_id);


--
-- Name: opt_outs opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_pkey PRIMARY KEY (opt_out_id);


--
-- Name: opt_outs opt_outs_tenant_id_user_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_tenant_id_user_id_channel_key UNIQUE (tenant_id, user_id, channel);


--
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (challenge_id);


--
-- Name: outbound_messages outbound_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages
    ADD CONSTRAINT outbound_messages_pkey PRIMARY KEY (message_id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (outbox_id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (reset_id);


--
-- Name: payment_allocations payment_allocations_payment_id_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_payment_id_invoice_id_key UNIQUE (payment_id, invoice_id);


--
-- Name: payment_allocations payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (allocation_id);


--
-- Name: payments payments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (payment_id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (plan_id);


--
-- Name: plans plans_plan_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_plan_code_key UNIQUE (plan_code);


--
-- Name: platform_invoices platform_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_pkey PRIMARY KEY (invoice_id);


--
-- Name: platform_invoices platform_invoices_tenant_id_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_tenant_id_invoice_number_key UNIQUE (tenant_id, invoice_number);


--
-- Name: receipt_sequences receipt_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_sequences
    ADD CONSTRAINT receipt_sequences_pkey PRIMARY KEY (sequence_id);


--
-- Name: receipt_sequences receipt_sequences_tenant_id_current_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_sequences
    ADD CONSTRAINT receipt_sequences_tenant_id_current_period_key UNIQUE (tenant_id, current_period);


--
-- Name: reconciliation_runs reconciliation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_runs
    ADD CONSTRAINT reconciliation_runs_pkey PRIMARY KEY (run_id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (refund_id);


--
-- Name: report_card_comments report_card_comments_card_id_learning_area_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_card_id_learning_area_id_key UNIQUE (card_id, learning_area_id);


--
-- Name: report_card_comments report_card_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_pkey PRIMARY KEY (comment_id);


--
-- Name: report_cards report_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_pkey PRIMARY KEY (card_id);


--
-- Name: report_cards report_cards_tenant_id_run_id_learner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_tenant_id_run_id_learner_id_key UNIQUE (tenant_id, run_id, learner_id);


--
-- Name: report_runs report_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_pkey PRIMARY KEY (run_id);


--
-- Name: report_templates report_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_pkey PRIMARY KEY (template_id);


--
-- Name: report_templates report_templates_tenant_id_template_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_tenant_id_template_name_key UNIQUE (tenant_id, template_name);


--
-- Name: reset_challenges reset_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_challenges
    ADD CONSTRAINT reset_challenges_pkey PRIMARY KEY (challenge_id);


--
-- Name: retention_policies retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_pkey PRIMARY KEY (policy_id);


--
-- Name: retention_policies retention_policies_tenant_id_resource_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_tenant_id_resource_type_key UNIQUE (tenant_id, resource_type);


--
-- Name: rfid_tags rfid_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_pkey PRIMARY KEY (tag_id);


--
-- Name: rfid_tags rfid_tags_tag_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_tag_uid_key UNIQUE (tag_uid);


--
-- Name: school_finance_settings school_finance_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_finance_settings
    ADD CONSTRAINT school_finance_settings_pkey PRIMARY KEY (setting_id);


--
-- Name: school_finance_settings school_finance_settings_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_finance_settings
    ADD CONSTRAINT school_finance_settings_tenant_id_key UNIQUE (tenant_id);


--
-- Name: school_payment_channels school_payment_channels_channel_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_payment_channels
    ADD CONSTRAINT school_payment_channels_channel_token_key UNIQUE (channel_token);


--
-- Name: school_payment_channels school_payment_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_payment_channels
    ADD CONSTRAINT school_payment_channels_pkey PRIMARY KEY (channel_id);


--
-- Name: school_settings school_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_settings
    ADD CONSTRAINT school_settings_pkey PRIMARY KEY (setting_id);


--
-- Name: school_settings school_settings_tenant_id_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_settings
    ADD CONSTRAINT school_settings_tenant_id_setting_key_key UNIQUE (tenant_id, setting_key);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (tenant_id);


--
-- Name: schools schools_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_subdomain_key UNIQUE (subdomain);


--
-- Name: security_questions security_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_questions
    ADD CONSTRAINT security_questions_pkey PRIMARY KEY (question_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (session_id);


--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (profile_id);


--
-- Name: strands strands_area_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strands
    ADD CONSTRAINT strands_area_id_code_key UNIQUE (area_id, code);


--
-- Name: strands strands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strands
    ADD CONSTRAINT strands_pkey PRIMARY KEY (strand_id);


--
-- Name: streams streams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.streams
    ADD CONSTRAINT streams_pkey PRIMARY KEY (stream_id);


--
-- Name: streams streams_tenant_id_stream_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.streams
    ADD CONSTRAINT streams_tenant_id_stream_name_key UNIQUE (tenant_id, stream_name);


--
-- Name: sub_strands sub_strands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_strands
    ADD CONSTRAINT sub_strands_pkey PRIMARY KEY (sub_strand_id);


--
-- Name: sub_strands sub_strands_strand_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_strands
    ADD CONSTRAINT sub_strands_strand_id_code_key UNIQUE (strand_id, code);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (subscription_id);


--
-- Name: subscriptions subscriptions_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_key UNIQUE (tenant_id);


--
-- Name: sync_conflicts sync_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_pkey PRIMARY KEY (conflict_id);


--
-- Name: sync_log sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_pkey PRIMARY KEY (sync_id);


--
-- Name: teaching_assignments teaching_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: teaching_assignments teaching_assignments_tenant_id_staff_membership_id_class_gr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_tenant_id_staff_membership_id_class_gr_key UNIQUE (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id);


--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_curriculum_pins
    ADD CONSTRAINT tenant_curriculum_pins_pkey PRIMARY KEY (pin_id);


--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_curriculum_pins
    ADD CONSTRAINT tenant_curriculum_pins_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (membership_id);


--
-- Name: tenant_memberships tenant_memberships_user_id_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_tenant_id_key UNIQUE (user_id, tenant_id);


--
-- Name: tenant_usage tenant_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_usage
    ADD CONSTRAINT tenant_usage_pkey PRIMARY KEY (usage_id);


--
-- Name: tenant_usage tenant_usage_tenant_id_period_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_usage
    ADD CONSTRAINT tenant_usage_tenant_id_period_month_key UNIQUE (tenant_id, period_month);


--
-- Name: terms terms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_pkey PRIMARY KEY (term_id);


--
-- Name: terms terms_tenant_id_year_id_term_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_tenant_id_year_id_term_number_key UNIQUE (tenant_id, year_id, term_number);


--
-- Name: transfers transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (transfer_id);


--
-- Name: learners unique_tenant_admission_no; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT unique_tenant_admission_no UNIQUE (tenant_id, admission_number);


--
-- Name: user_security_answers user_security_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_security_answers
    ADD CONSTRAINT user_security_answers_pkey PRIMARY KEY (answer_id);


--
-- Name: user_security_answers user_security_answers_user_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_security_answers
    ADD CONSTRAINT user_security_answers_user_id_question_id_key UNIQUE (user_id, question_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: weighting_profiles weighting_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weighting_profiles
    ADD CONSTRAINT weighting_profiles_pkey PRIMARY KEY (profile_id);


--
-- Name: idx_audit_events_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_action ON ONLY public.audit_events USING btree (action);


--
-- Name: audit_events_y2026m10_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_y2026m10_action_idx ON public.audit_events_y2026m10 USING btree (action);


--
-- Name: idx_audit_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_created ON ONLY public.audit_events USING btree (created_at);


--
-- Name: audit_events_y2026m10_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_y2026m10_created_at_idx ON public.audit_events_y2026m10 USING btree (created_at);


--
-- Name: idx_audit_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_tenant ON ONLY public.audit_events USING btree (tenant_id);


--
-- Name: audit_events_y2026m10_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_y2026m10_tenant_id_idx ON public.audit_events_y2026m10 USING btree (tenant_id);


--
-- Name: idx_academic_years_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_years_current ON public.academic_years USING btree (tenant_id, is_current);


--
-- Name: idx_academic_years_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_years_tenant ON public.academic_years USING btree (tenant_id);


--
-- Name: idx_access_logs_accessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_accessed ON public.access_logs USING btree (accessed_at);


--
-- Name: idx_access_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_resource ON public.access_logs USING btree (resource_type, resource_id);


--
-- Name: idx_access_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_tenant ON public.access_logs USING btree (tenant_id);


--
-- Name: idx_access_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_logs_user ON public.access_logs USING btree (user_id);


--
-- Name: idx_adjustments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adjustments_invoice ON public.adjustments USING btree (invoice_id);


--
-- Name: idx_adjustments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adjustments_tenant ON public.adjustments USING btree (tenant_id);


--
-- Name: idx_assessment_events_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_area ON public.assessment_events USING btree (learning_area_id);


--
-- Name: idx_assessment_events_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_grade ON public.assessment_events USING btree (grade_id);


--
-- Name: idx_assessment_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_status ON public.assessment_events USING btree (status);


--
-- Name: idx_assessment_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_tenant ON public.assessment_events USING btree (tenant_id);


--
-- Name: idx_assessment_events_term; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_term ON public.assessment_events USING btree (term_id);


--
-- Name: idx_assessment_events_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_events_unique ON public.assessment_events USING btree (tenant_id, term_id, grade_id, learning_area_id, assessment_type, assessment_window);


--
-- Name: idx_assessment_result_history_changed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_result_history_changed ON public.assessment_result_history USING btree (changed_at);


--
-- Name: idx_assessment_result_history_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_result_history_result ON public.assessment_result_history USING btree (result_id);


--
-- Name: idx_assessment_result_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_result_history_tenant ON public.assessment_result_history USING btree (tenant_id);


--
-- Name: idx_assessment_results_client_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_results_client_uuid ON public.assessment_results USING btree (client_uuid);


--
-- Name: idx_assessment_results_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_results_event ON public.assessment_results USING btree (event_id);


--
-- Name: idx_assessment_results_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_results_learner ON public.assessment_results USING btree (learner_id);


--
-- Name: idx_assessment_results_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_results_state ON public.assessment_results USING btree (state);


--
-- Name: idx_assessment_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_results_tenant ON public.assessment_results USING btree (tenant_id);


--
-- Name: idx_attendance_marks_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_marks_learner ON public.attendance_marks USING btree (learner_id);


--
-- Name: idx_attendance_marks_register; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_marks_register ON public.attendance_marks USING btree (register_id);


--
-- Name: idx_attendance_marks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_marks_status ON public.attendance_marks USING btree (status);


--
-- Name: idx_attendance_marks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_marks_tenant ON public.attendance_marks USING btree (tenant_id);


--
-- Name: idx_attendance_registers_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_registers_class ON public.attendance_registers USING btree (class_group_id);


--
-- Name: idx_attendance_registers_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_registers_date ON public.attendance_registers USING btree (register_date);


--
-- Name: idx_attendance_registers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_registers_status ON public.attendance_registers USING btree (status);


--
-- Name: idx_attendance_registers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_registers_tenant ON public.attendance_registers USING btree (tenant_id);


--
-- Name: idx_audit_log_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_event ON public.audit_log USING btree (event, created_at);


--
-- Name: idx_audit_log_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user ON public.audit_log USING btree (user_id, created_at);


--
-- Name: idx_breach_register_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_breach_register_severity ON public.breach_register USING btree (severity);


--
-- Name: idx_breach_register_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_breach_register_status ON public.breach_register USING btree (status);


--
-- Name: idx_breach_register_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_breach_register_tenant ON public.breach_register USING btree (tenant_id);


--
-- Name: idx_broadcast_recipients_broadcast; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_broadcast ON public.broadcast_recipients USING btree (broadcast_id);


--
-- Name: idx_broadcast_recipients_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_status ON public.broadcast_recipients USING btree (status);


--
-- Name: idx_broadcast_recipients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_recipients_tenant ON public.broadcast_recipients USING btree (tenant_id);


--
-- Name: idx_broadcasts_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_channel ON public.broadcasts USING btree (channel);


--
-- Name: idx_broadcasts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_status ON public.broadcasts USING btree (status);


--
-- Name: idx_broadcasts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcasts_tenant ON public.broadcasts USING btree (tenant_id);


--
-- Name: idx_capitation_receipts_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capitation_receipts_period ON public.capitation_receipts USING btree (capitation_period);


--
-- Name: idx_capitation_receipts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capitation_receipts_status ON public.capitation_receipts USING btree (status);


--
-- Name: idx_capitation_receipts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capitation_receipts_tenant ON public.capitation_receipts USING btree (tenant_id);


--
-- Name: idx_class_groups_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_groups_grade ON public.class_groups USING btree (grade_id);


--
-- Name: idx_class_groups_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_groups_teacher ON public.class_groups USING btree (class_teacher_id);


--
-- Name: idx_class_groups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_groups_tenant ON public.class_groups USING btree (tenant_id);


--
-- Name: idx_class_groups_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_groups_year ON public.class_groups USING btree (year_id);


--
-- Name: idx_competency_ratings_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competency_ratings_result ON public.competency_ratings USING btree (result_id);


--
-- Name: idx_competency_ratings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competency_ratings_tenant ON public.competency_ratings USING btree (tenant_id);


--
-- Name: idx_consent_notices_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_notices_active ON public.consent_notices USING btree (is_active);


--
-- Name: idx_consent_notices_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_notices_code ON public.consent_notices USING btree (notice_code);


--
-- Name: idx_consent_records_notice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_notice ON public.consent_records USING btree (notice_id);


--
-- Name: idx_consent_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_tenant ON public.consent_records USING btree (tenant_id);


--
-- Name: idx_consent_records_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_user ON public.consent_records USING btree (user_id);


--
-- Name: idx_credits_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credits_learner ON public.credits USING btree (learner_id);


--
-- Name: idx_credits_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credits_tenant ON public.credits USING btree (tenant_id);


--
-- Name: idx_curriculum_versions_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_versions_label ON public.curriculum_versions USING btree (version_label);


--
-- Name: idx_curriculum_versions_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_versions_published ON public.curriculum_versions USING btree (is_published);


--
-- Name: idx_delivery_receipts_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_receipts_message ON public.delivery_receipts USING btree (message_id);


--
-- Name: idx_delivery_receipts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_receipts_tenant ON public.delivery_receipts USING btree (tenant_id);


--
-- Name: idx_devices_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_fingerprint ON public.devices USING btree (fingerprint);


--
-- Name: idx_devices_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_user ON public.devices USING btree (user_id);


--
-- Name: idx_dpia_records_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpia_records_status ON public.dpia_records USING btree (status);


--
-- Name: idx_dpia_records_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dpia_records_tenant ON public.dpia_records USING btree (tenant_id);


--
-- Name: idx_dsr_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsr_requests_status ON public.dsr_requests USING btree (status);


--
-- Name: idx_dsr_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsr_requests_tenant ON public.dsr_requests USING btree (tenant_id);


--
-- Name: idx_dsr_requests_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsr_requests_user ON public.dsr_requests USING btree (user_id);


--
-- Name: idx_email_log_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_ip ON public.email_log USING btree (ip, sent_at);


--
-- Name: idx_email_log_user_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_user_kind ON public.email_log USING btree (user_id, kind, sent_at);


--
-- Name: idx_enrolments_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_class ON public.enrolments USING btree (class_group_id);


--
-- Name: idx_enrolments_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_learner ON public.enrolments USING btree (learner_id);


--
-- Name: idx_enrolments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_tenant ON public.enrolments USING btree (tenant_id);


--
-- Name: idx_enrolments_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrolments_year ON public.enrolments USING btree (year_id);


--
-- Name: idx_evidence_files_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_files_result ON public.evidence_files USING btree (result_id);


--
-- Name: idx_evidence_files_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidence_files_tenant ON public.evidence_files USING btree (tenant_id);


--
-- Name: idx_exam_windows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_windows_tenant ON public.exam_windows USING btree (tenant_id);


--
-- Name: idx_exam_windows_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_windows_type ON public.exam_windows USING btree (exam_type);


--
-- Name: idx_exports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_created ON public.exports USING btree (created_at);


--
-- Name: idx_exports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_status ON public.exports USING btree (status);


--
-- Name: idx_exports_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_tenant ON public.exports USING btree (tenant_id);


--
-- Name: idx_exports_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exports_type ON public.exports USING btree (export_type);


--
-- Name: idx_fee_categories_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_categories_code ON public.fee_categories USING btree (code);


--
-- Name: idx_fee_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_categories_tenant ON public.fee_categories USING btree (tenant_id);


--
-- Name: idx_fee_categories_tenant_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_fee_categories_tenant_code ON public.fee_categories USING btree (COALESCE(tenant_id, ''::character varying), code);


--
-- Name: idx_fee_structures_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_structures_category ON public.fee_structures USING btree (category_id);


--
-- Name: idx_fee_structures_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_structures_grade ON public.fee_structures USING btree (grade_id);


--
-- Name: idx_fee_structures_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_structures_tenant ON public.fee_structures USING btree (tenant_id);


--
-- Name: idx_fee_structures_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_structures_year ON public.fee_structures USING btree (academic_year_id);


--
-- Name: idx_gate_devices_pairing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_devices_pairing ON public.gate_devices USING btree (pairing_code);


--
-- Name: idx_gate_devices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_devices_status ON public.gate_devices USING btree (status);


--
-- Name: idx_gate_devices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_devices_tenant ON public.gate_devices USING btree (tenant_id);


--
-- Name: idx_gate_events_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_events_device ON public.gate_events USING btree (device_id);


--
-- Name: idx_gate_events_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_events_tag ON public.gate_events USING btree (tag_id);


--
-- Name: idx_gate_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_events_tenant ON public.gate_events USING btree (tenant_id);


--
-- Name: idx_gate_events_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_events_ts ON public.gate_events USING btree (event_ts);


--
-- Name: idx_gate_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gate_events_type ON public.gate_events USING btree (event_type);


--
-- Name: idx_guardian_claim_codes_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardian_claim_codes_hash ON public.guardian_claim_codes USING btree (code_hash);


--
-- Name: idx_guardians_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardians_phone ON public.guardians USING btree (phone_number);


--
-- Name: idx_guardians_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardians_tenant ON public.guardians USING btree (tenant_id);


--
-- Name: idx_guardians_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_guardians_user ON public.guardians USING btree (user_id);


--
-- Name: idx_impersonation_sessions_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_sessions_admin ON public.impersonation_sessions USING btree (admin_user_id);


--
-- Name: idx_impersonation_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_sessions_expires ON public.impersonation_sessions USING btree (expires_at);


--
-- Name: idx_impersonation_sessions_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_sessions_target ON public.impersonation_sessions USING btree (target_user_id);


--
-- Name: idx_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_status ON public.import_batches USING btree (status);


--
-- Name: idx_import_batches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batches_tenant ON public.import_batches USING btree (tenant_id);


--
-- Name: idx_import_rows_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_rows_batch ON public.import_rows USING btree (batch_id);


--
-- Name: idx_import_rows_valid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_rows_valid ON public.import_rows USING btree (is_valid);


--
-- Name: idx_invoice_lines_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_lines_category ON public.invoice_lines USING btree (category_id);


--
-- Name: idx_invoice_lines_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_lines_invoice ON public.invoice_lines USING btree (invoice_id);


--
-- Name: idx_invoice_lines_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_lines_tenant ON public.invoice_lines USING btree (tenant_id);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_learner ON public.invoices USING btree (learner_id);


--
-- Name: idx_invoices_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_number ON public.invoices USING btree (invoice_number);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);


--
-- Name: idx_knec_export_batches_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_export_batches_ref ON public.knec_export_batches USING btree (batch_reference);


--
-- Name: idx_knec_export_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_export_batches_status ON public.knec_export_batches USING btree (status);


--
-- Name: idx_knec_export_batches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_export_batches_tenant ON public.knec_export_batches USING btree (tenant_id);


--
-- Name: idx_knec_export_batches_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_export_batches_tool ON public.knec_export_batches USING btree (tool_id);


--
-- Name: idx_knec_submission_status_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_submission_status_status ON public.knec_submission_status USING btree (status);


--
-- Name: idx_knec_submission_status_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_submission_status_tenant ON public.knec_submission_status USING btree (tenant_id);


--
-- Name: idx_knec_submission_status_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_submission_status_tool ON public.knec_submission_status USING btree (tool_id);


--
-- Name: idx_knec_tools_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_tools_code ON public.knec_tools USING btree (tool_code);


--
-- Name: idx_knec_tools_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_tools_grade ON public.knec_tools USING btree (grade_id);


--
-- Name: idx_knec_tools_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knec_tools_year ON public.knec_tools USING btree (assessment_year);


--
-- Name: idx_learner_fee_options_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_fee_options_learner ON public.learner_fee_options USING btree (learner_id);


--
-- Name: idx_learner_fee_options_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_fee_options_tenant ON public.learner_fee_options USING btree (tenant_id);


--
-- Name: idx_learner_guardians_guardian; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_guardians_guardian ON public.learner_guardians USING btree (guardian_id);


--
-- Name: idx_learner_guardians_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_guardians_learner ON public.learner_guardians USING btree (learner_id);


--
-- Name: idx_learner_remarks_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_remarks_event ON public.learner_remarks USING btree (event_id);


--
-- Name: idx_learner_remarks_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_remarks_learner ON public.learner_remarks USING btree (learner_id);


--
-- Name: idx_learner_remarks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_remarks_tenant ON public.learner_remarks USING btree (tenant_id);


--
-- Name: idx_learner_status_history_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_status_history_learner ON public.learner_status_history USING btree (learner_id);


--
-- Name: idx_learner_status_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learner_status_history_tenant ON public.learner_status_history USING btree (tenant_id);


--
-- Name: idx_learners_admission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_admission ON public.learners USING btree (admission_number);


--
-- Name: idx_learners_boarding_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_boarding_type ON public.learners USING btree (tenant_id, boarding_type);


--
-- Name: idx_learners_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_status ON public.learners USING btree (status);


--
-- Name: idx_learners_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_tenant ON public.learners USING btree (tenant_id);


--
-- Name: idx_learners_upi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learners_upi ON public.learners USING btree (upi_nemis_number);


--
-- Name: idx_learning_areas_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_areas_code ON public.learning_areas USING btree (code);


--
-- Name: idx_learning_areas_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_areas_version ON public.learning_areas USING btree (version_id);


--
-- Name: idx_login_attempts_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_ip ON public.login_attempts USING btree (ip, created_at);


--
-- Name: idx_login_attempts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_user ON public.login_attempts USING btree (user_id, created_at);


--
-- Name: idx_message_templates_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_channel ON public.message_templates USING btree (channel);


--
-- Name: idx_message_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_templates_tenant ON public.message_templates USING btree (tenant_id);


--
-- Name: idx_migration_runs_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_migration_runs_applied ON public.migration_runs USING btree (applied_at);


--
-- Name: idx_mpesa_stk_requests_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_stk_requests_checkout ON public.mpesa_stk_requests USING btree (checkout_request_id);


--
-- Name: idx_mpesa_stk_requests_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_stk_requests_phone ON public.mpesa_stk_requests USING btree (phone_number);


--
-- Name: idx_mpesa_stk_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_stk_requests_status ON public.mpesa_stk_requests USING btree (status);


--
-- Name: idx_mpesa_stk_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_stk_requests_tenant ON public.mpesa_stk_requests USING btree (tenant_id);


--
-- Name: idx_mpesa_transactions_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_transactions_channel ON public.mpesa_transactions USING btree (channel_id);


--
-- Name: idx_mpesa_transactions_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_transactions_external ON public.mpesa_transactions USING btree (external_trans_id);


--
-- Name: idx_mpesa_transactions_msisdn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_transactions_msisdn ON public.mpesa_transactions USING btree (msisdn_masked);


--
-- Name: idx_mpesa_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_transactions_status ON public.mpesa_transactions USING btree (status);


--
-- Name: idx_mpesa_transactions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mpesa_transactions_tenant ON public.mpesa_transactions USING btree (tenant_id);


--
-- Name: idx_node_mappings_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_mappings_grade ON public.node_mappings USING btree (grade_id);


--
-- Name: idx_node_mappings_sub_strand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_mappings_sub_strand ON public.node_mappings USING btree (sub_strand_id);


--
-- Name: idx_node_mappings_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_mappings_year ON public.node_mappings USING btree (academic_year_id);


--
-- Name: idx_opt_outs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opt_outs_tenant ON public.opt_outs USING btree (tenant_id);


--
-- Name: idx_opt_outs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opt_outs_user ON public.opt_outs USING btree (user_id);


--
-- Name: idx_otp_challenges_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_challenges_phone ON public.otp_challenges USING btree (phone_number);


--
-- Name: idx_otp_challenges_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_challenges_purpose ON public.otp_challenges USING btree (purpose);


--
-- Name: idx_outbound_messages_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_messages_channel ON public.outbound_messages USING btree (channel);


--
-- Name: idx_outbound_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_messages_created ON public.outbound_messages USING btree (created_at);


--
-- Name: idx_outbound_messages_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_messages_recipient ON public.outbound_messages USING btree (recipient_type, recipient_id);


--
-- Name: idx_outbound_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_messages_status ON public.outbound_messages USING btree (status);


--
-- Name: idx_outbound_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbound_messages_tenant ON public.outbound_messages USING btree (tenant_id);


--
-- Name: idx_outbox_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_created ON public.outbox USING btree (created_at);


--
-- Name: idx_outbox_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_event_type ON public.outbox USING btree (event_type);


--
-- Name: idx_outbox_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outbox_tenant_status ON public.outbox USING btree (tenant_id, status);


--
-- Name: idx_payment_allocations_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_allocations_invoice ON public.payment_allocations USING btree (invoice_id);


--
-- Name: idx_payment_allocations_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_allocations_payment ON public.payment_allocations USING btree (payment_id);


--
-- Name: idx_payment_allocations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_allocations_tenant ON public.payment_allocations USING btree (tenant_id);


--
-- Name: idx_payments_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_idempotency ON public.payments USING btree (idempotency_key);


--
-- Name: idx_payments_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_learner ON public.payments USING btree (learner_id);


--
-- Name: idx_payments_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_reference ON public.payments USING btree (payment_reference);


--
-- Name: idx_payments_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_source ON public.payments USING btree (source);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_tenant ON public.payments USING btree (tenant_id);


--
-- Name: idx_plans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_active ON public.plans USING btree (is_active);


--
-- Name: idx_plans_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_code ON public.plans USING btree (plan_code);


--
-- Name: idx_platform_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_invoices_status ON public.platform_invoices USING btree (status);


--
-- Name: idx_platform_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_invoices_tenant ON public.platform_invoices USING btree (tenant_id);


--
-- Name: idx_receipt_sequences_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receipt_sequences_tenant ON public.receipt_sequences USING btree (tenant_id);


--
-- Name: idx_reconciliation_runs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_runs_date ON public.reconciliation_runs USING btree (run_date);


--
-- Name: idx_reconciliation_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_runs_status ON public.reconciliation_runs USING btree (status);


--
-- Name: idx_reconciliation_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reconciliation_runs_tenant ON public.reconciliation_runs USING btree (tenant_id);


--
-- Name: idx_refresh_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_hash ON public.refresh_tokens USING btree (token_hash);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_refunds_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_payment ON public.refunds USING btree (payment_id);


--
-- Name: idx_refunds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_status ON public.refunds USING btree (status);


--
-- Name: idx_refunds_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_tenant ON public.refunds USING btree (tenant_id);


--
-- Name: idx_report_card_comments_card; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_card_comments_card ON public.report_card_comments USING btree (card_id);


--
-- Name: idx_report_card_comments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_card_comments_tenant ON public.report_card_comments USING btree (tenant_id);


--
-- Name: idx_report_cards_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_cards_card_number ON public.report_cards USING btree (card_number);


--
-- Name: idx_report_cards_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_cards_learner ON public.report_cards USING btree (learner_id);


--
-- Name: idx_report_cards_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_cards_run ON public.report_cards USING btree (run_id);


--
-- Name: idx_report_cards_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_cards_status ON public.report_cards USING btree (status);


--
-- Name: idx_report_cards_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_cards_tenant ON public.report_cards USING btree (tenant_id);


--
-- Name: idx_report_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_status ON public.report_runs USING btree (status);


--
-- Name: idx_report_runs_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_template ON public.report_runs USING btree (template_id);


--
-- Name: idx_report_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_runs_tenant ON public.report_runs USING btree (tenant_id);


--
-- Name: idx_report_templates_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_templates_default ON public.report_templates USING btree (is_default);


--
-- Name: idx_report_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_templates_tenant ON public.report_templates USING btree (tenant_id);


--
-- Name: idx_report_templates_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_templates_type ON public.report_templates USING btree (template_type);


--
-- Name: idx_reset_challenges_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reset_challenges_hash ON public.reset_challenges USING btree (token_hash);


--
-- Name: idx_reset_challenges_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reset_challenges_user ON public.reset_challenges USING btree (user_id, created_at DESC);


--
-- Name: idx_reset_tokens_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reset_tokens_hash ON public.password_reset_tokens USING btree (token_hash);


--
-- Name: idx_reset_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reset_tokens_user ON public.password_reset_tokens USING btree (user_id, created_at DESC);


--
-- Name: idx_retention_policies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_policies_tenant ON public.retention_policies USING btree (tenant_id);


--
-- Name: idx_rfid_tags_holder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfid_tags_holder ON public.rfid_tags USING btree (holder_type, holder_id);


--
-- Name: idx_rfid_tags_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfid_tags_tenant ON public.rfid_tags USING btree (tenant_id);


--
-- Name: idx_rfid_tags_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rfid_tags_uid ON public.rfid_tags USING btree (tag_uid);


--
-- Name: idx_school_finance_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_finance_settings_tenant ON public.school_finance_settings USING btree (tenant_id);


--
-- Name: idx_school_payment_channels_shortcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_payment_channels_shortcode ON public.school_payment_channels USING btree (shortcode_or_account);


--
-- Name: idx_school_payment_channels_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_payment_channels_tenant ON public.school_payment_channels USING btree (tenant_id);


--
-- Name: idx_school_payment_channels_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_payment_channels_token ON public.school_payment_channels USING btree (channel_token);


--
-- Name: idx_school_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_school_settings_tenant ON public.school_settings USING btree (tenant_id);


--
-- Name: idx_schools_county; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_county ON public.schools USING btree (county);


--
-- Name: idx_schools_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_status ON public.schools USING btree (status);


--
-- Name: idx_schools_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_subdomain ON public.schools USING btree (subdomain);


--
-- Name: idx_schools_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_type ON public.schools USING btree (school_type);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_token ON public.sessions USING btree (session_token);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_id, revoked, expires_at);


--
-- Name: idx_staff_profiles_membership; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_profiles_membership ON public.staff_profiles USING btree (membership_id);


--
-- Name: idx_strands_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_strands_area ON public.strands USING btree (area_id);


--
-- Name: idx_strands_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_strands_code ON public.strands USING btree (code);


--
-- Name: idx_streams_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_streams_tenant ON public.streams USING btree (tenant_id);


--
-- Name: idx_sub_strands_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_strands_code ON public.sub_strands USING btree (code);


--
-- Name: idx_sub_strands_strand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_strands_strand ON public.sub_strands USING btree (strand_id);


--
-- Name: idx_subscriptions_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_plan ON public.subscriptions USING btree (plan_id);


--
-- Name: idx_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status);


--
-- Name: idx_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_tenant ON public.subscriptions USING btree (tenant_id);


--
-- Name: idx_sync_conflicts_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_conflicts_entity ON public.sync_conflicts USING btree (entity_type, entity_id);


--
-- Name: idx_sync_conflicts_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_conflicts_resolved ON public.sync_conflicts USING btree (resolved);


--
-- Name: idx_sync_conflicts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_conflicts_tenant ON public.sync_conflicts USING btree (tenant_id);


--
-- Name: idx_sync_log_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_log_device ON public.sync_log USING btree (device_id);


--
-- Name: idx_sync_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_log_status ON public.sync_log USING btree (status);


--
-- Name: idx_sync_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_log_tenant ON public.sync_log USING btree (tenant_id);


--
-- Name: idx_teaching_assignments_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_assignments_class ON public.teaching_assignments USING btree (class_group_id);


--
-- Name: idx_teaching_assignments_staff; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_assignments_staff ON public.teaching_assignments USING btree (staff_membership_id);


--
-- Name: idx_teaching_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teaching_assignments_tenant ON public.teaching_assignments USING btree (tenant_id);


--
-- Name: idx_tenant_curriculum_pins_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_curriculum_pins_tenant ON public.tenant_curriculum_pins USING btree (tenant_id);


--
-- Name: idx_tenant_memberships_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_role ON public.tenant_memberships USING btree (role);


--
-- Name: idx_tenant_memberships_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_tenant ON public.tenant_memberships USING btree (tenant_id);


--
-- Name: idx_tenant_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_user ON public.tenant_memberships USING btree (user_id);


--
-- Name: idx_tenant_usage_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_usage_period ON public.tenant_usage USING btree (period_month);


--
-- Name: idx_tenant_usage_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_usage_tenant ON public.tenant_usage USING btree (tenant_id);


--
-- Name: idx_terms_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_current ON public.terms USING btree (tenant_id, is_current);


--
-- Name: idx_terms_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_tenant ON public.terms USING btree (tenant_id);


--
-- Name: idx_terms_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_year ON public.terms USING btree (year_id);


--
-- Name: idx_transfers_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfers_learner ON public.transfers USING btree (learner_id);


--
-- Name: idx_transfers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transfers_tenant ON public.transfers USING btree (tenant_id);


--
-- Name: idx_user_security_answers_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_security_answers_user ON public.user_security_answers USING btree (user_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone_number);


--
-- Name: idx_weighting_profiles_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weighting_profiles_default ON public.weighting_profiles USING btree (is_default);


--
-- Name: idx_weighting_profiles_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_weighting_profiles_grade ON public.weighting_profiles USING btree (grade_id);


--
-- Name: uq_assessment_results_client_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_assessment_results_client_uuid ON public.assessment_results USING btree (tenant_id, client_uuid) WHERE (client_uuid IS NOT NULL);


--
-- Name: uq_assessment_results_event_learner_substrand; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_assessment_results_event_learner_substrand ON public.assessment_results USING btree (tenant_id, event_id, learner_id, COALESCE(sub_strand_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: uq_attendance_marks_client_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attendance_marks_client_uuid ON public.attendance_marks USING btree (tenant_id, client_uuid) WHERE (client_uuid IS NOT NULL);


--
-- Name: uq_attendance_marks_register_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_attendance_marks_register_learner ON public.attendance_marks USING btree (tenant_id, register_id, learner_id);


--
-- Name: uq_class_groups_tenant_year_grade_stream; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_class_groups_tenant_year_grade_stream ON public.class_groups USING btree (tenant_id, year_id, grade_id, stream_id);


--
-- Name: uq_competency_ratings_tenant_result_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_competency_ratings_tenant_result_code ON public.competency_ratings USING btree (tenant_id, result_id, competency_code);


--
-- Name: uq_consent_notices_code_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_consent_notices_code_version ON public.consent_notices USING btree (notice_code, version);


--
-- Name: uq_consent_records_tenant_user_notice; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_consent_records_tenant_user_notice ON public.consent_records USING btree (tenant_id, user_id, notice_id);


--
-- Name: uq_fee_structures_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fee_structures_tenant ON public.fee_structures USING btree (tenant_id, academic_year_id, grade_id, category_id);


--
-- Name: uq_gate_devices_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gate_devices_tenant_name ON public.gate_devices USING btree (tenant_id, device_name);


--
-- Name: uq_invoices_tenant_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_invoices_tenant_number ON public.invoices USING btree (tenant_id, invoice_number);


--
-- Name: uq_learner_fee_options_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_learner_fee_options_tenant ON public.learner_fee_options USING btree (tenant_id, learner_id, category_id);


--
-- Name: uq_learner_remarks_tenant_event_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_learner_remarks_tenant_event_learner ON public.learner_remarks USING btree (tenant_id, event_id, learner_id);


--
-- Name: uq_message_templates_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_message_templates_tenant_name ON public.message_templates USING btree (tenant_id, template_name);


--
-- Name: uq_opt_outs_tenant_user_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_opt_outs_tenant_user_channel ON public.opt_outs USING btree (tenant_id, user_id, channel);


--
-- Name: uq_outbound_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_outbound_messages_tenant ON public.outbound_messages USING btree (tenant_id, template_id, recipient_id, channel) WHERE (template_id IS NOT NULL);


--
-- Name: uq_payments_tenant_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_payments_tenant_reference ON public.payments USING btree (tenant_id, payment_reference);


--
-- Name: uq_report_card_comments_tenant_card_area; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_report_card_comments_tenant_card_area ON public.report_card_comments USING btree (tenant_id, card_id, learning_area_id);


--
-- Name: uq_report_cards_tenant_run_learner; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_report_cards_tenant_run_learner ON public.report_cards USING btree (tenant_id, run_id, learner_id);


--
-- Name: uq_report_templates_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_report_templates_tenant_name ON public.report_templates USING btree (tenant_id, template_name);


--
-- Name: uq_retention_policies_tenant_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_retention_policies_tenant_resource ON public.retention_policies USING btree (tenant_id, resource_type);


--
-- Name: uq_rfid_tags_tenant_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_rfid_tags_tenant_uid ON public.rfid_tags USING btree (tenant_id, tag_uid);


--
-- Name: uq_school_settings_tenant_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_school_settings_tenant_key ON public.school_settings USING btree (tenant_id, setting_key);


--
-- Name: uq_streams_tenant_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_streams_tenant_name ON public.streams USING btree (tenant_id, stream_name);


--
-- Name: uq_teaching_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_teaching_assignments_tenant ON public.teaching_assignments USING btree (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id);


--
-- Name: audit_events_y2026m10_action_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_events_action ATTACH PARTITION public.audit_events_y2026m10_action_idx;


--
-- Name: audit_events_y2026m10_created_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_events_created ATTACH PARTITION public.audit_events_y2026m10_created_at_idx;


--
-- Name: audit_events_y2026m10_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.audit_events_pkey ATTACH PARTITION public.audit_events_y2026m10_pkey;


--
-- Name: audit_events_y2026m10_tenant_id_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.idx_audit_events_tenant ATTACH PARTITION public.audit_events_y2026m10_tenant_id_idx;


--
-- Name: academic_years academic_years_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_years
    ADD CONSTRAINT academic_years_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: access_logs access_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: access_logs access_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: adjustments adjustments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: adjustments adjustments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(invoice_id) ON DELETE CASCADE;


--
-- Name: adjustments adjustments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adjustments
    ADD CONSTRAINT adjustments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: assessment_events assessment_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: assessment_events assessment_events_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: assessment_events assessment_events_learning_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_learning_area_id_fkey FOREIGN KEY (learning_area_id) REFERENCES public.learning_areas(area_id) ON DELETE CASCADE;


--
-- Name: assessment_events assessment_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: assessment_events assessment_events_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id) ON DELETE CASCADE;


--
-- Name: assessment_events assessment_events_weighting_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_events
    ADD CONSTRAINT assessment_events_weighting_profile_id_fkey FOREIGN KEY (weighting_profile_id) REFERENCES public.weighting_profiles(profile_id);


--
-- Name: assessment_result_history assessment_result_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- Name: assessment_result_history assessment_result_history_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.assessment_events(event_id) ON DELETE CASCADE;


--
-- Name: assessment_result_history assessment_result_history_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: assessment_result_history assessment_result_history_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.assessment_results(result_id) ON DELETE CASCADE;


--
-- Name: assessment_result_history assessment_result_history_sub_strand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_sub_strand_id_fkey FOREIGN KEY (sub_strand_id) REFERENCES public.sub_strands(sub_strand_id) ON DELETE SET NULL;


--
-- Name: assessment_result_history assessment_result_history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_result_history
    ADD CONSTRAINT assessment_result_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: assessment_results assessment_results_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id) ON DELETE SET NULL;


--
-- Name: assessment_results assessment_results_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.assessment_events(event_id) ON DELETE CASCADE;


--
-- Name: assessment_results assessment_results_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: assessment_results assessment_results_sub_strand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_sub_strand_id_fkey FOREIGN KEY (sub_strand_id) REFERENCES public.sub_strands(sub_strand_id) ON DELETE SET NULL;


--
-- Name: assessment_results assessment_results_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(user_id);


--
-- Name: assessment_results assessment_results_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_results
    ADD CONSTRAINT assessment_results_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: attendance_marks attendance_marks_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: attendance_marks attendance_marks_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(user_id);


--
-- Name: attendance_marks attendance_marks_register_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_register_id_fkey FOREIGN KEY (register_id) REFERENCES public.attendance_registers(register_id) ON DELETE CASCADE;


--
-- Name: attendance_marks attendance_marks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_marks
    ADD CONSTRAINT attendance_marks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_class_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_class_group_id_fkey FOREIGN KEY (class_group_id) REFERENCES public.class_groups(class_group_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(user_id);


--
-- Name: attendance_registers attendance_registers_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(stream_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: attendance_registers attendance_registers_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_registers
    ADD CONSTRAINT attendance_registers_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id) ON DELETE CASCADE;


--
-- Name: breach_register breach_register_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breach_register
    ADD CONSTRAINT breach_register_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(user_id);


--
-- Name: breach_register breach_register_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.breach_register
    ADD CONSTRAINT breach_register_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_broadcast_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcasts(broadcast_id) ON DELETE CASCADE;


--
-- Name: broadcast_recipients broadcast_recipients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_recipients
    ADD CONSTRAINT broadcast_recipients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: broadcasts broadcasts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: broadcasts broadcasts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: capitation_receipts capitation_receipts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capitation_receipts
    ADD CONSTRAINT capitation_receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: capitation_receipts capitation_receipts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capitation_receipts
    ADD CONSTRAINT capitation_receipts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: class_groups class_groups_class_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_class_teacher_id_fkey FOREIGN KEY (class_teacher_id) REFERENCES public.users(user_id);


--
-- Name: class_groups class_groups_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id);


--
-- Name: class_groups class_groups_stream_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_stream_id_fkey FOREIGN KEY (stream_id) REFERENCES public.streams(stream_id) ON DELETE CASCADE;


--
-- Name: class_groups class_groups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: class_groups class_groups_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_groups
    ADD CONSTRAINT class_groups_year_id_fkey FOREIGN KEY (year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: competency_ratings competency_ratings_rated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_ratings
    ADD CONSTRAINT competency_ratings_rated_by_fkey FOREIGN KEY (rated_by) REFERENCES public.users(user_id);


--
-- Name: competency_ratings competency_ratings_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_ratings
    ADD CONSTRAINT competency_ratings_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.assessment_results(result_id) ON DELETE CASCADE;


--
-- Name: competency_ratings competency_ratings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competency_ratings
    ADD CONSTRAINT competency_ratings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: consent_notices consent_notices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_notices
    ADD CONSTRAINT consent_notices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: consent_records consent_records_notice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES public.consent_notices(notice_id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: credits credits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: credits credits_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: credits credits_source_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_source_payment_id_fkey FOREIGN KEY (source_payment_id) REFERENCES public.payments(payment_id) ON DELETE SET NULL;


--
-- Name: credits credits_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credits
    ADD CONSTRAINT credits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: curriculum_versions curriculum_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_versions
    ADD CONSTRAINT curriculum_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: delivery_receipts delivery_receipts_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.outbound_messages(message_id) ON DELETE CASCADE;


--
-- Name: delivery_receipts delivery_receipts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_receipts
    ADD CONSTRAINT delivery_receipts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: devices devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: dpia_records dpia_records_assessed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpia_records
    ADD CONSTRAINT dpia_records_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES public.users(user_id);


--
-- Name: dpia_records dpia_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dpia_records
    ADD CONSTRAINT dpia_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: dsr_requests dsr_requests_responded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsr_requests
    ADD CONSTRAINT dsr_requests_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES public.users(user_id);


--
-- Name: dsr_requests dsr_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsr_requests
    ADD CONSTRAINT dsr_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: dsr_requests dsr_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dsr_requests
    ADD CONSTRAINT dsr_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: enrolments enrolments_class_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_class_group_id_fkey FOREIGN KEY (class_group_id) REFERENCES public.class_groups(class_group_id) ON DELETE CASCADE;


--
-- Name: enrolments enrolments_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: enrolments enrolments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: enrolments enrolments_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolments
    ADD CONSTRAINT enrolments_year_id_fkey FOREIGN KEY (year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: evidence_files evidence_files_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_files
    ADD CONSTRAINT evidence_files_result_id_fkey FOREIGN KEY (result_id) REFERENCES public.assessment_results(result_id) ON DELETE CASCADE;


--
-- Name: evidence_files evidence_files_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_files
    ADD CONSTRAINT evidence_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: evidence_files evidence_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_files
    ADD CONSTRAINT evidence_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: exam_windows exam_windows_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_windows
    ADD CONSTRAINT exam_windows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: exports exports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: exports exports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exports
    ADD CONSTRAINT exports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: fee_structures fee_structures_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: fee_structures fee_structures_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fee_categories(category_id) ON DELETE CASCADE;


--
-- Name: fee_structures fee_structures_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: fee_structures fee_structures_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: fee_structures fee_structures_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fee_structures
    ADD CONSTRAINT fee_structures_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: gate_devices gate_devices_paired_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_devices
    ADD CONSTRAINT gate_devices_paired_by_fkey FOREIGN KEY (paired_by) REFERENCES public.users(user_id);


--
-- Name: gate_devices gate_devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_devices
    ADD CONSTRAINT gate_devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: gate_events gate_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_events
    ADD CONSTRAINT gate_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.gate_devices(device_id) ON DELETE CASCADE;


--
-- Name: gate_events gate_events_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_events
    ADD CONSTRAINT gate_events_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.rfid_tags(tag_id) ON DELETE SET NULL;


--
-- Name: gate_events gate_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_events
    ADD CONSTRAINT gate_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: gate_events gate_events_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gate_events
    ADD CONSTRAINT gate_events_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(user_id);


--
-- Name: guardians guardians_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: guardians guardians_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guardians
    ADD CONSTRAINT guardians_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: impersonation_sessions impersonation_sessions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: impersonation_sessions impersonation_sessions_target_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_target_tenant_id_fkey FOREIGN KEY (target_tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: impersonation_sessions impersonation_sessions_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: import_batches import_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: import_batches import_batches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: import_rows import_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_rows
    ADD CONSTRAINT import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.import_batches(batch_id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id);


--
-- Name: invoice_lines invoice_lines_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fee_categories(category_id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(invoice_id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: invoice_lines invoice_lines_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id);


--
-- Name: invoices invoices_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: invoices invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: invoices invoices_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: invoices invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: invoices invoices_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id) ON DELETE CASCADE;


--
-- Name: knec_export_batches knec_export_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_export_batches
    ADD CONSTRAINT knec_export_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: knec_export_batches knec_export_batches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_export_batches
    ADD CONSTRAINT knec_export_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: knec_export_batches knec_export_batches_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_export_batches
    ADD CONSTRAINT knec_export_batches_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.knec_tools(tool_id) ON DELETE CASCADE;


--
-- Name: knec_submission_status knec_submission_status_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: knec_submission_status knec_submission_status_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: knec_submission_status knec_submission_status_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: knec_submission_status knec_submission_status_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: knec_submission_status knec_submission_status_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_submission_status
    ADD CONSTRAINT knec_submission_status_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.knec_tools(tool_id) ON DELETE CASCADE;


--
-- Name: knec_tools knec_tools_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knec_tools
    ADD CONSTRAINT knec_tools_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: learner_fee_options learner_fee_options_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fee_categories(category_id) ON DELETE CASCADE;


--
-- Name: learner_fee_options learner_fee_options_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: learner_fee_options learner_fee_options_opted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_opted_by_fkey FOREIGN KEY (opted_by) REFERENCES public.users(user_id);


--
-- Name: learner_fee_options learner_fee_options_structure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_structure_id_fkey FOREIGN KEY (structure_id) REFERENCES public.fee_structures(structure_id) ON DELETE CASCADE;


--
-- Name: learner_fee_options learner_fee_options_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_fee_options
    ADD CONSTRAINT learner_fee_options_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: learner_guardians learner_guardians_guardian_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_guardians
    ADD CONSTRAINT learner_guardians_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES public.guardians(guardian_id) ON DELETE CASCADE;


--
-- Name: learner_guardians learner_guardians_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_guardians
    ADD CONSTRAINT learner_guardians_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: learner_remarks learner_remarks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: learner_remarks learner_remarks_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.assessment_events(event_id) ON DELETE CASCADE;


--
-- Name: learner_remarks learner_remarks_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: learner_remarks learner_remarks_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_remarks
    ADD CONSTRAINT learner_remarks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: learner_status_history learner_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_status_history
    ADD CONSTRAINT learner_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- Name: learner_status_history learner_status_history_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_status_history
    ADD CONSTRAINT learner_status_history_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: learner_status_history learner_status_history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_status_history
    ADD CONSTRAINT learner_status_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: learners learners_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learners
    ADD CONSTRAINT learners_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: learning_areas learning_areas_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_areas
    ADD CONSTRAINT learning_areas_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.curriculum_versions(version_id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: message_templates message_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: mpesa_stk_requests mpesa_stk_requests_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_stk_requests
    ADD CONSTRAINT mpesa_stk_requests_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.school_payment_channels(channel_id) ON DELETE CASCADE;


--
-- Name: mpesa_stk_requests mpesa_stk_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_stk_requests
    ADD CONSTRAINT mpesa_stk_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: mpesa_transactions mpesa_transactions_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.school_payment_channels(channel_id) ON DELETE CASCADE;


--
-- Name: mpesa_transactions mpesa_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mpesa_transactions
    ADD CONSTRAINT mpesa_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: node_mappings node_mappings_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_mappings
    ADD CONSTRAINT node_mappings_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: node_mappings node_mappings_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_mappings
    ADD CONSTRAINT node_mappings_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: node_mappings node_mappings_sub_strand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_mappings
    ADD CONSTRAINT node_mappings_sub_strand_id_fkey FOREIGN KEY (sub_strand_id) REFERENCES public.sub_strands(sub_strand_id) ON DELETE CASCADE;


--
-- Name: opt_outs opt_outs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: opt_outs opt_outs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: outbound_messages outbound_messages_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages
    ADD CONSTRAINT outbound_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: outbound_messages outbound_messages_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages
    ADD CONSTRAINT outbound_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.message_templates(template_id) ON DELETE SET NULL;


--
-- Name: outbound_messages outbound_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_messages
    ADD CONSTRAINT outbound_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: payment_allocations payment_allocations_allocated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_allocated_by_fkey FOREIGN KEY (allocated_by) REFERENCES public.users(user_id);


--
-- Name: payment_allocations payment_allocations_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(invoice_id) ON DELETE CASCADE;


--
-- Name: payment_allocations payment_allocations_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(payment_id) ON DELETE CASCADE;


--
-- Name: payment_allocations payment_allocations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: payments payments_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.school_payment_channels(channel_id) ON DELETE SET NULL;


--
-- Name: payments payments_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: payments payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(user_id);


--
-- Name: payments payments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: platform_invoices platform_invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: platform_invoices platform_invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_invoices
    ADD CONSTRAINT platform_invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: receipt_sequences receipt_sequences_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receipt_sequences
    ADD CONSTRAINT receipt_sequences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: reconciliation_runs reconciliation_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_runs
    ADD CONSTRAINT reconciliation_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: reconciliation_runs reconciliation_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_runs
    ADD CONSTRAINT reconciliation_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: refunds refunds_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(payment_id) ON DELETE CASCADE;


--
-- Name: refunds refunds_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(user_id);


--
-- Name: refunds refunds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: report_card_comments report_card_comments_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.report_cards(card_id) ON DELETE CASCADE;


--
-- Name: report_card_comments report_card_comments_learning_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_learning_area_id_fkey FOREIGN KEY (learning_area_id) REFERENCES public.learning_areas(area_id) ON DELETE CASCADE;


--
-- Name: report_card_comments report_card_comments_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(user_id);


--
-- Name: report_card_comments report_card_comments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_card_comments
    ADD CONSTRAINT report_card_comments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: report_cards report_cards_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(user_id);


--
-- Name: report_cards report_cards_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.report_runs(run_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: report_cards report_cards_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_cards
    ADD CONSTRAINT report_cards_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: report_runs report_runs_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.report_templates(template_id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_term_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_runs
    ADD CONSTRAINT report_runs_term_id_fkey FOREIGN KEY (term_id) REFERENCES public.terms(term_id) ON DELETE CASCADE;


--
-- Name: report_templates report_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: report_templates report_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: reset_challenges reset_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reset_challenges
    ADD CONSTRAINT reset_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: retention_policies retention_policies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: retention_policies retention_policies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: rfid_tags rfid_tags_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfid_tags
    ADD CONSTRAINT rfid_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: school_finance_settings school_finance_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_finance_settings
    ADD CONSTRAINT school_finance_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: school_finance_settings school_finance_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_finance_settings
    ADD CONSTRAINT school_finance_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: school_payment_channels school_payment_channels_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_payment_channels
    ADD CONSTRAINT school_payment_channels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: school_settings school_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_settings
    ADD CONSTRAINT school_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: school_settings school_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.school_settings
    ADD CONSTRAINT school_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: staff_profiles staff_profiles_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.tenant_memberships(membership_id) ON DELETE CASCADE;


--
-- Name: strands strands_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strands
    ADD CONSTRAINT strands_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.learning_areas(area_id) ON DELETE CASCADE;


--
-- Name: streams streams_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.streams
    ADD CONSTRAINT streams_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: sub_strands sub_strands_strand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sub_strands
    ADD CONSTRAINT sub_strands_strand_id_fkey FOREIGN KEY (strand_id) REFERENCES public.strands(strand_id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: subscriptions subscriptions_payment_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_payment_channel_id_fkey FOREIGN KEY (payment_channel_id) REFERENCES public.school_payment_channels(channel_id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(plan_id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: sync_conflicts sync_conflicts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(user_id);


--
-- Name: sync_conflicts sync_conflicts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: sync_log sync_log_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(device_id) ON DELETE CASCADE;


--
-- Name: sync_log sync_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_log
    ADD CONSTRAINT sync_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_class_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_class_group_id_fkey FOREIGN KEY (class_group_id) REFERENCES public.class_groups(class_group_id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_staff_membership_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_staff_membership_id_fkey FOREIGN KEY (staff_membership_id) REFERENCES public.tenant_memberships(membership_id) ON DELETE CASCADE;


--
-- Name: teaching_assignments teaching_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teaching_assignments
    ADD CONSTRAINT teaching_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_pinned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_curriculum_pins
    ADD CONSTRAINT tenant_curriculum_pins_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.users(user_id);


--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_curriculum_pins
    ADD CONSTRAINT tenant_curriculum_pins_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_curriculum_pins
    ADD CONSTRAINT tenant_curriculum_pins_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.curriculum_versions(version_id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: tenant_usage tenant_usage_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_usage
    ADD CONSTRAINT tenant_usage_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: terms terms_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: terms terms_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms
    ADD CONSTRAINT terms_year_id_fkey FOREIGN KEY (year_id) REFERENCES public.academic_years(year_id) ON DELETE CASCADE;


--
-- Name: transfers transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: transfers transfers_learner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_learner_id_fkey FOREIGN KEY (learner_id) REFERENCES public.learners(learner_id) ON DELETE CASCADE;


--
-- Name: transfers transfers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transfers
    ADD CONSTRAINT transfers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.schools(tenant_id) ON DELETE CASCADE;


--
-- Name: user_security_answers user_security_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_security_answers
    ADD CONSTRAINT user_security_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.security_questions(question_id);


--
-- Name: user_security_answers user_security_answers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_security_answers
    ADD CONSTRAINT user_security_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: weighting_profiles weighting_profiles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weighting_profiles
    ADD CONSTRAINT weighting_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: weighting_profiles weighting_profiles_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weighting_profiles
    ADD CONSTRAINT weighting_profiles_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.grades(grade_id) ON DELETE CASCADE;


--
-- Name: academic_years; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_years academic_years_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY academic_years_isolation ON public.academic_years USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: access_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: access_logs access_logs_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY access_logs_isolation ON public.access_logs USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: adjustments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;

--
-- Name: adjustments adjustments_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY adjustments_isolation ON public.adjustments USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: assessment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_events assessment_events_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_events_isolation ON public.assessment_events USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: assessment_result_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_result_history ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_result_history assessment_result_history_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_result_history_isolation ON public.assessment_result_history USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: assessment_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assessment_results ENABLE ROW LEVEL SECURITY;

--
-- Name: assessment_results assessment_results_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessment_results_isolation ON public.assessment_results USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: attendance_marks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_marks ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_marks attendance_marks_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_marks_isolation ON public.attendance_marks USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: attendance_registers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_registers ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_registers attendance_registers_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_registers_isolation ON public.attendance_registers USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: breach_register; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.breach_register ENABLE ROW LEVEL SECURITY;

--
-- Name: breach_register breach_register_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY breach_register_isolation ON public.breach_register USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: broadcast_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_recipients broadcast_recipients_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcast_recipients_isolation ON public.broadcast_recipients USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: broadcasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcasts broadcasts_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY broadcasts_isolation ON public.broadcasts USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: capitation_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capitation_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: capitation_receipts capitation_receipts_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY capitation_receipts_isolation ON public.capitation_receipts USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: class_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: class_groups class_groups_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY class_groups_isolation ON public.class_groups USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: competency_ratings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competency_ratings ENABLE ROW LEVEL SECURITY;

--
-- Name: competency_ratings competency_ratings_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competency_ratings_isolation ON public.competency_ratings USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: consent_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records consent_records_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_records_isolation ON public.consent_records USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

--
-- Name: credits credits_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY credits_isolation ON public.credits USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: delivery_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_receipts delivery_receipts_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_receipts_isolation ON public.delivery_receipts USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

--
-- Name: devices devices_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY devices_isolation ON public.devices USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: dpia_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dpia_records ENABLE ROW LEVEL SECURITY;

--
-- Name: dpia_records dpia_records_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dpia_records_isolation ON public.dpia_records USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: dsr_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dsr_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: dsr_requests dsr_requests_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dsr_requests_isolation ON public.dsr_requests USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: email_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

--
-- Name: enrolments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrolments ENABLE ROW LEVEL SECURITY;

--
-- Name: enrolments enrolments_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrolments_isolation ON public.enrolments USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: evidence_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_files ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_files evidence_files_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_files_isolation ON public.evidence_files USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: exam_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_windows exam_windows_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY exam_windows_isolation ON public.exam_windows USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: exports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

--
-- Name: exports exports_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY exports_isolation ON public.exports USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: fee_structures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;

--
-- Name: fee_structures fee_structures_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fee_structures_isolation ON public.fee_structures USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: gate_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gate_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: gate_devices gate_devices_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gate_devices_isolation ON public.gate_devices USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: gate_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gate_events ENABLE ROW LEVEL SECURITY;

--
-- Name: gate_events gate_events_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gate_events_isolation ON public.gate_events USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: guardian_claim_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guardian_claim_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: guardian_claim_codes guardian_claim_codes_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guardian_claim_codes_all ON public.guardian_claim_codes USING (true);


--
-- Name: guardians; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;

--
-- Name: guardians guardians_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guardians_isolation ON public.guardians USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches import_batches_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY import_batches_isolation ON public.import_batches USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: import_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: import_rows import_rows_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY import_rows_isolation ON public.import_rows USING ((EXISTS ( SELECT 1
   FROM public.import_batches ib
  WHERE ((ib.batch_id = import_rows.batch_id) AND ((ib.tenant_id)::text = current_setting('app.current_tenant_id'::text, true))))));


--
-- Name: invoice_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_lines invoice_lines_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoice_lines_isolation ON public.invoice_lines USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_isolation ON public.invoices USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: knec_export_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knec_export_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: knec_export_batches knec_export_batches_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knec_export_batches_isolation ON public.knec_export_batches USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: knec_submission_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knec_submission_status ENABLE ROW LEVEL SECURITY;

--
-- Name: knec_submission_status knec_submission_status_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knec_submission_status_isolation ON public.knec_submission_status USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: learner_fee_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_fee_options ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_fee_options learner_fee_options_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_fee_options_isolation ON public.learner_fee_options USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: learner_guardians; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_guardians ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_guardians learner_guardians_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_guardians_isolation ON public.learner_guardians USING ((EXISTS ( SELECT 1
   FROM public.learners l
  WHERE ((l.learner_id = learner_guardians.learner_id) AND ((l.tenant_id)::text = current_setting('app.current_tenant_id'::text, true))))));


--
-- Name: learner_remarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_remarks ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_remarks learner_remarks_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_remarks_isolation ON public.learner_remarks USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: learner_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learner_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: learner_status_history learner_status_history_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learner_status_history_isolation ON public.learner_status_history USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: learners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;

--
-- Name: learners learners_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY learners_isolation ON public.learners USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates message_templates_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_templates_isolation ON public.message_templates USING ((((tenant_id)::text = (public.current_tenant_id())::text) OR (tenant_id IS NULL)));


--
-- Name: mpesa_stk_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mpesa_stk_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: mpesa_stk_requests mpesa_stk_requests_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpesa_stk_requests_isolation ON public.mpesa_stk_requests USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: mpesa_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: mpesa_transactions mpesa_transactions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mpesa_transactions_isolation ON public.mpesa_transactions USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: opt_outs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opt_outs ENABLE ROW LEVEL SECURITY;

--
-- Name: opt_outs opt_outs_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opt_outs_isolation ON public.opt_outs USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: otp_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: otp_challenges otp_challenges_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY otp_challenges_all ON public.otp_challenges USING (true);


--
-- Name: outbound_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outbound_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: outbound_messages outbound_messages_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbound_messages_isolation ON public.outbound_messages USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: password_reset_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_allocations payment_allocations_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_allocations_isolation ON public.payment_allocations USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_isolation ON public.payments USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: platform_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_invoices platform_invoices_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_invoices_isolation ON public.platform_invoices USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: receipt_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.receipt_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: receipt_sequences receipt_sequences_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY receipt_sequences_isolation ON public.receipt_sequences USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: reconciliation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliation_runs reconciliation_runs_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliation_runs_isolation ON public.reconciliation_runs USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens refresh_tokens_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refresh_tokens_isolation ON public.refresh_tokens USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: refunds refunds_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refunds_isolation ON public.refunds USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: report_card_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_card_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: report_card_comments report_card_comments_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_card_comments_isolation ON public.report_card_comments USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: report_cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_cards ENABLE ROW LEVEL SECURITY;

--
-- Name: report_cards report_cards_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_cards_isolation ON public.report_cards USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: report_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: report_runs report_runs_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_runs_isolation ON public.report_runs USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: report_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: report_templates report_templates_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY report_templates_isolation ON public.report_templates USING ((((tenant_id)::text = (public.current_tenant_id())::text) OR (tenant_id IS NULL)));


--
-- Name: password_reset_tokens reset_tokens_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reset_tokens_isolation ON public.password_reset_tokens USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: retention_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: retention_policies retention_policies_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retention_policies_isolation ON public.retention_policies USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: rfid_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rfid_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: rfid_tags rfid_tags_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rfid_tags_isolation ON public.rfid_tags USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: school_finance_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.school_finance_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: school_finance_settings school_finance_settings_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_finance_settings_isolation ON public.school_finance_settings USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: school_payment_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.school_payment_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: school_payment_channels school_payment_channels_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_payment_channels_isolation ON public.school_payment_channels USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: school_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: school_settings school_settings_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY school_settings_isolation ON public.school_settings USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- Name: schools schools_insert_saas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_insert_saas ON public.schools FOR INSERT WITH CHECK ((current_setting('app.current_tenant_id'::text, true) IS NOT NULL));


--
-- Name: schools schools_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_select_all ON public.schools FOR SELECT USING (true);


--
-- Name: schools schools_update_saas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_update_saas ON public.schools FOR UPDATE USING ((current_setting('app.current_tenant_id'::text, true) IS NOT NULL));


--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions sessions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_isolation ON public.sessions USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- Name: staff_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_profiles staff_profiles_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY staff_profiles_isolation ON public.staff_profiles USING ((EXISTS ( SELECT 1
   FROM public.tenant_memberships tm
  WHERE ((tm.membership_id = staff_profiles.membership_id) AND ((tm.tenant_id)::text = current_setting('app.current_tenant_id'::text, true))))));


--
-- Name: streams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;

--
-- Name: streams streams_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY streams_isolation ON public.streams USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_isolation ON public.subscriptions USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: sync_conflicts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_conflicts sync_conflicts_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_conflicts_isolation ON public.sync_conflicts USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: sync_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_log sync_log_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_log_isolation ON public.sync_log USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: teaching_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: teaching_assignments teaching_assignments_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teaching_assignments_isolation ON public.teaching_assignments USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: tenant_curriculum_pins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_curriculum_pins ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_curriculum_pins tenant_curriculum_pins_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_curriculum_pins_isolation ON public.tenant_curriculum_pins USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: tenant_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_memberships tenant_memberships_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_memberships_isolation ON public.tenant_memberships USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: tenant_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_usage tenant_usage_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_usage_isolation ON public.tenant_usage USING (((tenant_id)::text = (public.current_tenant_id())::text));


--
-- Name: terms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;

--
-- Name: terms terms_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY terms_isolation ON public.terms USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: transfers transfers_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transfers_isolation ON public.transfers USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_self ON public.users FOR INSERT WITH CHECK (true);


--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT USING (((user_id = (current_setting('app.current_user_id'::text, true))::uuid) OR (current_setting('app.current_user_role'::text, true) = 'SAAS_ADMIN'::text)));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid));


--
-- PostgreSQL database dump complete
--


