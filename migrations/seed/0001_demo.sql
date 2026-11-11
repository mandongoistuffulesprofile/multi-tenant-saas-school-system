-- Demo tenant for local development and smoke tests.
--
-- Applied only with: go run ./cmd/migrate -dir ../migrations -seed
-- No credentials are seeded. Create the demo admin after seeding with
-- cmd/devuser, which generates a password and prints it once:
--   DEV_EMAIL=admin@demo.test DEV_TENANT=demo-school DEV_ROLE=SCHOOL_ADMIN \
--     go run ./cmd/devuser
-- Change or delete this tenant before production.

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
