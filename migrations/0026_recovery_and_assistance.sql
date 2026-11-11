-- Free account-recovery primitives: security questions (no SMS/email cost),
-- one-time support codes issued by a platform administrator, and the queue of
-- users who asked for help when they could not answer their questions.
--
-- These are authentication tables (not tenant data); the API is the only
-- access path and never returns answer hashes or code hashes.

CREATE TABLE IF NOT EXISTS public.user_security_answers (
    user_id uuid NOT NULL,
    question_key character varying(50) NOT NULL,
    answer_hash character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, question_key),
    CONSTRAINT user_security_answers_user_fk
        FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.password_assistance_requests (
    request_id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    tenant_id character varying(50),
    note text,
    status character varying(20) NOT NULL DEFAULT 'PENDING',
    resolution_method character varying(30),
    resolved_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    resolved_at timestamp with time zone,
    CONSTRAINT password_assistance_requests_user_fk
        FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_assistance_status_created
    ON public.password_assistance_requests (status, created_at DESC);

-- One open request per user; repeats update the note instead of spamming.
CREATE UNIQUE INDEX IF NOT EXISTS uq_password_assistance_pending
    ON public.password_assistance_requests (user_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS public.password_reset_codes (
    code_id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL,
    code_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_codes_user_fk
        FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user
    ON public.password_reset_codes (user_id, expires_at DESC);

-- Any successful password change (self-service, security questions, or an
-- administrator-issued code) resolves the user's open assistance request.
CREATE OR REPLACE FUNCTION public.resolve_password_assistance_on_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
        UPDATE public.password_assistance_requests
           SET status = 'RESOLVED',
               resolved_at = now(),
               resolution_method = COALESCE(NULLIF(resolution_method, ''), 'PASSWORD_CHANGED')
         WHERE user_id = NEW.user_id
           AND status = 'PENDING';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_password_assistance ON public.users;
CREATE TRIGGER trg_users_password_assistance
    AFTER UPDATE OF password_hash ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.resolve_password_assistance_on_change();
