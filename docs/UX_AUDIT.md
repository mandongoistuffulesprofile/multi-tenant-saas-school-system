# SkulApp — Page-by-Page UX / Workflow Audit (2026-10-23)

**Scope:** Lightning-run live audit of every page a *SaaS admin (multi-tenant)* → *per-school admin* touches, from login downward, on the running local system (SPA `:5173` → Go API `:8080`, tenant `smoke-school`, school admin `smoke@skulapp.test`).
**Method:** clicked through the running app in-browser; every finding was **verified in source** (frontend page file + backend router/handler), not just observed.
**Core lens:** for each page — *what exists · what's fake/broken · which backend capability is unused · what UI is missing to complete the page's logical workflow.*

---

## 0. The One-Paragraph Verdict

The backend is a **deep, production-grade multi-tenant school platform** (RLS-scoped data, finance double-entry, CBC assessment lineage, M-Pesa inbox with idempotent allocation, impersonation, NEMIS codes, offline sync). The frontend is a **read-only showroom**: most admin pages are 40–90-line GET-only tables, several are **hardcoded mockups with zero API calls**, and the most valuable write APIs the backend offers — enrolments, invoice runs, payment allocation, moderation, publishing, tenant creation — **have no UI at all**. A school admin or SaaS admin cannot complete a single end-to-end business-cycle (enrol → bell → assess → invoice → collect → report → message) through the interface.

---

## 1. Systemic Patterns (fix once, cure everywhere)

| # | Pattern | Evidence | Cure |
|---|---|---|---|
| S1 | **"Hidden backend": forms deliberately omitted** | School PATCH, Integrations POST/PUT, Calendar POST, Finance `POST invoice-runs`, `/structure/*` CRUD, Assessment/moderation writes, Reports templates/runs/publish, Comms broadcasts, Compliance writes, `/platform/*` writes | Standard **CRUD shell component** (Table + Modal Drawer Form + Delete-conflict guard + optimistic refresh), then re-skin each page on it |
| S2 | **Hardcoded fake data presented as real** | Teaching Allocation teaches (`t1 Ms. Wanjiku`), SaaS Curriculum Configurator (`v1 CBC 2024`), Learner wizard Step-3 fee checkboxes (`checked onChange={()=>{}}`), SaaSAdminDesk create-tenant (zero API calls) | Delete fake data; bind to the existing APIs |
| S3 | **Unreachable pages (orphaned routes)** | `/grades-streams`, `/teaching-allocation`, `/finance/mpesa`, `/finance/reconciliation`, `/finance/credits`, `/finance/adjustments`, `/finance/refunds`, `/comms/compose`, `/bom-oversight`, `/platform/tenants`… not in sidebar; rows don't link to profile/detail pages that exist | Sidebar IA pass + row drill-down conventions |
| S4 | **Silent persistence failures** | Learner wizard Step 2 guardian fields discarded by API; teaching-allocation assignments never saved | Every POST echoed into state consumers; contract tests between form payload & handler schema |
| S5 | **Broken empty states / seeds** | Smoke DB: 0 standard fee categories (8 exist in prod DB), 0 curriculum versions (KICD seed lives only in `migrations/archive/`), calendar/fees empty with no CTAs | Move seeds into the migration chain; every empty state gets the action that fills it |
| S6 | **Identity & enum hygiene** | Header `School Code: School` placeholder; role renders `School_admin`; funding `CUSTOM`; raw enums (`INVITE_PENDING`, SOURCE/STATUS) in tables | Locale-aware labels + badge variants |
| S7 | **No drill-down pages** | No learner profile, invoice detail(lines/payments), school member detail, register detail | Detail-drawer conventions; backend detail GETs already exist |
| S8 | **Security leakage in payload** | `GET /school/integrations/channels` returns `channel_token` plaintext to finance viewers | mask server-side |
| S9 | **Raw browser dialogs** | Compose page uses `alert("Message sent")`; confirm-delete via default dialogs | unify on the existing toast/confirm components |

---

## 2. Page-by-Page

### Persona A — Multi-tenant SaaS Admin

**`/saas-admin` (SaaSAdminDesk, 436 lines) — the console is a mockup.** Toggle-license, impersonate-school, create-tenant all fire no APIs (impersonate even just shows a Kiswahili toast). Backend has real `POST /platform/tenants` (6-field create incl. school_type/funding_mode), `PUT /tenants/:id/status`, `POST /impersonations` + `end` (with audit trail & session list), and no page calls any of them. Built the desk as a shell; the platform engine waits behind it.

**`/platform/*` SaaS suite (registry/onboard/subscriptions/integration-health/operations/impersonation) — mostly fake or read-only**; `TenantOnboardingPage` steps never save. Tenant Onboarding logical flow missing: school profile → calendar template → curriculum pin → fee seed → admin invite → **license/plan** → webhook vault keys per school.

**Backend supports; UI must be built:** tenant CRUD+status, plan CRUD, subscription upsert, exports (incl. `GET /exports/templates`), curriculum version create/publish, weighting-profile CRUD, KNEC tool CRUD, usage metering display, DPIA/retention, impersonation lifecycle.

