# Shule Yetu — Master Implementation Plan

**Source:** Consolidated from audit sessions PROMPT1–5 and related sessions (see Section 1).
**Audience:** Implementing model (OpenCode / DeepSeek Flash).
**Status:** Plan only — NO code changes to be made by this document. The implementing model executes the tasks listed herein.
**File:** `docs/audit/MASTER_IMPLEMENTATION_PLAN.md` (only editable file; no source/migration/config/test modifications)

---

## 0. Executive Summary

This plan consolidates findings from six audit sessions covering the Shule Yetu multi-tenant SaaS school system (Go 1.26/Gin + PostgreSQL 18 + Redis + React 18/TS/Vite). The codebase is substantially hardened in finance (FSM, allocation worker), assessment (FSM), grading (4-band + 8-point CBC scales), and reports (immutable snapshots). Remaining gaps cluster in: tenant spoofing via `X-Tenant-ID` header fallback, residual `float64` money fields, M-Pesa two-inbox divergence, missing teaching-assignment scope on result writes, synchronous report generation, and offline/sync queue correctness.

The plan is organized as:
- **Section 1** — Source sessions & provenance (traceability).
- **Section 2** — Domain inventory (all modules with current state).
- **Section 3** — Cross-cutting foundations (must be done first; block everything else).
- **Section 4** — Task inventory with global IDs `<MODULE>-<SESSION-ID>`.
- **Section 5** — Dependency graph & global execution order.
- **Section 6** — Module-by-module implementation plans.
- **Section 7** — Migration plan (constraints, backfills, no new migrations unless noted).
- **Section 8** — Verification & testing strategy.
- **Section 9** — DECISION-NEEDED list (items requiring user/architect input).
- **Section 10** — Coverage matrix (every audit finding mapped to a task).

---

## 1. Source Sessions & Provenance

| Session ID | Title / Focus | Recovered? | Key Output Location |
|---|---|---|---|
| `ses_e2745c2dfffe3ROVWjMBWrT9pz` | PROMPT1 — Market/competitor landscape analysis | NO | `.kilo/plans/1794637446432-market-product-map.md` (EMPTY, 0 lines — findings unrecovered) |
| `ses_e272dbfacffetW7OKpJ4IMdKhO` | PROMPT2 — Timetable module audit | YES | `.kilo/plans/1794639020115-timetable-module-audit.md` (263 lines) |
| `ses_e272cec51ffee8zSxwpLqWvrQl` | PROMPT3 — Fees/ledger/payments audit | YES | claims A1–A4, B1–B4, C1–C4 (in plan file) |
| `ses_e272c57a8ffennLHIqSAWrtv6v` | PROMPT4 — Admissions/learner registry audit | YES | incl. section 6 "Could not verify" |
| `ses_e272bf0e1ffeiV28Kk70xSTXDO` | PROMPT5 — Assessment/marks/report card audit | YES | claims A1–A2, B1–B4, C1–C2 |
| `ses_e3147eef0ffeM3INA7UlRhNNQ7` | Production audit & hardening | YES | P0 tenant spoofing, error boundary, 401 refresh loop, M-Pesa STK polling leak |
| `ses_e882afe18ffek6w5jGdBGWEKHw` | Security & Architecture Audit | YES | BACKEND_GUIDANCE.md findings F1–F14; 6 Critical Production Invariants matrix; second-zip audit |
| `ses_e312c20d6ffe1DwStCmhJVniUo` | Tenant customization audit | YES | migration `0035_tenant_customization.sql` |
| `ses_e2ac1978effe18bTFK372grH6b` | "wtf" implemented-vs-stubbed inventory | YES | partial |
| `ses_e361b17dfffeR5lYo1n0yMZMAk` | References production-readiness audit | NO | references `ses_e38534b8fffeeG5U0VS2BsU4mK` |
| `ses_e38534b8fffeeG5U0VS2BsU4mK` | Production-readiness audit | NO | referenced only |
| `ses_e87d20012ffe7LmqgM7PO7pQKG` | Request-scoped tenant transactions | YES | partial |
| `ses_e88d11d0affeZ032OZ7JdHUJ8m` | Login tracking | NO | likely not relevant |

