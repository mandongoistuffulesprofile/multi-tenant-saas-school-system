# Super Admin Fresh School Setup Workflow (Global Platform-Only)

## Goal
Enable a global platform-only Super Admin (`SAAS_ADMIN`/`SUPER_ADMIN`, no standing `tenant_memberships`) to fully provision and perform initial setup of a new school (profile, first School Admin handoff, academic structure/terms, baseline finance setup, optional seed staff/learners) so a human can manually simulate end-to-end onboarding; first School Admin can later customize everything.

## Locked decisions / assumptions
- **Identity model:** Super Admin is platform-scoped only. No automatic or persistent school membership is created for SA during setup.
- **Setup mechanism (recommended):** implement **dedicated SA-authorized, tenant-targeted platform provisioning APIs** that execute writes inside explicit tenant transactions (`set_config('app.current_tenant_id', ...)`) with full audit attribution (`actor=platform_admin`, `target_tenant_id`). This is preferred over write-capable impersonation for correctness and least privilege.
- **Impersonation:** keep/support as optional read/verify aid only (time-boxed, audited). Do not rely on it for core provisioning unless explicitly extended and approved.
- **Idempotency/resume:** each setup step must be safely retryable and resumable by `tenant_id` (draft/progress persisted server-side) to support manual simulation and partial completion.
- **Out of scope (unless discovered required):** billing/payment-gateway live integrations beyond configuration records, SMS delivery guarantees in non-dev env, full KNEC/curriculum content authoring beyond selecting/pinning existing platform reference data.

## Current-state anchors (relevant)
- Auth/RBAC: platform roles in `backend/internal/middleware/roles.go`; platform routes guarded by `RolePlatformAdministrators` in `backend/cmd/api/server.go:542-570`; login redirects SA to `/platform/operations` (`frontend/src/pages/LoginPage.tsx`).
- Tenant provisioning: `POST /platform/tenants` creates school + first `SCHOOL_ADMIN` membership + temp password + default finance settings in `backend/internal/platform/write.go:62-191`; UI `frontend/src/pages/saas/TenantOnboardingPage.tsx`.
- Tenant context/RLS: request-scoped tenant context/tx middleware in `backend/cmd/api/server.go:178-201` and `backend/internal/middleware/*`; tenant-setting pattern used in platform create tx (`set_config('app.current_tenant_id',...)`).
- Setup primitives exist tenant-side: school/profile, structure/grades-streams/class-groups, calendar years/terms, staff, learners, finance fee categories/structures/channels/settings, wizard state (`migrations/0017_wizard_state.sql`, `backend/internal/wizard/*`).
- SaaS UI shell/pages: `frontend/src/pages/saas/*`, `SaaSLayout`.

## Proposed end-to-end workflow (manual simulation)
1. **SA login** → Platform Operations (`/platform/operations`).
2. **Create School (provision)**: enter school identity + license/funding/county + first School Admin identity/contact; system creates tenant, default finance settings, optional plan/subscription, first `SCHOOL_ADMIN` user+membership+temporary password, and an onboarding draft in `PENDING_SETUP`.
3. **Guided Initial Setup (SA, per-tenant)** — ordered, resumable steps with validation and progress:
   - **School profile completion:** NEMIS/KEMIS, contacts/address, branding refs as available.
   - **Academic structure:** confirm grades, create streams/class groups for target year; optionally apply defaults by school type.
   - **Calendar:** create academic year + terms (and exam windows if needed) and mark current.
   - **Finance baseline:** fee categories (global/custom), fee structures per grade/term, payment channels (e.g. M-Pesa paybill/till/bank placeholders as configured), finance settings; sanity checks for required fields.
   - **Optional seeds:** staff users/roles, sample learners/enrolments/class assignments (clearly labeled/demo-safe option).
