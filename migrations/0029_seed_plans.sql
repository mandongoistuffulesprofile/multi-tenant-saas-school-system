-- 0029_seed_plans.sql — seed the plans offered by tenant onboarding.
--
-- platform_tenant_onboarding asks the operator to choose BASIC, STANDARD or
-- ENTERPRISE. CreateTenant looks the code up in plans and silently skips
-- subscription creation when it is missing, so an empty plans table meant a
-- newly provisioned school had no subscription. Keep these codes in sync with
-- frontend/src/pages/saas/TenantOnboardingPage.tsx.

-- plan_code is the natural key used by onboarding and by the seed below;
-- the baseline never declared it unique, which broke ON CONFLICT on a fresh DB.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_plan_code ON plans (plan_code);

INSERT INTO plans (
    plan_code, name, description, price_monthly, price_yearly, currency,
    max_learners, max_staff, features, is_active
) VALUES
    (
        'BASIC', 'Basic', 'Core school records, attendance, grading and M-Pesa payments.',
        0, 0, 'KES', 500, 20,
        '{"core_attendance": true, "grading": true, "mpesa_payments": true, "email_support": true}'::jsonb,
        true
    ),
    (
        'STANDARD', 'Standard', 'Full CBC assessment, advanced fee management and board packs.',
        15000, 150000, 'KES', 2000, 100,
        '{"core_attendance": true, "grading": true, "mpesa_payments": true, "cbc_assessment": true, "advanced_fees": true, "board_pack": true, "priority_support": true}'::jsonb,
        true
    ),
    (
        'ENTERPRISE', 'Enterprise', 'Multi-campus operations, custom integrations and API access.',
        45000, 450000, 'KES', 10000, 500,
        '{"core_attendance": true, "grading": true, "mpesa_payments": true, "cbc_assessment": true, "advanced_fees": true, "board_pack": true, "multi_campus": true, "api_access": true, "dedicated_support": true}'::jsonb,
        true
    )
ON CONFLICT (plan_code) DO NOTHING;
