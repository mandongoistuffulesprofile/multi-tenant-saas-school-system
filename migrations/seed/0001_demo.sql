-- Demo tenant for local development and smoke tests.
--
-- Applied only with: go run ./cmd/migrate -dir ../migrations -seed
-- No credentials are seeded. Create the demo users after seeding with
-- cmd/devuser, which generates a password and prints it once:
--   DEV_EMAIL=admin@demo.test DEV_TENANT=demo-school DEV_ROLE=SCHOOL_ADMIN \
--     go run ./cmd/devuser
-- Change or delete this tenant before production.
--
-- The school is intentionally small but complete: two classes, six learners,
-- an attendance register, an invoice with a partial payment, a parent notice,
-- a consent notice and a published report card. Screenshot and route checks
-- run against this seed, so an empty-state-only pass cannot hide a broken
-- join. Every row is idempotent: re-applying the file leaves one copy.

-- RLS-aware tables require app.current_tenant_id to be set before writes.
SELECT set_config('app.current_tenant_id', 'demo-school', true);

INSERT INTO schools (tenant_id, school_name, subdomain, school_type, funding_mode, status, license_tier)
VALUES ('demo-school', 'Demo Primary School', 'demo', 'PRIMARY', 'PRIVATE', 'ACTIVE', 'STANDARD')
ON CONFLICT (tenant_id) DO NOTHING;

-- The baseline chart of accounts lives in migrations/seed/0002_ledger_accounts.sql,
-- generated from internal/ledger so the wizard and the demo seed share one
-- definition.

-- Global grade reference (Kenyan CBC 1-9 + PP1/PP2). Required by
-- fee_structures.grade_id and class_groups.grade_id FKs; the onboarding
-- wizard's finance/structure steps reference these codes.
INSERT INTO grades (grade_id, grade_label, level_band, lessons_per_week) VALUES
  ('PP1', 'PP1', 'EYE', 25),
  ('PP2', 'PP2', 'EYE', 25),
  ('G1',  'Grade 1', 'LOWER_PRIMARY', 31),
  ('G2',  'Grade 2', 'LOWER_PRIMARY', 31),
  ('G3',  'Grade 3', 'LOWER_PRIMARY', 31),
  ('G4',  'Grade 4', 'UPPER_PRIMARY', 35),
  ('G5',  'Grade 5', 'UPPER_PRIMARY', 35),
  ('G6',  'Grade 6', 'UPPER_PRIMARY', 35),
  ('G7',  'Grade 7', 'JSS', 45),
  ('G8',  'Grade 8', 'JSS', 45),
  ('G9',  'Grade 9', 'JSS', 45)
ON CONFLICT (grade_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Academic year, term, streams and classes
-- ---------------------------------------------------------------------------

INSERT INTO academic_years (year_id, tenant_id, year_label, start_date, end_date, is_current)
VALUES ('a0000000-0000-4000-8000-000000000001', 'demo-school', '2026',
        DATE '2026-01-05', DATE '2026-11-27', true)
ON CONFLICT (tenant_id, year_label) DO NOTHING;

INSERT INTO terms (term_id, tenant_id, year_id, term_number, term_label,
                   start_date, end_date, is_current)
VALUES ('b0000000-0000-4000-8000-000000000003', 'demo-school',
        'a0000000-0000-4000-8000-000000000001', 3, 'Term 3 2026',
        DATE '2026-09-01', DATE '2026-11-27', true)
ON CONFLICT (tenant_id, year_id, term_number) DO NOTHING;

INSERT INTO streams (stream_id, tenant_id, stream_name) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'demo-school', 'East'),
  ('c0000000-0000-4000-8000-000000000002', 'demo-school', 'West')
ON CONFLICT (stream_id) DO NOTHING;