4. **Review & readiness check:** automated checklist (admin created, active year/term, structure exists, finance baseline valid); show blockers/warnings.
5. **Handoff:** present first School Admin credentials/invite instructions, mark setup `READY_FOR_HANDOFF`/`HANDED_OFF`; SA can suspend/reactivate tenant but does not retain school role.
6. **School Admin login** → school dashboard; can edit all seeded data via existing school-scoped flows.

## Implementation plan (ordered)

### 1) Domain & data model for onboarding orchestration
- Introduce/extend a **platform onboarding record** keyed by `tenant_id` (and version) to track: step status, draft payload refs, readiness checklist results, actor/timestamps, handoff state. Prefer reusing/aligning with `wizard_state` semantics where compatible or add a dedicated `platform_onboarding`/`tenant_onboarding_state` migration; ensure schema supports `SUPER_ADMIN` actor without tenant membership.
- Define canonical step enum and idempotency keys per step (so re-submit updates instead of duplicating).
- Add audit events for every mutating platform setup action and for handoff/credential issuance metadata (never log secrets).

### 2) Backend: platform provisioning/setup APIs (SA-only, tenant-targeted)
- **Refactor/extend tenant creation** (`backend/internal/platform/write.go` / service layer):
  - Make creation idempotent for retry where safe (or return conflict with existing state), normalize/validate `subdomain`/codes, ensure atomic tx, keep temp-password generation secure (one-time display) and avoid duplicate `set_config`/RLS pitfalls.
  - Initialize onboarding draft/progress record on success.
- **Add SA-only setup endpoints** under `/api/v1/platform/tenants/:tenant_id/setup/...` (or equivalent) guarded by `RequireAuthGin` + `RolePlatformAdministrators`:
  - `GET /setup` (progress + checklist), `PATCH /setup/profile`, `POST /setup/structure/*` (streams/class-groups, optional defaults), `POST /setup/calendar/*` (year/terms/exam windows), `POST /setup/finance/*` (categories/structures/channels/settings), `POST /setup/seeds/*` (staff/learners optional), `POST /setup/complete` (readiness gate + handoff state).
- **Execution model:** each handler resolves/validates target tenant exists and is not in a blocked state, runs in an explicit tenant-scoped tx (`db.WithTenant`/`BeginTenantTx` or `set_config` on tx) and reuses existing domain services/validation where possible to avoid divergent business logic.
- **RBAC/tenancy invariants:** do not insert SA into `tenant_memberships`; do not mint tenant-scoped user JWTs for SA except via existing audited impersonation flow if used for verification; ensure handlers cannot be called without platform role.
- **Readiness validator:** server-side checks produce structured blockers/warnings (e.g. missing current term, no class groups, no active fee structure when tuition enabled).

### 3) Backend: reuse/domain hardening for setup correctness
- Reuse `school`, `structure`, `calendar`, `staff`, `learner`, `finance` services/handlers logic; extract shared operations if needed so platform setup and school-admin flows enforce identical constraints.
- Ensure finance/structure/calendar uniqueness and FK assumptions hold for fresh tenants (no orphan refs, correct `tenant_id` scoping).
- Confirm credential handoff behavior (temp password/forced reset flow) aligns with existing auth (`/auth/password/reset/*`, invite/activate patterns) and document expected first-login path.

### 4) Frontend: Super Admin onboarding UX (guided, resumable)
- **Tenant creation:** evolve `frontend/src/pages/saas/TenantOnboardingPage.tsx` into/alongside a multi-step flow that captures required provisioning inputs and routes to per-tenant setup on success.
- **Per-tenant Setup workspace:** add a dedicated SaaS page/route (e.g. `/platform/tenants/:id/setup` or `/platform/onboard/:tenantId`) in `frontend/src/App.tsx` + `frontend/src/components/organisms/SaaSLayout.tsx` showing:
  - stepper/progress, saved draft state, per-step forms backed by new platform setup APIs, inline validation/errors, and readiness checklist/handoff panel.
