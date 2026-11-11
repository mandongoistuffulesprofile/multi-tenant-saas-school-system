# Shule Yetu — Audit Decisions (Settled)

Source: Pre-release production-readiness audit (2026-11-10). These decisions are settled and must be treated as constraints for implementation work.

## Decisions

1. **Auth (HttpOnly cookies only)**
   - Use HttpOnly cookies as the sole browser auth mechanism. Remove the localStorage bearer-token path.
   - Cookies: `Secure`, `SameSite=Lax` (or `Strict`), with CSRF protection on mutating routes.
   - Short-lived access token + refresh cookie; offline replay relies on browser-attached cookies.
   - Bearer tokens for native/third-party API clients are deferred to a separate, deliberate path.

2. **M-Pesa webhook (fail closed)**
   - Treat as unauthenticated until proven otherwise.
   - Require `MPESA_WEBHOOK_TOKEN` or `MPESA_ALLOWED_IPS` in production; if neither set, refuse to start or reject all callbacks (never silently accept).
   - Defenses: Safaricom published IP ranges, secret token in callback URL path, idempotency on `MpesaReceiptNumber`.
   - For any action that credits a fee balance, confirm via Transaction Status or STK query before posting.

3. **Offline sync (`/sync/push` + `/sync/pull`)**
   - Wire frontend to backend `/sync/push`/`/sync/pull` protocol (has conflict detection); remove ordinary-endpoint replay as sync mechanism.
   - Per-record version numbers with server-wins or last-write-wins policy sufficient for grading grids initially.
   - Keep ordinary endpoints for online-only actions.

4. **Money (integer minor units, pre-launch)**
   - Migrate to integer cents (or integer shillings + minor unit) before real data exists.
   - DB: `bigint` or `numeric(14,2)`; Go and API: integers end to end.
   - Covers invoices, payments, in-kind valuations, and sub-ledgers. Must be done now (data migration cost rises after launch).

5. **Demo data (strip + enforce)**
   - Remove `DEMO_LOGINS.txt` and `migrations/seed/0001_demo.sql` from production images (e.g. `.dockerignore` + separate seed command).
   - Seed command must refuse to run when `APP_ENV=production`.
   - If demo logins ever ran against a real tenant, rotate everything.

6. **Outbox (minimal viable scope)**
   - Ship now: SMS receipts (payment confirmed, fee statement) and parent alerts (tied to sprint 3).
   - Defer: audit and projection events until real read-model need exists.
   - Required: retries with backoff, dead-letter state, idempotent consumers. An outbox that only writes rows is worse than none.

7. **Year-end rollover (defer with guardrails)**
   - Defer for first handover; unlikely needed until first term cycle ends.
   - Document manual workaround (SQL runbook).
   - Ensure schema carries `academic_year` on enrolments, invoices, and assessments so rollover can be added without migration.
   - If first client is mid-year, make it the first post-handover release.

## Priority Order

`2, 1, 5, 4, 3, 6, 7`

- **2, 1, 5** — security exposures (fix first)
- **4** — money type; gets harder with every row added
- **3, 6** — product/scope correctness
- **7** — last (deferred with guardrails)
