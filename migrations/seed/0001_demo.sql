-- Demo tenant for local development and smoke tests.
--
-- Applied only with: go run ./cmd/migrate -dir ../migrations -seed
-- Credentials: admin@demo.test / DemoPass123!
-- Change or delete this tenant before production.

INSERT INTO schools (tenant_id, school_name, subdomain, school_type, funding_mode, status, license_tier)
VALUES ('demo-school', 'Demo Primary School', 'demo', 'PRIMARY', 'PRIVATE', 'ACTIVE', 'STANDARD')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO users (email, phone_number, password_hash, status, first_name, last_name)
SELECT 'admin@demo.test', '254700000001',
       '9c2191f0b9cf012708ca9cce93830b4a:204649bd75cbbb34011ec95c6b5a4f9cf1f81cb37064733d22603345c531ed5d',
       'ACTIVE', 'Demo', 'Admin'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@demo.test');

INSERT INTO tenant_memberships (user_id, tenant_id, role, status)
SELECT u.user_id, 'demo-school', 'SCHOOL_ADMIN', 'ACTIVE'
FROM users u
WHERE u.email = 'admin@demo.test'
ON CONFLICT (user_id, tenant_id) DO NOTHING;

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
