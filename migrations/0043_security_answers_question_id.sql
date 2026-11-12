-- 0043_security_answers_question_id.sql
--
-- 0026 created user_security_answers with a question_key text column, but the
-- recovery handlers store and read question_id integers joined to
-- security_questions(question_id). GET /me/security-questions therefore failed
-- with "column a.question_id does not exist" for every signed-in user.
--
-- The key-based shape was never written by the API, so no application data is
-- lost. Rebuild the table with the shape the code uses.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'user_security_answers'
           AND column_name = 'question_key'
    ) THEN
        DROP TABLE public.user_security_answers;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_security_answers (
    user_id uuid NOT NULL,
    question_id integer NOT NULL,
    answer_hash character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, question_id),
    CONSTRAINT user_security_answers_user_fk
        FOREIGN KEY (user_id) REFERENCES public.users (user_id) ON DELETE CASCADE,
    CONSTRAINT user_security_answers_question_fk
        FOREIGN KEY (question_id) REFERENCES public.security_questions (question_id) ON DELETE CASCADE
);
