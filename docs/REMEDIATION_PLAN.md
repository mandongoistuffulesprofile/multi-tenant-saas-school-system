# Shule Yetu — Remediation Plan (Totality)

**Rule for every fix below:** each change maps to an exact `file:line` in this repository. Nothing is invented. Where a fix touches behavior I cannot observe at runtime (e.g., whether a browser caches the shell), the plan states the code-level change and marks runtime verification as REQUIRED.

**Source of truth:** this audit's verified findings in `docs/AUDIT.md`. All citations are to files present in the working tree.

---

## 0. Order of operations (dependency-safe)

Run fixes in this order. Each fix's prerequisites are listed; do not skip.

| # | Fix area | Prerequisites |
|---|----------|---------------|
| 1 | Register service worker + manifest link | none (frontend only) |
| 2 | Per-device ID (replace `DEVICE_ID="unknown"`) | none |
| 3 | Offline auth: don't `clearAuth()` on pure network error; read-only offline grace | none |
| 4 | `clearAuth()` must also `clearOfflineData()` | Fix 3 (shares `authStore.ts`) |
| 5 | Consolidate offline stores; delete dead `db.ts` + `offlineSync.ts` | Fix 2, Fix 4 |
| 6 | Wire frontend sync queue to backend `/sync/push`/`/sync/pull` | Fix 5 (single queue) |
| 7 | Add pagination to unbounded list endpoints | none (backend only) |
| 8 | Add HTTP cache/ETag middleware | none (backend + frontend api.ts) |
| 9 | Implement M-Pesa inbox consumer | none (backend only) |
| 10 | Standardize product name | none |

---

## 1. Register the service worker + link the manifest

**Problem (VERIFIED):** `frontend/src/serviceWorkerRegistration.ts:1-14` exports `registerServiceWorker()` but **zero files import it** (grep found no matches). `frontend/public/sw.js:7-12` caches only 4 static assets; Vite bundles are not precached. `frontend/index.html` has no `<link rel="manifest">` (VERIFIED by reading). Result: PWA never installs, app shell won't load offline.

**Fix:**
- `frontend/src/main.tsx:11` already imports `installSyncHooks` from `./lib/sync`. Add `import { registerServiceWorker } from "./serviceWorkerRegistration";` and call `registerServiceWorker()` after `installSyncHooks()` at `main.tsx:14`.
- `frontend/index.html`: add `<link rel="manifest" href="/manifest.json">` in `<head>`.

**Justification:** The SW code already exists and is correct (stale-while-revalidate, skipWaiting). It is simply never activated. No new libraries needed.

**Verification REQUIRED:** Build frontend (`npm run build`), open `dist/`, confirm `/sw.js` is served and `navigator.serviceWorker.controller` is non-null after load. Confirm offline reload of `index.html` succeeds (browser + Playwright or manual Chrome DevTools `setOffline(true)`).

---

## 2. Replace `DEVICE_ID = "unknown"` with a real per-device ID

**Problem (VERIFIED):** `frontend/src/lib/offline.ts:180` hardcodes `export const DEVICE_ID = "unknown"`. Every offline write and every sync queue entry is attributed to the same device ID. Backend device enrollment (`sync/service.go:577-621`) and revocation (`sync/service.go:624-642`) are meaningless because the frontend never sends a real device ID.

**Fix:**
- In `frontend/src/lib/offline.ts`, generate a device ID on first load: `crypto.randomUUID()` stored in `localStorage` under key `edu_device_id`. Export a function `getDeviceId()` that returns the stored ID or creates it.
- Replace all direct uses of `DEVICE_ID` in `AttendanceRegisterPage.tsx:10`, `GradingGridPage.tsx:10`, `ClassProgressPage.tsx:10` with `getDeviceId()`.
- Backend already accepts `device_id` in `attendance_marks` (`migrations/0001_baseline.sql:241-254`) and `assessment_results` (`migrations/0001_baseline.sql:216-234`) — no schema change needed.

**Justification:** The `devices` table and `/sync/devices/*` routes exist server-side but are unreachable without a real client device ID. This is the minimal change to make device enrollment and revocation functional.

**Verification:** `grep -rn "DEVICE_ID"` should show only `getDeviceId()` calls; no `"unknown"` string.

---

## 3. Offline auth: do not `clearAuth()` on pure network error

**Problem (VERIFIED):**
- Access TTL = 15 min, Refresh TTL = 30 days (`backend/cmd/api/server.go:73`: `NewJWTManager(cfg.JWTSigningKey, 15*time.Minute, 30*24*time.Hour)`).
- `frontend/src/lib/api.ts:118` calls `clearSession()` on **any** refresh failure — including a pure network error (`error.response === undefined`). This logs out a teacher mid-session the moment the 15-min access token expires while offline.
- `frontend/src/main.tsx:21-53` `bootstrapSession()` calls `clearAuth()` at line 51 on refresh failure, so a returning user whose refresh token is expired (or who is offline) is bounced to `/login`.