INSERT INTO class_groups (class_group_id, tenant_id, year_id, grade_id, stream_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'demo-school',
   'a0000000-0000-4000-8000-000000000001', 'G4',
   'c0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'demo-school',
   'a0000000-0000-4000-8000-000000000001', 'G4',
   'c0000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Learners, guardians and enrolments
-- ---------------------------------------------------------------------------

INSERT INTO learners (learner_id, tenant_id, admission_number, first_name, last_name,
                      gender, status, admitted_on)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'demo-school', 'DEMO-002', 'Brian',  'Otieno', 'MALE',   'ACTIVE', DATE '2026-01-05'),
  ('e0000000-0000-4000-8000-000000000002', 'demo-school', 'DEMO-003', 'Cynthia','Chebet', 'FEMALE', 'ACTIVE', DATE '2026-01-05'),
  ('e0000000-0000-4000-8000-000000000003', 'demo-school', 'DEMO-004', 'David',  'Mutua',  'MALE',   'ACTIVE', DATE '2026-01-05'),
  ('e0000000-0000-4000-8000-000000000004', 'demo-school', 'DEMO-005', 'Esther', 'Njeri',  'FEMALE', 'ACTIVE', DATE '2026-01-05'),
  ('e0000000-0000-4000-8000-000000000005', 'demo-school', 'DEMO-006', 'Farouk', 'Hassan', 'MALE',   'ACTIVE', DATE '2026-01-05')
ON CONFLICT (tenant_id, admission_number) DO NOTHING;

-- Amina is inserted by the original seed with a generated id; keep that row
-- and use the admission number wherever she is referenced.
INSERT INTO learners (tenant_id, admission_number, first_name, last_name, gender, status, admitted_on)
VALUES ('demo-school', 'DEMO-001', 'Amina', 'Wanjiku', 'FEMALE', 'ACTIVE', DATE '2026-01-05')
ON CONFLICT (tenant_id, admission_number) DO NOTHING;

INSERT INTO guardians (guardian_id, tenant_id, first_name, last_name, phone_number, email)
VALUES ('f0000000-0000-4000-8000-000000000001', 'demo-school', 'Grace', 'Wanjiku',
        '254700000003', 'parent@demo.test')
ON CONFLICT (guardian_id) DO NOTHING;

-- The original seed created Grace with a generated id. Keep only one row for
-- her phone so devuser's guardian lookup is unambiguous.
DELETE FROM guardians
 WHERE tenant_id = 'demo-school'
   AND phone_number = '254700000003'
   AND guardian_id <> 'f0000000-0000-4000-8000-000000000001'
   AND NOT EXISTS (
     SELECT 1 FROM learner_guardians lg
      WHERE lg.guardian_id = guardians.guardian_id
   );

INSERT INTO guardians (tenant_id, first_name, last_name, phone_number, email)
SELECT 'demo-school', 'Peter', 'Otieno', '254700000004', 'peter.otieno@demo.test'
WHERE NOT EXISTS (
  SELECT 1 FROM guardians WHERE tenant_id = 'demo-school' AND phone_number = '254700000004'
);

INSERT INTO learner_guardians (link_id, learner_id, guardian_id, relationship,
                               is_primary_payer, is_emergency_contact, can_collect, can_view_fees)
SELECT 'a1000000-0000-4000-8000-000000000001', l.learner_id,
       'f0000000-0000-4000-8000-000000000001', 'MOTHER', true, true, true, true
  FROM learners l
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-001'
ON CONFLICT (link_id) DO NOTHING;

INSERT INTO learner_guardians (link_id, learner_id, guardian_id, relationship,
                               is_primary_payer, is_emergency_contact, can_collect, can_view_fees)
SELECT 'a1000000-0000-4000-8000-000000000002', l.learner_id,
       'f0000000-0000-4000-8000-000000000001', 'MOTHER', false, false, true, true
  FROM learners l
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-002'
ON CONFLICT (link_id) DO NOTHING;

INSERT INTO learner_guardians (link_id, learner_id, guardian_id, relationship,
                               is_primary_payer, is_emergency_contact, can_collect, can_view_fees)
SELECT 'a1000000-0000-4000-8000-000000000003', l.learner_id, g.guardian_id,
       'FATHER', true, true, true, true
  FROM learners l, guardians g
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-002'
   AND g.tenant_id = 'demo-school' AND g.phone_number = '254700000004'