### Persona B — School Admin (logged-in, per-tenant)

**Dashboard** — 2 stat cards (Learners, Attendance Registers), no fees/attendance-today/calendar/finance/compliance tiles, no quick actions, zero-click empty-state CTAs. Day cockpit to build.

**`/school` (School Profile)** — read-only card (Name, Subdomain, Type, Funding, County "—", Tier, Status). Backend `PATCH /school` plus additional fields (KNEC code, KEMIS code, sub_county, address, logo/stamp/head-signature refs, junior-secondary flag, locale) never surfaced. Missing tabs: Profile / Branding / Codes / Finance settings / Status.

**`/integrations`** — Payment Channels: **no create despite `POST /school/integrations/channels` supporting type (PAYBILL/TILL/BANK), shortcode, environment, default, reference format, routed fee categories, C2B-registered flag.** Finance settings: badges only, toggles exist in `PUT /finance-settings`, allowed fee categories not editable. Missing: SMS/Email provider health (Comms depends on them), M-Pesa webhook health, NEMIS sync status. `channel_token` leaks in GET.

**`/calendar`** — 3 read-only tables (Years/Terms/Exam Windows). Backend `POST` for all three unused. No "set active year/term", no holidays/deviations (schema gap too), no term close/guard. **Calendar is a hidden dependency of every other module** (year FK spans attendance/assessment/invoices) → should be a first-run gate with a Year→Terms stepper.

**`/staff`** — closest to complete: table + Add modal (email, phone, role HEAD/DEPUTY/BURSAR/CLERK/TEACHER, TSC). Gaps: **no name fields** (backend users has them), no subjects/employment-date (backend `staff_profiles` accepts), the invite is a code `TODO` with no copy/resend UI and no INVITE_PENDING badge; no role edit/deactivate (no backend routes either); row can't reach a member detail.

**`/learners`** — registry with search/filters/count; **3-step wizard: Personal (great: adm no*, UPI/NEMIS, names*, DOB, gender, status, boarding) → Guardian (phone*/email — backend drops them entirely: no handler writes `guardians`/`learner_guardians`) → Fee Categories (hardcoded fake checkboxes; backend POST accepts no fee options).** No **Enrolment step / class assignment** — the pivotal gap: `enrolments` table (learner↔class_group↔year) is joined by invoices/fees/attendance/assessment/comms/reports but **no code path in the entire repo writes it** — a learner can never belong to a class. No row actions (view/edit/transfer/ graduate), no pagination controls, "Bulk Import"/"Export" are decorative (no handlers).

**`/grades-streams` & `/teaching-allocation`** — the first is a mislabeled learners clone (title promises assignment); the second assigns fake teachers to real curriculum areas and never persists. Meanwhile `/structure/*` offers grades/streams CRUD, class-groups CRUD + **rollover**, teaching assignments create/delete — the entire class-management engine — **never referenced by any page in the app.**

