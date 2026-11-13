# HANDOVER DOCUMENT — Platform Onboarding E2E Verification

## Context
**Goal**: Verify complete UI/UX + onboarding workflow works end-to-end before user tests as fresh tenant admin.

**Repo**: `mandongoistuffulesprofile/multi-tenant-saas-school-system` (branch: main, latest: 63b4321)

---

## Current State

### ✅ Completed
1. **Database cleaned** — demo tenant (`demo-school`) + all tenant-scoped rows deleted
2. **Global reference data populated** (required by FKs & onboarding wizard):
   - `grades` (11 rows: PP1–Grade 9)
   - `fee_categories` global (8 rows)
   - `plans` (4 rows: FREE, STARTER, PROFESSIONAL, ENTERPRISE)
   - `curriculum_versions` (1: CBC v1.0 published)
   - `learning_areas` (12 rows)
   - `strands` (16 rows)
3. **Platform admin user exists**:
   - Email: `super@platform.test`
   - Password: `supersecret123`
   - Role: `SAAS_ADMIN` on tenant `platform`
4. **Backend running** on `localhost:8080` (PID 727541, bg process `bgp_1cd123455001LLWxdxfXdv7nhW`)
5. **Login bug fixed** (commit 63b4321) — handler now sets `app.current_user_role=SAAS_ADMIN` in transaction before querying users table (RLS bypass)

### ⚠️ Active Issue
**Login still returns `INVALID_CREDENTIALS`** despite correct password hash in DB.
- Hash format: `salt:hash` (hex-encoded, argon2id, matches `crypto.go:HashPassword`)
- `VerifyPassword` works in unit tests (`TestPasswordHashRoundTrip` passes)
- RLS query returns the row when `SET LOCAL app.current_user_role = 'SAAS_ADMIN'` is run manually in psql
- **Suspect**: Transaction in handler commits before second tx for memberships, but the `SET LOCAL` config may not persist across the `Commit()` boundary. Need to verify config is set in the *same* transaction that does the SELECT.

---

## What Remains

### 1. Fix Login (Critical)
**File**: `backend/internal/auth/handler.go` (lines 105–132)
- Current code: Sets role, queries, commits, then opens new tx for memberships
- **Fix**: Keep the role config in the *same* transaction that does the SELECT. Either:
  - Don't commit after user lookup; reuse same tx for memberships, OR
  - Set `app.current_user_role` in both transactions

### 2. Start Frontend Dev Server
```bash
cd /home/yna/Desktop/New Folder/frontend && npm run dev
```
- Verify onboarding wizard loads at `/platform/operations` (super-admin)
- Verify `/select-school` works

### 3. End-to-End Onboarding Test
**Flow**:
1. Super-admin logs in → `/platform/operations`
2. Create new tenant via platform onboarding wizard
3. Complete all steps: Profile → Calendar → Structure → Finance → Seeds → Complete → Handoff
4. Login as that tenant's admin
5. Audit dashboard/sidebar/breadcrumbs/flows

**Key API endpoints** (from `backend/internal/platform/onboarding.go`):
- `GET /api/v1/platform/tenants/:id/setup` — get wizard state
- `PATCH /api/v1/platform/tenants/:id/setup/profile` — SetupProfile
- `POST /api/v1/platform/tenants/:id/setup/calendar` — SetupCalendar
- `POST /api/v1/platform/tenants/:id/setup/structure` — SetupStructure
- `POST /api/v1/platform/tenants/:id/setup/finance` — SetupFinance
- `POST /api/v1/platform/tenants/:id/setup/seeds` — SetupSeeds
- `POST /api/v1/platform/tenants/:id/setup/complete` — CompleteSetup
- `POST /api/v1/platform/tenants/:id/setup/handoff` — MarkHandoff

---

## Relevant Files
| File | Purpose |
|------|---------|
| `backend/internal/auth/handler.go:105-132` | Login handler — needs fix |
| `backend/internal/auth/crypto.go` | HashPassword / VerifyPassword (argon2id hex) |
| `backend/internal/platform/onboarding.go` | Onboarding wizard handlers |
| `backend/cmd/api/server.go` | Routes registration |
| `frontend/src/components/organisms/Breadcrumb.tsx` | New breadcrumb (Phase 2) |
| `frontend/src/components/organisms/Layout.tsx` | Shared layout with TopBar/TabBar |
| `frontend/src/i18n/translations.ts` | i18n keys (EN+SW) for sidebar labels |

---

## Quick Commands for Next Agent

```bash
# Check backend logs
background_process logs bgp_1cd123455001LLWxdxfXdv7nhW

# Restart backend if needed
background_process stop bgp_1cd123455001LLWxdxfXdv7nhW
background_process start "cd /home/yna/Desktop/New Folder/backend && DATABASE_URL=... go run ./cmd/api"

# Test login manually
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "super@platform.test", "password": "supersecret123"}'

# Verify DB state
docker exec school_postgres psql -U school_admin -d school_system -c "
SELECT email, password_hash FROM users WHERE email = 'super@platform.test';
"

# Start frontend
cd /home/yna/Desktop/New Folder/frontend && npm run dev
```

---

## Notes
- Redis is running (`school_redis` container)
- Postgres is running (`school_postgres` container)
- No test scripts defined; verify manually via API + UI
- All Phase 1–3 UI/UX audit work committed and pushed

---

**Next agent should**: Fix the login transaction issue → start frontend → run full onboarding E2E test.