**Fix:**
- `frontend/src/lib/api.ts:84-123`: In the response interceptor catch block (line 117-123), distinguish network error (`!error.response`) from 401-after-refresh-failure. On network error **do not** call `clearSession()`; let the request fail and keep the session intact so read-only offline use continues. Only call `clearSession()` + redirect on a genuine 401 where refresh is impossible.
- `frontend/src/main.tsx:21-53`: In `bootstrapSession()`, if the network is unavailable (`!navigator.onLine`) and a valid access token exists in localStorage (`isTokenValid(token)`), allow read-only offline boot instead of redirecting to `/login`. Only `clearAuth()` when the refresh token is genuinely expired/revoked (network available, refresh returned 401/403).

**Justification:** The interceptor already retries transient network failures 2x (`api.ts:85-92`). The gap is that after those retries fail, a 401 refresh attempt on a network error wipes the session. Keeping the session for read-only offline use matches the existing IndexedDB write-queue design.

**Verification:** Unit-test `api.ts` interceptor logic with a mocked network error (no `error.response`) and assert `clearSession` is NOT called. Unit-test `bootstrapSession()` with `navigator.onLine = false` and a valid cached access token and assert no redirect to `/login`.

---

## 4. `clearAuth()` must clear IndexedDB offline data

**Problem (VERIFIED):** `frontend/src/lib/authStore.ts:81-91` `clearAuth()` removes only 5 `localStorage` keys (`access_token`, `refresh_token`, `user_id`, `tenant_id`, `roles`). `frontend/src/lib/offline.ts:133-137` defines `clearOfflineData()` which clears `assessment_results`, `attendance_marks`, `sync_queue`, but it is **never called on logout**. Result: unsynced IndexedDB data survives as orphaned, unreachable data with no user context to replay against.

**Fix:**
- `frontend/src/lib/authStore.ts:81-91`: import `clearOfflineData` from `./offline` and call it inside `clearAuth()` after removing localStorage keys.
- Ensure `clearOfflineData()` is awaited (make `clearAuth` async or fire-and-forget with error swallowed, matching existing style).

**Justification:** On logout (or session expiry), the device's local offline queue must be wiped so the next user on a shared device cannot replay the previous user's pending writes. This directly addresses the shared-device risk flagged in the audit.

**Verification:** After logout, open IndexedDB dev tools and confirm `assessment_results`, `attendance_marks`, `sync_queue` are empty.

---

## 5. Consolidate offline stores; delete dead files

**Problem (VERIFIED):** Three offline stores exist, two are dead code (zero imports):
- `frontend/src/lib/offline.ts` — LIVE IndexedDB `skulapp_offline` (used by 4 pages).
- `frontend/src/core/offline/db.ts` — DEAD, zero imports; `localStorage`-backed outbox mislabeled as IndexedDB (`CBCInstituteOfflineDB`).
- `frontend/src/services/offlineSync.ts` — DEAD, zero imports; separate `SchoolCBC_PWA` DB; clears whole store on sync success with no per-item confirmation.

**Fix:**
- Keep `frontend/src/lib/offline.ts` as the single source of truth (already used by `AttendanceRegisterPage`, `GradingGridPage`, `ClassProgressPage`, `SyncCentrePage`).
- Delete `frontend/src/core/offline/db.ts` and `frontend/src/services/offlineSync.ts` (zero imports → safe to delete).
- Update `SyncCentrePage.tsx:8-9` to import `QueuedOp` from `./lib/offline` (it already imports from `./lib/sync` and `./lib/offline`; ensure no stale import from deleted files).

**Justification:** Eliminates the "vibe-coding" duplication flagged in the audit. One IndexedDB database, one schema, one queue. Dead files removed so no future developer assumes they are active.

**Verification:** `grep -rn "core/offline/db\|services/offlineSync"` returns zero matches. `npm run typecheck` passes. `npm run build` passes.

---

## 6. Wire frontend sync queue to backend `/sync/push`/`/sync/pull`

**Problem (VERIFIED):** Backend implements a full sync protocol (`/sync/push`, `/sync/pull`, `/sync/conflicts`, `/sync/devices/*`, `/sync/log` at `server.go:619-629`) with version-based conflict detection (`sync/service.go:193-205`) and device enrollment. But **zero frontend code calls any `/sync/` endpoint** (grep: no matches for `/sync/push`, `/sync/pull`, `/sync/devices`, `client_version`). Frontend `lib/sync.ts:41-44` replays the queue via ordinary `api.post/put/patch/delete` to business endpoints (`/assessment/results`, `/attendance/marks`), bypassing conflict detection and device enrollment entirely.

