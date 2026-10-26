# UI/UX Gap-Fix Round — Final Consolidated Report

**Date:** 2026-10-26 · **Scope:** backend domains called by frontend GUIs + wiring every mock/orphaned page to real endpoints · **Verification:** real-persona browser audit (all four logins) + curl contract checks + DB confirmation.

---

## −1. Round 3 — Forensic M-Pesa ledger, BOM real-data rebuild, EN/SW toggle, multi-tenant platform audit

Full manifest of this round lives in `MPESA_FORENSIC_LEDGER_SPEC.md`. Summary of what shipped:

**Forensic ledger (backend `ext/ledger.js` + server webhook hook):** append-only
hash-chained `ledger_events` (HMAC-SHA256, DB-trigger forbids UPDATE/DELETE, per-tenant
`ledger_chain_state` with `FOR UPDATE`), seeded per-tenant `chart_of_accounts`
(1010/1200/2100/4100), `ledger_postings` double-entry (ingest Dr1010/Cr1200|Cr2100,
resolve Dr2100/Cr1200 posting to the **chain event** id), idempotent resolve (409 on
double), orphan suggester (ADM-normalised + Levenshtein), `GET /finance/ledger/verify`
full recompute, `/finance/board-pack` + `/verify` stamp HMAC, and
`POST /finance/mpesa/simulate-webhook` for on-demand orphan QA. Historical
`fee_payments` backfilled per-tenant strictly (a cross-tenant bleed variant was caught
and fixed during QA); seed suspense receipt only for tenants with real M-Pesa activity.
Live webhook (`reconcileDarajaPayment`) now feeds the forensic pipeline post-commit.

**M-Pesa page rebuild:** gateway diagnostics bar (last-webhook age / STK queue /
allocated % — all derived, no fabricated latencies), hash-chain integrity badge,
suspense drawer with suggested match + one-click reconcile, forensic slide-over
(crypto header, canonical double-entry table, chain of custody, copy-proof),
Simulate Webhook, density toggle, `?focus=<trans_id>` deep-link.

**Board pack page** (`/finance/board-pack`): letterhead, real eight-line account
summary, verification code + re-verify, native print-to-PDF (print CSS).

**Chrome:** global `.financial-data` (tnum/zero/tabular), `.enterprise-card`
(hairline/6px/no-shadow); **EN/SW toggle button** in header (persisted
`app_lang`, section labels swap: Watu/Fedha/Elimu na Masomo/…); **⌘K palette**
(`receipt:`, `learner:`, page search); live sidebar badges.

**BOM Oversight:** rebuilt real-only — all computable stats carry their source
endpoint; gender-parity and capitation-split blocks removed with an honest
"not tracked yet" note instead of fabricated figures.

**Multi-tenant platform audit (browser-verified):**
- SaaSAdminDesk was a hardcoded 3-fake-school demo → live tenants/staff/MRR from
  real plan pricing; fake "99.8% uptime" removed.
- "Login As" was a fake toast → real impersonation: reason prompt (to Platform
  Audit), `imp:true` tenant-scoped JWT, AUDIT SESSION banner + one-click Exit
  restoring the platform session; suspended tenants refused (403 verified).
- Onboarding wizard → real `POST /platform/tenants` (tenant + school-admin login,
  one-time temp password surfaced in toast). Verified 201 E2E.
- Subscriptions page: raw tenant UUID column → joined school name + subdomain.
- Status toggle wired to `PUT /platform/tenants/:id/status` (ACTIVE/SUSPENDED).

---

## 0. Round 2 — Full school-admin UI/UX audit (Dashboard → Profile) + grouped sidebar

Persona demo walkthrough of all 24 pages, checking each against its expected workflow. Findings → fixes, all browser-verified end-to-end.

### Findings and fixes (per page)