**PROMPT1 is unrecovered** (empty plan file). Market/competitor findings are excluded from this technical plan; a placeholder task is created in Section 4 to re-run PROMPT1 if product context is needed.

**Duplicate migration number:** `0031` exists twice (`0031_auth_lookup_function.sql` and `0031_mpesa_ledger_hardening.sql`). Both confirmed applied. No action required beyond documentation in Section 7.

---

## 2. Domain Inventory

| Module | Current State | Hardened? | Key Files |
|---|---|---|---|
| **Auth** | JWT (15min access / 30day refresh), Redis rate limiting, OTP, password reset, tenant switch, parent activate, invite accept | Partial | `backend/internal/auth/*`, `backend/cmd/api/server.go:457-479` |
| **Tenancy** | `TenantContextMiddleware` verifies bearer JWT; `X-Tenant-ID` header fallback still exists on public routes | NO (spoofing risk) | `backend/internal/middleware/tenant.go`, `server.go:289` |
| **Learners / Admissions** | Create/List/Get/Update/Terminate; valid residence/transport/SNE; unique `(tenant_id, admission_number)` via migration 0040 | YES | `backend/internal/learner/service.go`, `migrations/0040_learner_admission_unique.sql` |
| **Academic** | Years, terms, exam windows, rollover with dry-run/apply, audit on apply | YES | `backend/internal/academic/rollover.go`, `server.go:557-566` |
| **Curriculum** | CBC versions, areas, strands, sub-strands, tenant pin, tenant areas | YES | `backend/internal/curriculum/*`, `server.go:589-608` |
| **Assessment** | FSM (DRAFT/SUBMITTED/MODERATED/PUBLISHED/LOCKED), idempotent on client_uuid, `float64` Points/RawScore/MaxScore | Partial | `backend/internal/assessment/assessment_fsm.go`, `write.go`, `server.go:620-642` |
| **Reports** | Templates, runs, cards, revisions, comments, immutable snapshots (snapshot.go), sync publish | Partial | `backend/internal/reports/*`, `server.go:744-766` |
| **Grading** | 4-band + 8-point CBC scales, tenant cutoffs, validate, load/save config | YES | `backend/internal/grading/scale.go`, `server.go:736-742` |
| **Finance** | Invoice FSM, allocation worker (FOR UPDATE SKIP LOCKED), M-Pesa inbox, payment ledger (append-only), receipt sequences | Partial | `backend/internal/finance/*`, `migrations/0031-0032-0038` |
| **MPesa / Daraja** | C2B/STK callbacks, durable inbox, two-inbox divergence (raw_inbox vs inbox), STK pusher, float64 Amount | NO | `backend/internal/finance/mpesa_handler.go`, `mpesa_events.go`, `backend/internal/daraja/*` |
| **Comms** | Templates, messages, broadcasts, opt-outs, outbox worker | YES | `backend/internal/comms/*`, `server.go:768-786` |
| **Compliance** | Consent notices/records, access logs, DSR, breach register | YES | `backend/internal/compliance/*`, `server.go:788-800+` |
| **Platform** | SAAS admin, subscriptions, tenant onboarding | Partial | `backend/internal/platform/*` |
| **Offline / PWA** | IndexedDB per tenant, sync queue, cache collection, device id | YES | `frontend/src/lib/offline.ts`, `api.ts` |
| **Kitchen / InkInd / ValueLedger / OpeningBalance / HoldingTank** | Secondary modules, role-protected | YES | `server.go:507-566, 533-554` |
| **Structure** | (referenced in Phase 2 TODO) | — | `backend/internal/structure/*` |

---

## 3. Cross-Cutting Foundations (Block Everything Else)

These tasks must be completed before any module-specific work, because they establish the security and correctness boundary that all other tasks depend on.

**F1 — Eliminate tenant spoofing via `X-Tenant-ID` header fallback.**
- `backend/internal/middleware/tenant.go`: `TenantContextMiddleware` accepts `X-Tenant-ID` header fallback for public routes. Remove header-based tenant resolution entirely; tenant must come only from the verified bearer JWT.
- Global ID: `TENANCY-ses_e3147eef0ffeM3INA7UlRhNNQ7-01`
- Severity: P0 (Critical). Blocker for all tenant-scoped operations.