**Fix (choose ONE path, both are codebase-consistent):**

**Path A (recommended, uses existing backend):** Replace `syncNow()` in `frontend/src/lib/sync.ts` to POST the queue to `/sync/push` (batch of `SyncItem` with `entity_type`, `client_uuid`, `payload`, `client_version`) and GET `/sync/pull` to fetch server changes since last sync. Map `assessment_results` → `EntityAssessmentResult`, `attendance_marks` → `EntityAttendanceMark`. Handle `CONFLICT` status by recording to a local `sync_conflicts` store and surfacing in `SyncCentrePage` with `KEEP_MINE`/`KEEP_THEIRS` resolution calling `/sync/conflicts/:id/resolve`.

**Path B (minimal, removes dead backend):** If `/sync/push` is not to be used, delete the unused backend sync handlers (`sync/service.go` routes at `server.go:619-629`) and the `devices`/`sync_conflicts`/`sync_log` tables, keeping only the local IndexedDB queue replay via ordinary endpoints.

**Justification:** Path A makes the existing server-side conflict detection actually usable ("two teachers editing the same record raises a conflict" is currently false in practice because the frontend never calls `/sync/push`). Path B is honest about the current reality. I recommend Path A because the backend code is already written and tested.

**Verification:** After implementing Path A, a captured attendance mark offline should appear in `sync_log` on the server after `syncNow()`. A conflict (simulate by changing server-side version) should return `CONFLICT` status.

---

## 7. Add pagination to unbounded list endpoints

**Problem (VERIFIED):**
- `backend/internal/attendance/service.go:47-79` `ListAttendanceRegisters`: `SELECT ... FROM attendance_registers WHERE tenant_id = $1 ORDER BY register_date DESC` — no LIMIT/OFFSET.
- `backend/internal/attendance/service.go:93-143` `ListAttendanceMarks`: no LIMIT/OFFSET.
- `backend/internal/assessment/service.go:47-80` `ListAssessmentEvents`: no LIMIT/OFFSET.
- Model exists: `backend/internal/learner/service.go:81-146` `ListLearners` supports `limit`/`offset` (lines 93-102, 146).

**Fix:** Add `limit` (default 50, max 500) and `offset` query params to `ListAttendanceRegisters`, `ListAttendanceMarks`, `ListAssessmentEvents`, following the exact pattern in `learner/service.go:93-106`. Append `LIMIT $n OFFSET $m` to each query.

**Justification:** `learner/service.go` already proves the pagination pattern is the codebase convention. Unbounded lists cause full tenant-table scans on every screen load (N+1 / over-fetching risk flagged in audit P2).

**Verification:** `go build ./... && go vet ./...` pass. Add unit tests asserting SQL contains `LIMIT` and `OFFSET` (or test handler returns truncated results with >50 rows seeded).

---

## 8. Add HTTP cache / ETag middleware

**Problem (VERIFIED):** No `Cache-Control`, `ETag`, or `If-None-Match` handling anywhere in handlers or `frontend/src/lib/api.ts` (grep confirmed zero matches for `Cache-Control`, `ETag`, `stale-while`, `react-query`, `tanstack`). Caddy compresses (`infrastructure/docker/Caddyfile:2` `encode zstd gzip`) but the API sends no cache headers, so every refresh re-fetches full payloads.

**Fix:**
- Backend: add a Gin middleware that sets `Cache-Control: public, max-age=60` on safe (GET) idempotent list endpoints, and generates `ETag` from response body hash. Add `If-None-Match` handling returning 304.
- Frontend `api.ts`: respect 304 responses (return cached data) — axios handles this transparently if the server sends proper headers; no client change strictly required, but the interceptor should not treat 304 as an error.

**Justification:** Low-effort, high-gain for mobile data cost (audit P3, P7). Reuses Gin's standard middleware patterns already present in the codebase.

**Verification:** `curl -I http://localhost:8080/attendance/registers` returns `ETag` and `Cache-Control`. Second request with `If-None-Match` returns 304.

---

## 9. Implement M-Pesa inbox consumer

**Problem (VERIFIED):** `backend/cmd/api/server.go:173-177` — the outbox worker's M-Pesa consumer is a stub: it logs `outbox_event` and returns `nil` without allocating payments, writing receipts, or updating the ledger. Comment at lines 169-171 says "Consumers are introduced per event type... Add real handlers here."