| Page | Finding | Fix | Verified |
|---|---|---|---|
| `/dashboard` | Main area nearly empty for admin: role gate excluded `ADMIN`, and content was 2 thin KPIs. | Rewrote `DashboardPage`: role gate now includes ADMIN; 4 real KPIs (Learners 4, Staff 6, Outstanding **KES 6,700**, Collected **KES 6,000**), "Today at a glance" (payments today 2, open assessment events, registers), quick actions (Add Learner / Generate Invoice / Record Payment / Attendance), Recent activity fed by `/compliance/access-logs`. Parent + SaaS variants preserved. | ✅ |
| Sidebar | 23 flat items = tiring, unintuitive. | Grouped collapsible sections with counts + chevrons; active section auto-expands on route change; standalone top (Dashboard) and bottom (Profile) items. Sections: **People** (Learners, Grades & Streams, Teaching Allocation, Staff) · **Finance** (Invoices, Payments, Fee Categories, Fee Structures, M-Pesa Ledger, Reconciliation) · **Academics** (Calendar, Curriculum, Assessment, Reports, Attendance) · **Outreach & Compliance** (Comms, Compliance, KNEC, BOM Oversight) · **System** (School, Integrations, Platform). `parent_portal`/`saas_admin` are role-gated top utility items. Labels without i18n keys render as plain English (M-Pesa Ledger, Reconciliation, BOM Oversight, Parent Portal, SaaS Console). Distinct icons for Grades & Streams 🎓, Teaching Allocation 🧑‍🏫, Curriculum 📖, BOM 📋. | ✅ admin + teacher + parent menus checked |
| `/finance/payments` | "Record Payment" handler existed but **no button/modal was ever rendered** — admin could not record cash payments; learner column showed raw UUIDs. | Built Record Payment modal (learner select with names, amount, method CASH/BANK/CHEQUE/MPESA, reference) → `POST /finance/payments`; learner names resolved from `/learners`. | ✅ **PAY-MVOOFKZ7315 · Faith Wanjiku (ADM-103) · CASH · KES 500 · COMPLETED** created through UI, toast + list refresh + DB row |
| `/calendar` | `handleAddTerm` dead; no Add Term button despite `POST /calendar/terms` existing. | Rendered Add Term button + modal (year select, term name). | ✅ **"Term added to calendar!"** toast; new row appears in terms table |
| `/assessment` | No event-creation UI; results showed raw UUID learners and raw ISO dates. | "New Assessment Event" button + modal (title, grade, learning area from `/curriculum/areas`, type FORMATIVE/SUMMATIVE, mode RUBRIC/NUMERIC, window) → `POST /assessment/events`. Learner names + human dates in results. | ✅ Event created (Grade 4 · LA-MAT · FORMATIVE · RUBRIC · OPEN); results show **"Achieng Otieno (ADM-101) … Oct 27, 2026"** |
| `/grades-streams` | Page says "Assign learners to grades and streams" but had **zero assignment controls** (streams "—" everywhere); hard-coded stream constants; no `PATCH /learners`. | Inline Grade/Stream selects per row → new `PATCH /learners/:id` (guarded ADMIN_ROLES, audit `STUDENT_UPDATE`); added `GET /structure/streams`; `/learners` now returns `stream`/`stream_name`. | ✅ David Mutua → **West** saved via UI: toast, select persists, DB `stream='West'`, 2 audit rows |
| `/curriculum` | Opened on a misleading empty state: auto-selects first version by `effective_from DESC` = CBC 2024 (Published), which owns **0 learning areas** (all 9 belong to the DRAFT version). | Auto-select the version owning the most areas (via unfiltered `/curriculum/areas`, which now also returns `version_id`). | ✅ Landing shows **9 learning areas** (LA-ENG…LA-SS) |
| `/reports` | `handleGenerateRun` existed, no Generate button rendered. | "Generate Report Cards" button wired to the existing handler with busy state. | ✅ Button renders + click path |
| `/comms` | No entry into Compose (`/comms/compose` existed but was unreachable). | "Compose Message" header button. | ✅ |
| `/attendance` | Read-only, raw ISO dates, marks fetched but never displayed. | KPIs + registers table with formatted dates ("Mon, Oct 26, 2026"), marks table now rendered (learner name, class, session, status, marked date), "Take / Mark Attendance" entry to the teacher register. | ✅ **Achieng Otieno PRESENT / Brian Kiprop ABSENT** rows |
| `/integrations` | Read-only page reading the **wrong response contract** — showed a false "Tuition Invoicing Disabled" while backend returns `{paybill, invoice_prefix, stk_enabled, late_fee}`. | Rewrote to the real contract: channel cards with health badges ("M-Pesa STK Push · PAYMENTS · DARAJA · healthy"), paybill input + Save, STK toggle → `PATCH /school/finance-settings`. | ✅ Toggle off→on + back with "Finance settings saved"; paybill 522522 persisted (curl-confirmed). *Bug found here:* partial PATCH died on `NOT NULL stk_enabled` — fixed with COALESCE defaults in the upsert |
| `/knec` | **27 rows / 3 distinct tools** — the seed's `ON CONFLICT DO NOTHING` had no unique target, so every restart duplicated the 3 tools. | Schema now dedupes (`DELETE USING`), adds unique index `uq_knec_tools_code`, and seeds with `ON CONFLICT (tool_code) DO NOTHING`. | ✅ 3 rows: ADM-SLR / KAP-EXP / REG-PL |
| Role-gated regressions | i18n `t()` does not honor `defaultMessage` → raw keys leaked in new code (NAV_PEOPLE, QUICK_ACTIONS…) and a stale apostrophe bug in "children's"/"learner's" strings. | All `t(key, {defaultMessage})` replaced with plain English across ~13 pages; apostrophes escaped. | ✅ Sections now read "People / Finance / Academics / Outreach & Compliance / System" |