- **Tenant registry integration:** update `frontend/src/pages/saas/TenantRegistryPage.tsx` to surface setup status and “Continue setup / View readiness / Handoff” actions.
- **UX components:** reuse existing atoms/organisms (forms, tables, toasts, view states); clearly label optional seed data and destructive/locking actions (suspend) with confirmations.
- **Auth/client:** extend `frontend/src/lib/api.ts` usage/types as needed; keep all setup calls under `/platform/*` with SA session only.

### 5) Authorization, audit, and safety controls
- Enforce platform-only access at route and UI guard levels; ensure 403/tenant-mismatch paths are explicit.
- Emit structured audit records (who, target tenant, action, before/after summary, request/correlation id) for create, each setup mutation, readiness evaluation, and handoff.
- Protect secrets: show temp credentials once, support copy, never persist plaintext beyond immediate response/logs.
- Rate-limit/validate inputs consistent with existing middleware patterns.

### 6) Migration & rollout
- Add forward-only DB migration(s) for onboarding state/progress (and any supporting indexes/constraints); keep compatible with PostgreSQL 18 and current RLS/ownership model (do not enable FORCE RLS changes).
- Backfill/default: existing tenants treated as `LEGACY/COMPLETE` or `UNKNOWN` without blocking; new tenants start in onboarding flow.
- Deploy order: migration → backend → frontend. Feature can be guarded by a config/flag if desired; rollback is app-level (disable new UI/routes) since migrations are forward-only.

## Data flow (high level)
- SA SPA (`/platform/*`, bearer token, platform roles) → `/api/v1/platform/tenants*` handlers → validate platform RBAC → resolve target tenant → open tx + set tenant context for tenant-scoped tables → invoke domain services/writes → append audit/onboarding progress → commit → return step state/readiness.
- No persistent SA↔tenant membership; tenant-scoped runtime context is explicit and per-request/tx only.

## Failure modes & handling
- **Partial failure mid-step:** tx rollback; client can retry; idempotency keys/upserts prevent duplicates.
- **Conflict/uniqueness (subdomain, codes, duplicates):** return actionable 409/validation errors; UI preserves draft.
- **RLS/tenant-context errors:** fail closed with clear error; never fall back to cross-tenant/global writes for tenant data.
- **Redis/infra degradation:** respect existing fail-closed/fail-open behaviors per middleware; provisioning endpoints must surface dependency readiness issues.
- **Credential exposure risk:** one-time display, no logging, encourage immediate reset/handoff.
- **Blocked readiness:** prevent `complete/handoff` until blockers resolved; allow warnings with explicit acknowledgement if policy permits.

## Validation / acceptance (manual simulation by human)
- **Auth/RBAC:** SA (`SAAS_ADMIN`/`SUPER_ADMIN`) can access setup flow; non-platform roles receive 403/redirect; SA has no `tenant_memberships` rows created by flow.
- **E2E happy path:** create school → complete profile/structure/calendar/finance (+ optional seeds) → readiness passes → handoff shown → School Admin logs in with issued credentials and sees seeded/configured state; can modify it.
- **Resume/idempotency:** interrupt mid-flow, re-login, continue from saved progress without duplicate entities.
- **Negative cases:** duplicate subdomain, missing required fields, invalid finance/term setup, suspended target tenant behavior, retry after transient failure.
- **Auditability:** each step recorded with actor and target tenant; no secrets in logs.
- **Regression:** existing school-admin self-setup flows and tenant isolation tests remain passing (`go test ./...`, frontend build; targeted tenant RLS test where env available).

## Open questions (non-blocking, can be finalized during implementation)
- **Impersonation write scope:** keep read-only vs add tightly scoped “support write” mode for exceptional fixes (recommend: defer; use provisioning APIs). 
- **Seed templates:** minimal generic seeds vs Kenya/CBC-specific defaults (grades/terms/fee presets) sourced from existing reference data.
- **Credential delivery:** display-only temp password vs invite/reset link flow (recommend: align with existing invite/reset mechanisms and show once).