-- Migration 030: FORCE ROW LEVEL SECURITY on remaining tenant tables (slices 3-6)
-- These tables are created in migrations 020-029, which run after migration 020
-- (the hardening migration). FORCE RLS is applied here so every tenant-scoped
-- table has it, with skulapp_migrator holding BYPASSRLS for deploy/seed work.

-- Slice 3: curriculum, assessment, evidence, knec
ALTER TABLE tenant_curriculum_pins FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_events FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
ALTER TABLE assessment_result_history FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_files FORCE ROW LEVEL SECURITY;
ALTER TABLE competency_ratings FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_remarks FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_log FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE knec_submission_status FORCE ROW LEVEL SECURITY;
ALTER TABLE knec_export_batches FORCE ROW LEVEL SECURITY;

-- Slice 4: reports, compliance, comms
ALTER TABLE report_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE report_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE report_card_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE access_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE dsr_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE breach_register FORCE ROW LEVEL SECURITY;
ALTER TABLE retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE dpia_records FORCE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE outbound_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE delivery_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE broadcasts FORCE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE opt_outs FORCE ROW LEVEL SECURITY;

-- Slice 5: attendance, gate
ALTER TABLE attendance_registers FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_marks FORCE ROW LEVEL SECURITY;
ALTER TABLE gate_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE rfid_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE gate_events FORCE ROW LEVEL SECURITY;

-- Slice 6: platform, exports
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE exports FORCE ROW LEVEL SECURITY;
