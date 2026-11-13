-- 0045_client_uuid_text.sql
--
-- The offline outbox derives client_uuid from a deterministic composite key
-- (register_id:learner_id for attendance, event_id:learner_id:learning_area_id
-- for assessment), not from a UUID. The baseline declared both client_uuid
-- columns as uuid, so every queued offline write failed on reconnect with
-- "invalid input syntax for type uuid" and the outbox never drained.
--
-- These values are opaque idempotency keys. Widen them to text: existing UUID
-- strings remain valid text, and the partial unique indexes keep their meaning.

ALTER TABLE public.assessment_results
    ALTER COLUMN client_uuid TYPE text USING client_uuid::text;

ALTER TABLE public.attendance_marks
    ALTER COLUMN client_uuid TYPE text USING client_uuid::text;