### Backend (Round 2, additive)
- `backend/src/ext/people.js`: `GET /structure/streams`, `PATCH /learners/:id` (grade_level/stream/status/guardian fields, ADMIN_ROLES guard + audit), `version_id` on `/curriculum/areas`, finance-settings upsert COALESCE fix.
- `backend/src/server.js`: `/learners` SELECTs + maps `stream`, correct `guardian_phone` mapping.
- `backend/src/ext/schema.js`: knec_tools dedupe + `uq_knec_tools_code` + idempotent seed.

**Deliberately left as demo** (unchanged from Round 1, §6): BOM Oversight content and the showcase wrappers — their domains are real via the wired pages.

---

## 1. What was built (backend, all additive in `backend/src/ext/`)

Installed via `installExtApi(app, deps)` in `ext_api.js` (called in `server.js` before listen). Schema bootstrap logs `[Ext API] schema ready`; failed bootstraps are retryable, never cached-forever.

| Module | Domains |
|---|---|
| `finance.js` | invoices lifecycle, payments (KES, PARTIALLY_PAID/PAID), fee_balances recompute, M-Pesa STK requests + transaction ledger, reconciliation feed, parent child-scoping |
| `academic.js` | attendance, assessment events, results single+batch (`/assessment/results/batch` page contract **and** offline-per-item keys), CBC LWW upsert into `cbc_assessments` (EE/ME/AE/BE → 4/3/2/1) |
| `people.js` | staff CRUD (roles incl. BURSAR, one-time temp passwords, 409 on dupes), school profile/settings, curriculum versions/areas, `POST /structure/teaching-allocations` |
| `compliance.js` | comms messages/templates, notices (+ `/notices/parent`), consent records + toggle, KNEC, access-logs, DSR, breach-register |
| `platform_ext.js` | platform audit log, derived integration health (STK queue depth, callback lag, unconfigured vs healthy), tenant registry, exports, **reports: templates / runs GET+POST / cards / card comments (LearnerRemarks contract `remarks:[{learner_id, remark}]`) — parent sees only their children's cards** |
| `calendar.js`, `auth_ext.js`, `context.js`, `schema.js`, `parent.js` | terms, password reset flow, OTP-by-phone, parent activate, tenant switch returning full token_pair, `/me/linked-learners`, PATCH `/me` |

Writes emit `audit_log` rows; validation errors use `{ message, field_errors: [{field,message}] }`; money stays in step with the `fee_balances` generated column; M-Pesa STK rows are stored PENDING (real Safaricom callback = documented integration point).

## 2. Frontend wiring delivered (14 files, all compile clean through Vite)

- 5 parent pages: `/parent` (real children via `/me/linked-learners`), `/parent/fees` (real invoices + **live STK push with phone input and honest status copy**), `/parent/attendance`, `/parent/notices`, `/parent/consents` (toggle + toast), `/parent/receipts` (mapped from `/finance/payments`).
- SaaS platform: `PlatformAuditPage → /platform/audit`, `IntegrationHealthPage → /platform/integrations` (styled unconfigured state), `OperationsCentrePage` (derived KPIs + health table), `CurriculumConfiguratorPage → /curriculum/versions`, `TenantRegistryPage` (suspend confirm dialog **naming the school** + toast + refresh, with Activate inverse).
- Teacher: `GradingGridPage` ("Sync now" → `POST /assessment/results/batch`), `LearnerRemarksPage` (publish → card comment), `TeachingAllocationPage` (teachers from `GET /staff`, save → allocations table).
- `Layout.tsx`: sidebar entries for finance/mpesa, reconciliation, grades-streams, teaching-allocation, bom-oversight (real-data pages; icons).