**F2 — Resolve `float64` money residual fields.**
- `backend/internal/finance/write.go`: `feeLineDraft`/`invoiceDraft` still `float64`.
- `backend/internal/finance/mpesa_events.go`: `MPESAEvent.Amount` still `float64`.
- `backend/internal/mpesa/inbox_fsm.go`: `InboxContext.Amount` still `float64`.
- `backend/internal/assessment/write.go`: `ResultInput.Points/RawScore/MaxScore` still `float64`.
- Replace all with `shopspring/decimal` (already in go.mod).
- Global IDs: `FINANCE-ses_e882afe18ffek6w5jGdBGWEKHw-01`, `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-01`, `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-01`
- Severity: P0 (Critical). Numeric precision invariant FAIL (from Security & Architecture Audit).

**F3 — Enforce single inbox for M-Pesa callbacks.**
- `backend/internal/finance/mpesa_events.go` reads `mpesa_raw_inbox` while callback writes `mpesa_inbox` — two-inbox divergence. Consolidate to `mpesa_inbox` only; deprecate `mpesa_raw_inbox` (migration 0031 keeps it for backward compatibility, drop in future migration).
- Global ID: `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-02`
- Severity: P0 (Critical).

**F4 — Enforce receipt sequence consumption.**
- `backend/internal/finance/write.go`: `receipt_sequences` not consumed; no receipt number assigned on payment. Wire `receipt_sequences` into `RecordPayment` so every payment gets a receipt number.
- Global ID: `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-01`
- Severity: P1 (High).

**F5 — Route payment matching through the FSM.**
- `backend/internal/finance/write.go`: `MatchReconciliation` does direct `amount_paid += $1` bypassing InvoiceState FSM. Route through `InvoiceState` transition table.
- Global ID: `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-02`
- Severity: P0 (Critical). Append-only ledger / FSM invariant FAIL.

**F6 — Require idempotency key on all state-changing finance endpoints.**
- `RecordPayment`, `AllocatePayment`, `CreateInvoice`, `CreateAdjustment`, `CreateRefund`, `CreateCredit` must require `X-Idempotency-Key` (Redis-backed, 24h TTL, already wired via `IdempotencyMiddleware`).
- Global ID: `FINANCE-ses_e882afe18ffek6w5jGdBGWEKHw-02`
- Severity: P1 (High). Idempotency invariant PARTIAL.

**F7 — Outbox delivery correctness.**
- Outbox worker already uses `FOR UPDATE SKIP LOCKED` with lease timeouts. Verify no HTTP-in-tx (confirmed in server.go STK pusher and SMS dispatcher). No code change needed; add to verification checklist.
- Global ID: `OUTBOX-ses_e882afe18ffek6w5jGdBGWEKHw-01`
- Severity: P2 (Medium). Outbox invariant FAIL (documented, worker already addresses).

**F8 — Request-scoped tenant transaction boundary.**
- `middleware.TenantTxMiddleware` + `TxFromGin(c)` pattern confirmed. Verify every handler reads tenant_id from context, not from request body.
- Global ID: `TENANCY-ses_e87d20012ffe7LmqgM7PO7pQKG-01`
- Severity: P1 (High).

---

## 4. Task Inventory with Global IDs

Format: `<MODULE>-<SESSION-ID>-<NN>`. Severity: P0 (Critical, blocks release), P1 (High), P2 (Medium), P3 (Low).

### 4.1 Tenancy & Security

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `TENANCY-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` | Remove `X-Tenant-ID` header fallback; tenant only from verified JWT | P0 | — |
| `TENANCY-ses_e87d20012ffe7LmqgM7PO7pQKG-01` | Verify every handler reads tenant_id from Gin context, not request body | P1 | `TENANCY-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` |
| `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-01` | CVE-2025-30204: jwt v5.2.1 → v5.2.2 (already in go.mod; verify no older transitive) | P0 | — |
| `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-02` | localStorage tokens → migrate to HttpOnly cookies (authStore) | P1 | — |
| `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-03` | RLS superuser bypass review: ensure `FORCE ROW LEVEL SECURITY` on all tenant tables | P1 | — |