ON CONFLICT (link_id) DO NOTHING;

-- Amina, Brian and Cynthia are in 4 East; the other three are in 4 West.
INSERT INTO enrolments (tenant_id, learner_id, class_group_id, year_id, status, started_on)
SELECT 'demo-school', l.learner_id,
       CASE WHEN l.admission_number IN ('DEMO-001', 'DEMO-002', 'DEMO-003')
            THEN 'd0000000-0000-4000-8000-000000000001'::uuid
            ELSE 'd0000000-0000-4000-8000-000000000002'::uuid END,
       'a0000000-0000-4000-8000-000000000001', 'ACTIVE', DATE '2026-01-05'
  FROM learners l
 WHERE l.tenant_id = 'demo-school'
   AND l.admission_number IN ('DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005', 'DEMO-006')
   AND NOT EXISTS (
     SELECT 1 FROM enrolments e
      WHERE e.tenant_id = 'demo-school'
        AND e.learner_id = l.learner_id
        AND e.year_id = 'a0000000-0000-4000-8000-000000000001'
   );

-- ---------------------------------------------------------------------------
-- Attendance: one closed register per class with a mark for every learner
-- ---------------------------------------------------------------------------

INSERT INTO attendance_registers (register_id, tenant_id, class_group_id, grade_id,
                                  stream_id, academic_year_id, term_id, register_date,
                                  session_type, status, marked_at)
VALUES
  ('b1000000-0000-4000-8000-000000000001', 'demo-school',
   'd0000000-0000-4000-8000-000000000001', 'G4',
   'c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003', DATE '2026-11-10', 'MORNING', 'CLOSED',
   TIMESTAMPTZ '2026-11-10 07:45:00+03'),
  ('b1000000-0000-4000-8000-000000000002', 'demo-school',
   'd0000000-0000-4000-8000-000000000002', 'G4',
   'c0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003', DATE '2026-11-10', 'MORNING', 'CLOSED',
   TIMESTAMPTZ '2026-11-10 07:45:00+03')
ON CONFLICT (register_id) DO NOTHING;

INSERT INTO attendance_marks (mark_id, tenant_id, register_id, learner_id, status, marked_at)
SELECT ('b2000000-0000-4000-8000-00000000000' || right(l.admission_number, 1))::uuid,
       'demo-school',
       CASE WHEN l.admission_number IN ('DEMO-001', 'DEMO-002', 'DEMO-003')
            THEN 'b1000000-0000-4000-8000-000000000001'::uuid
            ELSE 'b1000000-0000-4000-8000-000000000002'::uuid END,
       l.learner_id,
       CASE WHEN l.admission_number = 'DEMO-004' THEN 'ABSENT' ELSE 'PRESENT' END,
       TIMESTAMPTZ '2026-11-10 07:45:00+03'
  FROM learners l
 WHERE l.tenant_id = 'demo-school'
   AND l.admission_number IN ('DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005', 'DEMO-006')
   AND NOT EXISTS (
     SELECT 1 FROM attendance_marks am
      WHERE am.tenant_id = 'demo-school'
        AND am.register_id = CASE WHEN l.admission_number IN ('DEMO-001', 'DEMO-002', 'DEMO-003')
                                  THEN 'b1000000-0000-4000-8000-000000000001'::uuid
                                  ELSE 'b1000000-0000-4000-8000-000000000002'::uuid END
        AND am.learner_id = l.learner_id
   );

-- ---------------------------------------------------------------------------
-- Fees: one invoice with a partial M-Pesa payment
-- ---------------------------------------------------------------------------

INSERT INTO fee_categories (category_id, tenant_id, code, name, is_tuition)
VALUES ('c1000000-0000-4000-8000-000000000001', 'demo-school', 'TUITION', 'Tuition', true)
ON CONFLICT (category_id) DO NOTHING;

INSERT INTO fee_structures (structure_id, tenant_id, academic_year_id, grade_id,
                            category_id, amount_per_term, amount_per_year)