## 3. Bugs found during the browser audit and fixed

1. **Sidebar failed role filter** — `Layout.tsx` filtered on literal role strings (`SCHOOL_ADMIN`) while the backend issues `ADMIN`, hiding every admin item. Fixed by importing the same role-group constants used by route guards (`lib/roles.ts`), so routes and sidebar can't drift again. Verified: full admin menu renders for `admin@school.co.ke`; `/bom-oversight` included.
2. **`GET /reports/runs` did not exist (404)** — `ReportsPage` used `Promise.all([templates, runs, cards])`, so one 404 rejected the batch and left **all three KPIs at 0** despite 4 cards in the DB. Added the derived runs endpoint (groups `report_cards` by `term_label` → cards_generated/cards_graded/last_run_at/COMPLETED). Verified: KPIs 1/1/4 and rows with learner names + percentages (87.5%, 75.0%).
3. **Learner columns showed raw UUIDs** — invoices and reports rows display `learner_id`. Invoices now resolve names via `GET /learners` ("Achieng Otieno (ADM-101)"); Reports now renders the `learner_name` the backend already sends.
4. **Generate Invoice had no UI** — `modalOpen` state existed but no modal was rendered, so the layout "Generate Invoice" link did nothing real. Built the modal: learner dropdown (real learners), amount, description → success toast → list refresh: **INV-2026-0002 (Faith Wanjiku, KES 1200, ISSUED) created through the UI**, confirmed in table + audit log.
5. **TeachingAllocationPage blank-screen crash** — `Button` used but never imported (`ReferenceError: Button is not defined`). One-line import fix. Then verified end-to-end: assigned Dr. Christopher Khaemba to LA-MAT → toast → row persisted in `teaching_allocations` (LA-MAT, teacher uuid, created_at 02:32:31Z).
6. **Grading grid synced 0 of N** — cell keys were `${learner_id}-${learning_area_id}` and sync did `key.split("-")[0]`, **truncating UUID learner ids at their first hyphen**, so the backend silently accepted but upserted nothing (`synced: 0` toast). API itself was fine (curl batch of the page contract returned `synced:1/201`). Fixed: key separator changed to `|` everywhere (mark, restore-from-offline, read, sync), sync now parses `lastIndexOf("|")` and passes the true sub-strand. Stale pre-fix offline entries with truncated learner ids are now filtered out of the restore path. Re-verified in browser: **"Synced 4/4 results to the server."** with marks landing in `cbc_assessments`.
7. **Session clobbering by a stale dev token (pre-existing dev-mode behavior, documented not changed)** — this browser tab held a `dev@m` admin refresh token from an earlier testing round (`sub 00000000-…-0002`, the dev-fallback dummy identity, minted by the non-production graceful fallback at `server.js` `dummyUserFor`/`/auth/refresh` fallback). On full page reloads the refresh flow re-minted dev tokens over the parent session, which looked like "portal bounced to admin dashboard". Mitigated in-audit by rewriting the persona tokens; the pattern only exists because `NODE_ENV !== 'production'` and is already gated off for production (`ALLOW_DEV_FALLBACK`, production-mode guard on line 17).

## 4. Contract-by-contract verification (browser personas)

**Parent (parent@school.co.ke / password123)**
- `/parent` — real linked children (Achieng Otieno G4, Brian Kiprop). ✅
- `/parent/fees` — real invoices; **KES 5,500 total outstanding** matches DB (8500−3000 paid). ✅ STK push create with phone input → checkout_request_id, queued PENDING. ✅
- `/parent/attendance` — real rows ("Achieng Otieno PRESENT, Grade 4 - General"). ✅
- `/parent/notices` — real notices. ✅
- `/parent/consents` — real consent rows; toggle granted→revoked→granted both directions with toast; audit `CONSENT_TOGGLE` visible in platform audit. ✅
- `/parent/receipts` — real receipt **PAY-MVOLFHQ5750 · KES 3,000 · COMPLETED · CASH**. ✅