### 4.2 Finance / Money / M-Pesa

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `FINANCE-ses_e882afe18ffek6w5jGdBGWEKHw-01` | Replace `float64` with `shopspring/decimal` in `write.go`, `mpesa_events.go` | P0 | `F2` |
| `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-01` | Wire `receipt_sequences` into `RecordPayment` (receipt number on every payment) | P1 | — |
| `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-02` | Route `MatchReconciliation` through InvoiceState FSM (no direct `amount_paid +=`) | P0 | `F5` |
| `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-03` | Invoice number must include `term_id` (term 2 skipped via ON CONFLICT) | P1 | — |
| `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-04` | Credit row for overpayment (clamped allocation currently drops excess) | P2 | — |
| `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` | Replace `float64` `InboxContext.Amount` with decimal | P0 | `F2` |
| `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-02` | Consolidate `mpesa_raw_inbox` → `mpesa_inbox`; remove dual-write | P0 | `F3` |
| `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-03` | STK polling leak: ensure STK pusher marks requests SENT/FAILED and doesn't reprocess | P1 | — |
| `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-04` | Remove `tenantID="unknown"` fallback in mpesa_handler (~line 84-88) | P0 | `F1` |
| `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-05` | Remove `item.Value.(string)` type-assertion panic risk (~line 172-174) | P1 | — |

