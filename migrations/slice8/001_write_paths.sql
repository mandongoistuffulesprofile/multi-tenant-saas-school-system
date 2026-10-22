-- Slice 8: write paths for custom data entry.
--
-- The read-only API shipped in slices 1-7 could not accept the data the UI
-- collects. These columns and indexes make the teacher capture flows
-- (assessment results, attendance marks) safe to replay from an offline
-- device: every queued write carries a client_uuid, so a replayed queue
-- upserts instead of duplicating.

-- attendance_marks: offline-safe columns + updated_at for the register editor.
ALTER TABLE attendance_marks ADD COLUMN IF NOT EXISTS client_uuid uuid;
ALTER TABLE attendance_marks ADD COLUMN IF NOT EXISTS device_id uuid;
ALTER TABLE attendance_marks ADD COLUMN IF NOT EXISTS client_ts timestamptz;
ALTER TABLE attendance_marks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- One mark per learner per register. Older rows may contain duplicates from
-- before the register editor existed, so collapse them before adding the
-- constraint.
DELETE FROM attendance_marks a
USING attendance_marks b
WHERE a.tenant_id = b.tenant_id
  AND a.register_id = b.register_id
  AND a.learner_id = b.learner_id
  AND a.mark_id > b.mark_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_marks_register_learner
  ON attendance_marks (tenant_id, register_id, learner_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_marks_client_uuid
  ON attendance_marks (tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- Assessment results: the offline grading grid replays with the same
-- client_uuid, so a replay must not create a second row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_results_client_uuid
  ON assessment_results (tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- One current result per (event, learner, sub-strand) as specified in the
-- assessment model. NULL sub_strand entries are matched with IS NOT DISTINCT
-- FROM so a whole-learning-area result is unique too.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_results_event_learner_substrand
  ON assessment_results (tenant_id, event_id, learner_id, COALESCE(sub_strand_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Streams, class groups and teaching assignments are school-owned reference
-- data. The unique keys the API relies on are enforced here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_streams_tenant_name
  ON streams (tenant_id, stream_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_groups_tenant_year_grade_stream
  ON class_groups (tenant_id, year_id, grade_id, stream_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_teaching_assignments_tenant
  ON teaching_assignments (tenant_id, staff_membership_id, class_group_id, subject_id, academic_year_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rfid_tags_tenant_uid
  ON rfid_tags (tenant_id, tag_uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_devices_tenant_name
  ON gate_devices (tenant_id, device_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_school_settings_tenant_key
  ON school_settings (tenant_id, setting_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_templates_tenant_name
  ON report_templates (tenant_id, template_name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_tenant_name
  ON message_templates (tenant_id, template_name);

-- Consent notices are global reference data; make the code unique so a new
-- version can be published without clashing with an existing one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_notices_code_version
  ON consent_notices (notice_code, version);

-- Remarks and competency ratings are edited in place by teachers, so they
-- need a stable key to upsert against.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_remarks_tenant_event_learner
  ON learner_remarks (tenant_id, event_id, learner_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_competency_ratings_tenant_result_code
  ON competency_ratings (tenant_id, result_id, competency_code);

-- Fee structures are versioned per year/term/grade/category.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_structures_tenant
  ON fee_structures (tenant_id, academic_year_id, grade_id, category_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_learner_fee_options_tenant
  ON learner_fee_options (tenant_id, learner_id, category_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_tenant_number
  ON invoices (tenant_id, invoice_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_tenant_reference
  ON payments (tenant_id, payment_reference);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_cards_tenant_run_learner
  ON report_cards (tenant_id, run_id, learner_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_comments_tenant_card_area
  ON report_card_comments (tenant_id, card_id, learning_area_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbound_messages_tenant
  ON outbound_messages (tenant_id, template_id, recipient_id, channel)
  WHERE template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_records_tenant_user_notice
  ON consent_records (tenant_id, user_id, notice_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retention_policies_tenant_resource
  ON retention_policies (tenant_id, resource_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_opt_outs_tenant_user_channel
  ON opt_outs (tenant_id, user_id, channel);



