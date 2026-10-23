-- School security questions schema (no email/SMS needed for reset).
-- Answers stored as argon2id hashes — never plaintext.
-- EXACTLY 3 questions.

CREATE TABLE IF NOT EXISTS security_questions (
    question_id   SERIAL PRIMARY KEY,
    question_text TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_security_answers (
    answer_id     BIGSERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    question_id   INTEGER NOT NULL REFERENCES security_questions(question_id),
    answer_hash   TEXT NOT NULL,          -- argon2id hash of the normalised answer
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_user_security_answers_user ON user_security_answers(user_id);

-- Seed exactly 3 questions.
INSERT INTO security_questions (question_id, question_text, display_order) VALUES
    (1, 'What is the name of your school?', 1),
    (2, 'What is the name of your class teacher (homeroom)?', 2),
    (3, 'What is your admission number / learner index number?', 3)
ON CONFLICT (question_id) DO NOTHING;

-- Reset challenge tokens (dialogue-box flow).
CREATE TABLE IF NOT EXISTS reset_challenges (
    challenge_id   BIGSERIAL PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL,
    token_prefix   TEXT NOT NULL,
    attempts       INTEGER NOT NULL DEFAULT 0,
    max_attempts   INTEGER NOT NULL DEFAULT 3,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    created_by_ip  INET,
    request_id     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_challenges_hash ON reset_challenges(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_challenges_user ON reset_challenges(user_id, created_at DESC);