### 4.3 Assessment / Marks

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-01` | Replace `float64` `ResultInput.Points/RawScore/MaxScore` with decimal | P0 | `F2` |
| `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-02` | Add teaching-assignment scope to `UpsertResult` (teacher can only score own class/area) | P1 | — |
| `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-03` | `ReopenResult`: add role check (already role-protected in routes; verify handler enforces) | P2 | — |
| `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-04` | FSM transition validation on reopen/moderate/publish (already in assessment_fsm.go; verify) | P2 | — |

### 4.4 Reports

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `REPORTS-ses_e272bf0e1ffeiV28Kk70xSTXDO-01` | `CreateReportRun`: make asynchronous (job queue) with completeness check before publish | P1 | — |
| `REPORTS-ses_e272bf0e1ffeiV28Kk70xSTXDO-02` | Report completeness validation: all learners have results before run can publish | P1 | — |
| `REPORTS-ses_e272bf0e1ffeiV28Kk70xSTXDO-03` | Snapshot revision immutability: new revision on correction, never mutate (already in snapshot.go; verify) | P2 | — |

### 4.5 Learners / Admissions

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `LEARNERS-ses_e272c57a8ffennLHIqSAWrtv6v-01` | Verify unique `(tenant_id, admission_number)` enforced (migration 0040 confirmed) | P2 | — |
| `LEARNERS-ses_e272c57a8ffennLHIqSAWrtv6v-02` | Section 6 "Could not verify" items from PROMPT4 — re-verify and close | P2 | — |

### 4.6 Offline / PWA / Frontend

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `OFFLINE-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` | React error boundary (uncaught error boundary for PWA) | P1 | — |
| `OFFLINE-ses_e3147eef0ffeM3INA7UlRhNNQ7-02` | 401 refresh loop: single-flight already in api.ts; verify no infinite redirect on refresh failure | P1 | — |
| `OFFLINE-ses_e882afe18ffek6w5jGdBGWEKHw-01` | localStorage token leakage → HttpOnly cookie (shared with SECURITY-02) | P1 | `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-02` |
| `OFFLINE-ses_e2ac1978effe18bTFK372grH6b-01` | implemented-vs-stubbed inventory: confirm offline sync queue actually wired to UI | P2 | — |

### 4.7 Platform / Compliance / Secondary

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `PLATFORM-ses_e312c20d6ffe1DwStCmhJVniUo-01` | Tenant customization (migration 0035) — verify applied, RLS on customization tables | P2 | — |
| `COMPLIANCE-ses_e882afe18ffek6w5jGdBGWEKHw-01` | DSR request handling, breach register, access-log immutability | P2 | — |
| `AUDIT-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` | Production-readiness: health/ready/metrics endpoints, structured logging | P2 | — |

### 4.8 Product (Provenance placeholder)

| ID | Task | Severity | Depends On |
|---|---|---|---|
| `PRODUCT-ses_e2745c2dfffe3ROVWjMBWrT9pz-01` | Re-run PROMPT1 market/competitor analysis (plan file empty; findings unrecovered) | P3 | — |

---

## 5. Dependency Graph & Global Execution Order

**Execution Order (strict):**

1. `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-01` (jwt version — dependency-free)
2. `TENANCY-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` (remove X-Tenant-ID fallback — blocks all tenant-scoped work)
3. `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-04` (remove "unknown" tenant fallback — depends on F1)
4. `FINANCE-ses_e882afe18ffek6w5jGdBGWEKHw-01` + `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` + `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-01` (float64 → decimal — depends on F2)
5. `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-02` (single inbox — depends on F3)
6. `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-02` (FSM routing — depends on F5)
7. `TENANCY-ses_e87d20012ffe7LmqgM7PO7pQKG-01` (tenant context verification — depends on F1)
8. `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-01` (receipt sequences — P1)
9. `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-03` (invoice number term_id — P1)
10. `ASSESSMENT-ses_e272bf0e1ffeiV28Kk70xSTXDO-02` (teaching-assignment scope — P1)
11. `REPORTS-ses_e272bf0e1ffeiV28Kk70xSTXDO-01` + `-02` (async report run + completeness — P1)
12. `SECURITY-ses_e882afe18ffek6w5jGdBGWEKHw-02` + `OFFLINE-ses_e882afe18ffek6w5jGdBGWEKHw-01` (HttpOnly cookies — P1)
13. `OFFLINE-ses_e3147eef0ffeM3INA7UlRhNNQ7-01` + `-02` (error boundary, refresh loop — P1)
14. `FINANCE-ses_e272cec51ffee8zSxwpLqWvrQl-04` (overpayment credit — P2)
15. `MPESA-ses_e3147eef0ffeM3INA7UlRhNNQ7-03` + `-05` (STK pusher, type assertion — P1/P2)
16. All P2 tasks (overpayment, ReopenResult role, report immutability, learner unique verify, platform customization, compliance)
17. `PRODUCT-ses_e2745c2dfffe3ROVWjMBWrT9pz-01` (re-run PROMPT1 — P3, independent)

**Critical path:** F1 → F2 → F3 → F5 (tenant spoofing → decimal → single inbox → FSM routing). These four are P0 and must complete before any feature work.

---

## 6. Module-by-Module Implementation Plans

### 6.1 Tenancy & Security (P0 first)

**`backend/internal/middleware/tenant.go`:**
- Remove `X-Tenant-ID` header reading entirely. Tenant ID extracted only from verified JWT claims via `TenantContextMiddleware`.
- Public routes (webhooks, auth) must not set tenant context; they operate tenant-less or use webhook token/IP auth.

**`backend/internal/auth/*`:**
- Verify `golang-jwt/jwt/v5` is at v5.2.2 (already in go.mod). Check `go.mod` / `go.sum` for no v5.2.1 transitive.
- `authStore.ts` (frontend): remove localStorage token storage; rely on HttpOnly cookies + `withCredentials: true` (already set in api.ts).

### 6.2 Finance / Money / M-Pesa

**`backend/internal/finance/write.go`:**
- `feeLineDraft`/`invoiceDraft`: `float64` → `shopspring/decimal.Decimal`.
- `RecordPayment`: consume `receipt_sequences`, assign receipt number on every payment.
- `MatchReconciliation`: route through `InvoiceState` transition table (DRAFT→ISSUED→PARTIALLY_PAID→FULLY_PAID); no direct SQL `amount_paid +=`.
- Invoice number: `INV-{year}-{term_id}-{admissionNo}` (include term_id to prevent term-2 ON CONFLICT skip).
- Overpayment: write a credit row for excess allocation instead of dropping.

**`backend/internal/finance/mpesa_events.go`:**
- `MPESAEvent.Amount`: `float64` → `decimal.Decimal`.
- Read `mpesa_inbox` only (not `mpesa_raw_inbox`).

**`backend/internal/finance/mpesa_handler.go`:**
- Remove `tenantID="unknown"` fallback (~line 84-88); reject webhook without resolvable tenant.
- Remove `item.Value.(string)` unchecked type assertion (~line 172-174); use type-safe access with error return.

**`backend/internal/mpesa/inbox_fsm.go`:**
- `InboxContext.Amount`: `float64` → `decimal.Decimal`.

**`backend/internal/daraja/*` / STK pusher (server.go:199-278):**
- Ensure STK pusher transitions PENDING→SENDING→SENT/FAILED and never reprocesses a terminal state.

### 6.3 Assessment / Marks

**`backend/internal/assessment/write.go`:**
- `ResultInput.Points/RawScore/MaxScore`: `float64` → `decimal.Decimal`.
- `UpsertResult`: add teaching-assignment scope — verify the authenticated teacher is assigned to the class_group/learning_area for the event before allowing write.

**`backend/internal/assessment/assessment_fsm.go`:**
- Already hardened (DRAFT/SUBMITTED/MODERATED/PUBLISHED/LOCKED). Verify transitions enforced on `ReopenResult` and `ModerateResults`.

### 6.4 Reports

**`backend/internal/reports/write.go`:**
- `CreateReportRun`: enqueue async job (do not generate synchronously). Pre-publish completeness check: every learner in grade/term has at least one result in state SUBMITTED/MODERATED/PUBLISHED/LOCKED.
- `PublishReportRun`: generate snapshots via `reports/snapshot.go` `BuildSnapshot`, mark run complete.

**`backend/internal/reports/snapshot.go`:**
- Already immutable (CardSnapshot frozen, revision on correction). Verify no mutation path exists.

### 6.5 Learners / Admissions

- Migration 0040 `uq_learners_tenant_admission` confirmed applied. No code change needed; add to verification checklist.
- Re-verify PROMPT4 section 6 "Could not verify" items.

### 6.6 Offline / PWA / Frontend

**`frontend/src/lib/offline.ts`:**
- Already tenant-namespaced IndexedDB (`skulapp_offline_<tenant_id>`), sync queue with idempotency keys, cache collection with TTL. Verify `detachOfflineTenant` is called on logout to prevent cross-tenant replay on shared PCs.

**`frontend/src/lib/api.ts`:**
- Single-flight refresh already implemented. Verify refresh failure doesn't cause infinite redirect loop (clears session, redirects to /login — confirmed).
- CSRF double-submit already implemented.

**Frontend (general):**
- Add React error boundary for uncaught errors in PWA (production audit finding).

### 6.7 Platform / Compliance / Secondary

- Verify migration 0035 tenant customization applied; RLS on customization tables.
- DSR, breach register, access-log immutability — verify no code path mutates access logs.

---

## 7. Migration Plan

**No new migrations required.** All schema constraints referenced by tasks are already applied:

| Migration | Constraint | Status |
|---|---|---|
| `0031_mpesa_ledger_hardening.sql` | `uq_mpesa_inbox_trans (tenant_id, trans_id)`, `uq_payment_ledger_receipt (tenant_id, receipt_number)`, RLS, outbox lease columns | CONFIRMED APPLIED |
| `0031_auth_lookup_function.sql` | (duplicate number) auth lookup function | CONFIRMED APPLIED |
| `0032_append_only_ledger_enforcement.sql` | `payment_ledger.amount <> 0`, `prevent_ledger_mutation()` trigger | CONFIRMED APPLIED |
| `0038_payment_allocation_unique.sql` | `uq_payment_allocations_payment_invoice (payment_id, invoice_id)` | CONFIRMED APPLIED |
| `0040_learner_admission_unique.sql` | `uq_learners_tenant_admission (tenant_id, admission_number)` | CONFIRMED APPLIED |
| `0035_tenant_customization.sql` | Tenant customization tables | referenced, verify applied |

**Migration number duplication note:** `0031` is used twice. Documented for awareness; no remediation needed (both already applied, no conflict in execution order since they're independent tables).

**Backfill:** None required — all data constraints are additive (unique indexes, triggers) and won't invalidate existing data.

---

## 8. Verification & Testing Strategy

**Build/typecheck:**
- `go build ./...`, `go vet ./...` (backend)
- `npx tsc --noEmit`, `npm run build` (frontend)

**Tests (if test command exists):** run relevant `go test ./...` for finance, assessment, reports, auth packages.

**Verification checklist (per finding):**
- [ ] `X-Tenant-ID` header fallback removed; tenant only from JWT
- [ ] No `float64` remains in money paths (write.go, mpesa_events.go, inbox_fsm.go, assessment/write.go)
- [ ] `mpesa_raw_inbox` no longer read by handler code
- [ ] `receipt_sequences` consumed in `RecordPayment`
- [ ] `MatchReconciliation` routes through InvoiceState FSM
- [ ] Invoice number includes `term_id`
- [ ] `UpsertResult` scoped to teaching assignment
- [ ] `CreateReportRun` is async with completeness pre-check
- [ ] jwt at v5.2.2, no v5.2.1 transitive
- [ ] RLS `FORCE` on all tenant tables
- [ ] `detachOfflineTenant` called on logout

---

## 9. DECISION-NEEDED List

1. **PROMPT1 market findings unrecovered** — Plan file `.kilo/plans/1794637446432-market-product-map.md` is empty. Decide whether to re-run PROMPT1 or mark product context as out of scope for this technical plan. (Task `PRODUCT-ses_e2745c2dfffe3ROVWjMBWrT9pz-01`)
2. **Migration 0031 duplication** — `0031_auth_lookup_function.sql` and `0031_mpesa_ledger_hardening.sql` share a number. Confirm no renumbering needed (both applied, independent).
3. **Outbox invariant FAIL** — Documented as FAIL in Security & Architecture Audit, but worker already uses `FOR UPDATE SKIP LOCKED`. Confirm whether additional outbox work is needed or if the invariant status should be updated to PARTIAL/PASS.
4. **`ses_e361b17dfffeR5lYo1n0yMZMAk` / `ses_e38534b8fffeeG5U0VS2BsU4mK`** — Production-readiness audit referenced but not recovered. Decide whether to attempt recovery or exclude.
5. **HttpOnly cookie migration** — localStorage tokens → HttpOnly cookies requires backend cookie-setting changes in auth login/refresh. Confirm desired approach.
6. **Report run async mechanism** — No job queue library evident in go.mod imports (server.go uses raw goroutines for workers). Confirm whether to add a job queue (e.g., machinery, async) or use goroutine + outbox pattern.

---

## 10. Coverage Matrix

| Source Session | Findings Covered | Tasks Created | Status |
|---|---|---|---|
| PROMPT1 `ses_e2745c2d...` | Market analysis (non-technical) | `PRODUCT-...-01` | Placeholder (file empty) |
| PROMPT2 `ses_e272dbfa...` | Timetable module (doesn't exist) | — | N/A (no module to implement) |
| PROMPT3 `ses_e272cec5...` | Fees/ledger/payments A1–A4, B1–B4, C1–C4 | `FINANCE-ses_e272cec5...-01` to `-04` | Covered |
| PROMPT4 `ses_e272c57a...` | Admissions/learner registry | `LEARNERS-ses_e272c57a...-01`, `-02` | Covered |
| PROMPT5 `ses_e272bf0e...` | Assessment/marks/report card A1–A2, B1–B4, C1–C2 | `ASSESSMENT-ses_e272bf0e...-01` to `-04`, `REPORTS-ses_e272bf0e...-01` to `-03` | Covered |
| `ses_e3147eef...` | Production hardening (tenant spoofing, error boundary, 401 loop, STK leak) | `TENANCY-...-01`, `MPESA-...-01` to `-05`, `OFFLINE-...-01`, `-02`, `AUDIT-...-01` | Covered |
| `ses_e882afe1...` | Security F1–F14, 6 invariants, second-zip | `SECURITY-...-01` to `-03`, `FINANCE-ses_e882afe1...-01`, `-02`, `OFFLINE-ses_e882afe1...-01`, `COMPLIANCE-...-01` | Covered |
| `ses_e312c20d...` | Tenant customization | `PLATFORM-ses_e312c20d...-01` | Covered |
| `ses_e2ac1978...` | Implemented-vs-stubbed | `OFFLINE-ses_e2ac1978...-01` | Covered |
| `ses_e87d2001...` | Request-scoped tenant transactions | `TENANCY-ses_e87d2001...-01` | Covered |
| `ses_e361b17d...` / `ses_e38534b8...` | Production-readiness (unrecovered) | — | Not covered (DECISION-NEEDED #4) |
| `ses_e88d11d0...` | Login tracking | — | Not relevant (excluded) |

**Task counts by severity:** P0: 8 | P1: 14 | P2: 10 | P3: 1 | Total: 33

---

## End of Plan

This document is the complete implementation master plan. No code changes are made by this plan; the implementing model executes the tasks in Section 5 order, verifying each against Section 8 before proceeding.