**Finance (Fee Categories → Fee Structures → Invoices → Payments)** —
- *Fee Categories*: the one fully-wired CRUD page (two-section custom/standard, field-level validation, deactivate). Gaps: standard categories unseeded in this DB, delete lacks "in use" guard, `requires_consent` never consumed anywhere.
- *Fee Structures*: form demands **raw UUID text inputs for Grade ID & Academic Year ID** (needs select-or-create pickers; nothing to pick until calendar/classes exist), empty Category dropdown (seed cascade), duplicate structure guard missing, no clone-from-last-year, no per-term price overrides, learner fee-opt-in API (`/learners/:id/fee-options` upsert) has no UI.
- *Invoices*: read-only table; backend unused: `POST /invoice-runs` (term batch generation — the actual workflow), line items GET/POST, arrears report, **arrears reminders**, receipt-sequence engine, capitation receipts. 5 finance sub-pages exist but are unreachable from the sidebar (mpesa, reconciliation, credits, adjustments, refunds).
- *Payments*: read-only; missing "Record payment" (cash/cheque — bursar's daily job), **`POST /payments/allocate`** UI, receipt generation/print/SMS, STK-push trigger (`POST /mpesa/stk-requests`), M-Pesa C2B inbox status, refunds/credits surfaces.

**`/curriculum`** — correct tenant read-only philosophy, but: platform never ships the KICD seed (0 versions here; seed sits in archive), **pin** (`GET/POST /curriculum/pin`) has no UI to choose the school's authoritative version, strands/sub-strands API unviewable; SaaS counterpart page is fake data.

**`/assessment`** — two empty tables. Unused backend: event create/edit, **grading grid** (`/events/:id/grid`), batch results, reopen, **competency ratings**, **evidence capture**, learner remarks, **moderation queue + moderation** (the CBC governance story), weighting profiles (read-only even in backend — half-built). Duplicate route `/cbc-assessment` exists.

**`/reports`** — stat cards (Templates/Runs/Cards) + empty table. Unused backend: template create/update, **run** create, **publish run** (parent visibility!), per-card teacher comment, **head-teacher comment** (CBC statutory), the print page exists at `/reports/print/:id` but nothing navigates to it. No weighting UI to define term weights before a run.

**`/comms` + `/comms/compose`** — inbox-style lists (templates/messages/broadcasts/opt-outs), read-only; Compose sends **only template_id + body**, while the backend expects **channel + learner_ids/guardian_ids** → messages have no recipients and would fail/no-op silently; also `alert()` UX. Unused backend: template CRUD, broadcast create + **send** (staged campaigns!), message **retry**, opt-out handling, provider health absent (see Integrations). Without SMS provider status the whole module is a promise.

**`/compliance` (+ /breach-register, /consent-notices, /dsr-requests)** — 5 empty GET-only tables + 3 stub sub-pages. Unused backend: consent notice create/update, **record/revoke consent** (the DPDP Act 2019 core loop — parent signs → school records → reports-can-scrape), DSR request create **and update/ack/closure**, breach create/update (reportable 72h incident), retention policies, **DPIA creation, compliance summary**. No linkage between `requires_consent` fee categories ↔ consent notices.

**`/attendance`** — two empty read tables. Unused backend: register create/update, **batch mark entry**, per-register summary. Completely unsurfaced: the **Gate module** (`/gate/*`): RFID device pairing, tag issue/deactivate, gate events, gate policy, **override** — a marketable differentiator that only exists as code. Teacher-side registration views exist, but the admin has no oversight UI ("who hasn't submitted today's register").

**`/knec`** — 3 read tables (tools/submissions/exports). Backend also GET-only → **the export/generation step itself is missing server-side too** (no create/export endpoint) — a genuine backend gap, plus admin-gated KNEC tool CRUD exists at `/platform/knec/*`.

**`/platform` (per-school billing/usage)** — 4 stat sections read-only; unused backend write families (plans, subscriptions, exports). The tenant admin's "my subscription/licenses/usage" story exists only as orphaned endpoints.

**`/profile`** — the only self-service page with a working PATCH (locale switch) and logout. Missing: change password (backend has flows), phone/email, per-tenant memberships overview with ability to switch (`GET /me/memberships` + `POST /auth/tenant/switch` exist — used only by `/select-school`), notification preferences, my audit/API access.

**Portal surfaces noted en route:** `/parent/*` pages and `/teacher/*` pages exist and some are wired (teacher grading/remarks). The Parent portal cannot function until guardians persist and consents/fees tie in — see Learners/Compliance findings.

---

## 3. The Ten Workflow Blockers (ranked by business damage)

1. **Enrolment engine missing everywhere** (`enrolments` unreferencable): learners can never join classes; every class-scoped module silently breaks. *(learner wizard step + class-groups UI or nothing works)*
2. **SaaS admin console is fake / tenant onboarding cannot run**: multi-tenant business fundamentals (create school, license, impersonate for support) are unclickable despite live APIs.
3. **Guardian data dropped on learner create** → parent portal, consents, fee reminders, fees-to-parent SMS all dead downstream.
4. **Invoicing has no generation UI** (`invoice-runs`) and **payments have no allocation UI** → the money cycle cannot move.
5. **Fee Structure form unusable** (UUID typing, empty category list) → no fees ever configured, blocking everything from #4 anyway.
6. **Calendar has no create/active controls** — hidden prerequisite of invoices, attendance, assessments, KNEC.
7. **Assessment module has no write surface** — no events, no grid, no moderation → report cards and KNEC evidence never exist.
8. **Reports: no template→run→publish pipeline** — the CBC term deliverable parents care most about can't be produced.
9. **Comms can't target anyone** (recipient-less compose) and has no provider/health controls.
10. **Compliance loop can't close** (consents can't be recorded/revoked; DSRs / breaches can't be filed) — legal exposure, no CFO/RD risk owner.

*(Runners-up: staff invite hand-off has no UX; integrations' payment-channel create missing breaks M-Pesa collection end-to-end; standards/KICD seeds never ship in fresh DBs.)*

---

## 4. Suggested Build Order (smallest first)

1. **Shared primitives:** `CRUD shell` (S1), toast/confirm unification (S9), enum/badge labels (S6) — apply as you go.
2. **Money spine first (highest burn for schools):** fee-category/structure pickers ⇒ invoice-runs UI ⇒ payments + allocate ⇒ receipts; then M-Pesa channel create + inbox.
3. **Class spine:** class-group CRUD (+rollover) → learner wizard guardian/fee/enrolment steps (persisting) → attendance oversight.
4. **Academic spine:** calendar create/active → assessment events + grid + moderation → templates/runs/publish + comments → KNEC export creation (backend task).
5. **Growth/ops spine:** tenant onboarding wizard wired to `/platform/*` write APIs; staffing invite completion (resend/copy/pending badge); comms recipients + provider health; compliance ledger (consents ↔ fee categories).
6. **Polish gates:** drill-down/detail page conventions (S7), seeds in migrations (S5), token masking (S8), pagination on long lists, import/export handlers.

---


*Audit artifacts: in-browser page walk (screenshots in session), source-verified claims. Companion: `frontend/src/pages/*` (audit trail: line counts per page), `backend/cmd/api/server.go` line 200–540 (route inventory).*