VALUES ('c2000000-0000-4000-8000-000000000001', 'demo-school',
        'a0000000-0000-4000-8000-000000000001', 'G4',
        'c1000000-0000-4000-8000-000000000001', 15000, 45000)
ON CONFLICT DO NOTHING;

INSERT INTO invoices (invoice_id, tenant_id, invoice_number, learner_id,
                      academic_year_id, term_id, status, total_amount, amount_paid,
                      amount_outstanding, issue_date, due_date)
SELECT 'd1000000-0000-4000-8000-000000000001', 'demo-school', 'INV-2026-0001',
       l.learner_id, 'a0000000-0000-4000-8000-000000000001',
       'b0000000-0000-4000-8000-000000000003', 'PARTIALLY_PAID',
       15000, 5000, 10000, DATE '2026-09-05', DATE '2026-09-20'
  FROM learners l
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-001'
ON CONFLICT (invoice_id) DO NOTHING;

INSERT INTO invoice_lines (line_id, tenant_id, invoice_id, category_id, description,
                           quantity, unit_amount, line_amount, academic_year_id, term_id)
VALUES ('d2000000-0000-4000-8000-000000000001', 'demo-school',
        'd1000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001', 'Term 3 tuition', 1,
        15000, 15000, 'a0000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000003')
ON CONFLICT (line_id) DO NOTHING;

INSERT INTO payments (payment_id, tenant_id, payment_reference, learner_id, source,
                      amount, status, mpesa_trans_id, received_at)
SELECT 'd3000000-0000-4000-8000-000000000001', 'demo-school', 'PAY-DEMO-0001',
       l.learner_id, 'MPESA', 5000, 'ALLOCATED', 'DEMOMPESA0001',
       TIMESTAMPTZ '2026-10-05 10:15:00+03'
  FROM learners l
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-001'
ON CONFLICT (payment_id) DO NOTHING;

INSERT INTO payment_allocations (allocation_id, tenant_id, payment_id, invoice_id,
                                 allocated_amount, allocated_at)
VALUES ('d4000000-0000-4000-8000-000000000001', 'demo-school',
        'd3000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000001', 5000,
        TIMESTAMPTZ '2026-10-05 10:16:00+03')
ON CONFLICT (payment_id, invoice_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Comms and privacy consent
-- ---------------------------------------------------------------------------

INSERT INTO broadcasts (broadcast_id, tenant_id, broadcast_name, channel, target_audience,
                        subject, body_text, status, sent_at)
VALUES ('e1000000-0000-4000-8000-000000000001', 'demo-school',
        'Term 3 closing day', 'SMS', 'PARENTS', 'Term 3 closing day',
        'School closes on 27 November 2026. Reports are available in the parent portal.',
        'SENT', TIMESTAMPTZ '2026-11-12 09:00:00+03')
ON CONFLICT (broadcast_id) DO NOTHING;

INSERT INTO consent_notices (notice_id, notice_code, title, content_text, version, is_active)
VALUES ('e2000000-0000-4000-8000-000000000001', 'DATA_PROCESSING',
        'Data processing consent',
        'We process learner and guardian data to run the school and meet statutory reporting duties.',
        1, true)
ON CONFLICT (notice_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Report card: published so both staff and the linked parent can read it
-- ---------------------------------------------------------------------------

INSERT INTO report_cards (card_id, tenant_id, run_id, learner_id, card_number,
                          academic_year_id, term_id, grade_id, overall_grade,
                          total_score, max_score, percentage, "position", comment,
                          status, frozen, published_at)
SELECT 'e3000000-0000-4000-8000-000000000001', 'demo-school',
       'e4000000-0000-4000-8000-000000000001', l.learner_id, 'RC-2026-T3-001',
       'a0000000-0000-4000-8000-000000000001',
       'b0000000-0000-4000-8000-000000000003', 'G4', 'ME',
       320, 400, 80, 1, 'A steady term with strong progress in mathematics.',
       'PUBLISHED', true, TIMESTAMPTZ '2026-11-14 16:00:00+03'
  FROM learners l
 WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-001'
ON CONFLICT (card_id) DO NOTHING;