**School admin (admin@school.co.ke / password123)**
- `/finance/invoices` — INV-2026-0001 (PARTIALLY_PAID 8500/3000/5500) + UI-created INV-2026-0002; learner names; working Generate Invoice modal + toast. ✅
- `/staff` — real directory incl. `bursar.demo@school.co.ke`, teacher, accountant. ✅
- `/reports` — KPIs 1 template / 1 run / 4 cards; cards real (DRAFT 87.5/75.0/NO_ASSESSMENTS). ✅
- `/calendar` — real terms table. ✅
- `/finance/mpesa` — real C2B transactions (RJ8MND91KE KES 1200.50, QK71H50XCT KES 1500.00). ✅
- `/finance/reconciliation` — honest "No records found" empty state (no runs recorded yet). ✅
- `/teaching-allocation` — curriculum areas (LA-ENG/KIS/MAT/SCI/SCR/AGR), save → DB row + toast. ✅
- Sidebar — full menu incl. the 5 new entries. ✅

**Platform admin (platform.admin@skulapp.test / Yna@12345)**
- `/platform/audit` — real trail incl. the **UI-created invoice CREATE row** minutes old, CONSENT_TOGGLE, IP + school code. ✅
- `/platform/integrations` — derived rows: M-Pesa STK Push / C2B Callback healthy, callback lag 999ms, queue depth 1 (the PENDING STK request). ✅
- `/platform/tenants` — tenant registry; Suspend on "Alliance High School" → confirm dialog naming the school with consequences copy → toast "Tenant suspended", row flipped to Activate; **re-activated** (demo tenant restored to ACTIVE). ✅
- `/platform/operations` — derived KPIs: 6 active tenants, 100% API success, **KES 89,400 MRR**, 0 alerts + integration health table. ✅
- `/platform/curriculum` — real versions (CBC 2025 DRAFT). ✅

**Teacher (teacher@school.co.ke / password123)**
- `/teacher/grading` — real event (FORMATIVE — LA-MAT OPEN), real learner roster; rubric marking EE/ME/BE; **Sync now → "Synced 4/4 results"** persisted server-side. ✅
- `/teacher/remarks` — learner picker, remark published → **comment persisted on RPT-MVOLM348-0, card status flipped to PUBLISHED** ("Excellent grasp of Mathematics this term — strong reasoning. Keep it up!"). ✅

**Core regression:** `POST /assessments/cbc/bulk-sync`, impersonation, invoice→payment→balance lifecycle, staff 409-on-dupe, fee-category CRUD, calendar term POST, comms POST, consent toggle, password reset cycle, OTP by phone, parent activate, PATCH /me, tenant/switch token_pair — all still pass after this round's backend additions.

## 5. Real vendor integration points (deliberately staged, not faked)

- **M-Pesa (Safaricom Daraja):** STK pushes are created and stored (`mpesa_stk_requests`, PENDING + checkout_request_id); the documented landing point for the real Safaricom C2B confirmation is `POST /payments/daraja/callback` / `/mpesa/callback` (routed in `server.js`), which flips payment status and recomputes balances. No call-out sandbox credentials were configured, so the pages show honest "PENDING/queued" states instead of fabricated completions.
- **SMS:** comms messages persist (`communications`) and would be dispatched by an SMS provider worker (Africa's Talking/Twilio pattern) — no `unconfigured` faking; delivery status stays queued.
- **OTP:** `/auth/otp/request` stores a real hashed code with expiry; delivery to phone/email requires the same provider channel.

## 6. Deliberate demo-showcase exclusions

These pages remain demos by design (they exercise visual polish only): `BOMOversight`, `FeesDesk`, `StudentsDesk`, `SaaSAdminDesk`, the `CBCAssessment` wrapper showcase, and `ReportCardPrint`. Their underlying domains (attendance, invoices, cards) are all real — the showcase pages simulate workflows that are already available through the wired pages above.

## 7. Changed files (this round)

- Backend: `backend/src/ext/platform_ext.js` (+ `GET /reports/runs`).
- Frontend: `pages/FinanceInvoicesPage.tsx` (learner resolver + invoice modal), `pages/ReportsPage.tsx` (learner_name render), `pages/TeachingAllocationPage.tsx` (Button import), `pages/teacher/GradingGridPage.tsx` (`|` key syntax + stale-row filter), `components/organisms/Layout.tsx` (role-group sidebar).
- Workspace state: restart pattern `fuser -k 8080/tcp` + `node backend/src/server.js` (ext code is cached per-process; restart invalidates it). DB 5433 (`school_saas_production`), tokens cached in `/tmp/opencode/tokens.env` (PA/TA/PT) + `/tmp/opencode/TT.env` (teacher).