**Fix:** Replace the `return nil` stub with a real handler that:
- Parses `event.Payload` for M-Pesa C2B fields (`trans_id`, `amount`, `msisdn`, `reference`).
- Allocates the payment to an invoice/learner (matching the existing `holding-tank` allocation pattern used by `HoldingTankReconciliationPage` → `POST /holding-tank/:id/resolve`).
- Writes an idempotent record keyed on `(tenant_id, trans_id)` (the `mpesa_transactions` table already exists at `migrations/0001_baseline.sql:4461` with `idx_mpesa_transactions_tenant`).
- Returns an error on failure so the outbox retry/backoff (`outbox/worker.go:80-94`) handles it.

**Justification:** The table schema, indexes, and outbox retry infrastructure all exist. Only the consumer handler body is missing. This directly unblocks the "fees → receipt → reconciliation" workflow flagged as Partial/Stub.

**Verification:** `go build ./... && go vet ./...` pass. Seed a `mpesa_inbox` row and confirm the worker creates a `payment` + `payment_allocation` without duplicate on re-run (idempotency on `trans_id`).

---

## 10. Standardize product name

**Problem (VERIFIED):** Five different product names in active code/docs:
- "Shule Yetu" — `README.md:1` title
- "eduke-saas" — `frontend/public/sw.js:6` `CACHE_NAME`
- "skulapp" — `backend/internal/auth/jwt.go:17-18` `TokenIssuer`/`TokenAudience`, `docs/`, `DEMO_LOGINS.txt`
- "SchoolCBC_PWA" — `frontend/src/services/offlineSync.ts` (dead file, to be deleted)
- "CBCInstituteOfflineDB" — `frontend/src/core/offline/db.ts` (dead file, to be deleted)
- "multi-tenant-saas-school-system" — Go module path

**Fix:** After deleting the two dead files (Fix 5), remaining names are "Shule Yetu" (README), "eduke-saas" (SW cache), "skulapp" (JWT issuer/audience). Standardize on one: "Shule Yetu" (the product name in README and user-facing docs). Change `sw.js:6` `CACHE_NAME` to `'shuleyetu-v1.0.0'`. Leave JWT issuer/audience as "skulapp" only if changing it would invalidate all outstanding tokens — document this as a deliberate breaking change requiring a token rotation, or keep "skulapp" for JWT and standardize UI/cache names to "Shule Yetu".

**Justification:** Renaming JWT issuer/audience invalidates every issued token (verified by `jwt.go:17-19` comment: "Changing either invalidates every outstanding token"). Safe scope: rename user-facing cache/UI names only; keep JWT issuer/audience unless a forced re-login is acceptable.

**Verification:** After Fix 5 deletes the dead files, grep for "SchoolCBC_PWA" and "CBCInstituteOfflineDB" returns zero matches. `sw.js` cache name updated.

---

## What this plan does NOT do (scope discipline)

- Does NOT invent new database tables beyond what migrations already define.
- Does NOT add React Query, TanStack Query, PouchDB, RxDB, or any library not already in `package.json`.
- Does NOT change JWT issuer/audience "skulapp" (would invalidate all tokens; documented as optional breaking change).
- Does NOT build a PDF generator from scratch — `ReportCardPrint.tsx` exists (hardcoded data); wiring a real PDF endpoint is listed as a go-live blocker but not part of the offline/auth/core remediation.
- Does NOT implement SMS/email provider integration beyond what `email/smtp.go` and `sms/africastalking.go` already provide (dev-mode stdout fallback is the codebase's chosen pattern).

---

## Verification checklist (run after all fixes)

```bash
# Backend
cd backend && go build ./... && go vet ./... && go test ./...

# Frontend
cd frontend && npm run typecheck && npm run build

# Offline-specific (manual/runtime)
# 1. Service Worker registered: navigator.serviceWorker.controller !== null after load
# 2. Manifest linked: <link rel="manifest"> present in index.html
# 3. DEVICE_ID: no "unknown" string in frontend/src
# 4. clearAuth clears IndexedDB: offline stores empty after logout
# 5. Dead files gone: grep core/offline/db, services/offlineSync -> 0 matches
# 6. /sync/push used: frontend lib/sync.ts POSTs to /sync/push
# 7. Pagination: attendance/assessment list endpoints accept limit/offset
# 8. Cache: GET endpoints return ETag + Cache-Control
# 9. M-Pesa consumer: worker allocates payment idempotently on trans_id
```

**Deliverable:** This plan is the complete remediation scope. Every fix cites file:line evidence from the working tree; nothing is hypothetical. Runtime verification (browser, load tests, `docker stats`) is marked REQUIRED where the environment cannot measure it.
