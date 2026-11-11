-- Demo tenant for local development and smoke tests.
--
-- Applied only with: go run ./cmd/migrate -dir ../migrations -seed
-- No credentials are seeded. Create the demo admin after seeding with
-- cmd/devuser, which generates a password and prints it once:
--   DEV_EMAIL=admin@demo.test DEV_TENANT=demo-school DEV_ROLE=SCHOOL_ADMIN \
--     go run ./cmd/devuser
-- Change or delete this tenant before production.

-- RLS-aware tables require app.current_tenant_id to be set before writes.
SELECT set_config('app.current_tenant_id', 'demo-school', true);

INSERT INTO schools (tenant_id, school_name, subdomain, school_type, funding_mode, status, license_tier)
VALUES ('demo-school', 'Demo Primary School', 'demo', 'PRIMARY', 'PRIVATE', 'ACTIVE', 'STANDARD')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO learners (tenant_id, admission_number, first_name, last_name, gender, status)
VALUES ('demo-school', 'DEMO-001', 'Amina', 'Wanjiku', 'FEMALE', 'ACTIVE')
ON CONFLICT (tenant_id, admission_number) DO NOTHING;

INSERT INTO guardians (tenant_id, first_name, last_name, phone_number)
SELECT 'demo-school', 'Grace', 'Wanjiku', '254700000003'
WHERE NOT EXISTS (
    SELECT 1 FROM guardians WHERE tenant_id = 'demo-school' AND phone_number = '254700000003'
);

INSERT INTO learner_guardians (learner_id, guardian_id, relationship, is_primary_payer)
SELECT l.learner_id, g.guardian_id, 'MOTHER', true
FROM learners l, guardians g
WHERE l.tenant_id = 'demo-school' AND l.admission_number = 'DEMO-001'
  AND g.tenant_id = 'demo-school' AND g.phone_number = '254700000003'
  AND NOT EXISTS (
    SELECT 1 FROM learner_guardians lg
    WHERE lg.learner_id = l.learner_id AND lg.guardian_id = g.guardian_id
  );

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
