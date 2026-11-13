# PWA vs App Packaging Plan — Shule Yetu

## Goal
Package the frontend for both phones and desktops so teachers can use it offline-first in staffrooms with spotty internet (Safaricom/Airtel blackouts), with instant updates and no app-store friction where possible.

## Current state (already implemented, incomplete)

| PWA piece | File | Status |
|-----------|------|--------|
| Web App Manifest | `frontend/public/manifest.json` | Present but minimal: only an SVG icon, no PNGs, no `apple-touch-icon`, no screenshots, no `manifest.webmanifest` alias |
| Service Worker | `frontend/public/sw.js` | Hand-written, precaches only 4 static assets (missing hashed Vite JS/CSS), no auto-update on asset hash change |
| SW registration | `frontend/src/serviceWorkerRegistration.ts` | Registered only in `import.meta.env.PROD` |
| Sync hooks | `frontend/src/main.tsx` | `installSyncHooks()`, `registerServiceWorker()`, `registerBackgroundSync()` all called at boot |
| Offline storage | `frontend/src/lib/offline.ts` | IndexedDB per tenant: `assessment_results`, `attendance_marks`, `sync_queue` |
| Sync queue drain | `frontend/src/lib/sync.ts` | `syncNow()` POSTs batch to `/sync/push`; background-sync tag `sync-outbox` |
| Offline banner | `frontend/src/components/PWAOfflineSyncBanner.tsx` | Shows online/offline + pending count |
| Build | `frontend/vite.config.ts` | Emits brotli+gzip, hashed assets, no PWA plugin |
| Nginx | `frontend/nginx.conf` | Serves `.br/.gz`, `sw.js` + manifest with `no-cache`, SPA fallback |

**Gap:** `main.tsx` calls `registerServiceWorker()` but `App.tsx` never renders anything PWA-specific beyond the banner. The SW precache list is static and will go stale on every build because hashed asset filenames aren't included.

## Decision: PWA-first (recommended)

**PWA** is the best fit for this project, not a native or hybrid app.

Reasons:
1. **Offline-first is already the architecture** — IndexedDB outbox + sync queue + `/sync/push` backend endpoint exist. The whole write path is designed for intermittent connectivity.
2. **Single codebase** — One React/Vite build serves phones (Android Chrome, limited iOS Safari) and desktops (Chrome/Edge installable PWA). No React Native/Flutter/Kotlin/Swift codebase to maintain.
3. **Instant updates** — Bump the SW version, users get the new shell on next load. No app-store review, no version fragmentation.
4. **No install friction** — Teachers can "Add to Home Screen" on Android or install on desktop Chrome/Edge without visiting Play Store/App Store.
5. **Backend is already PWA-aware** — `/sync/push`, idempotency keys, optimistic locking on CBC results, RLS per tenant all support offline replay.

**Not chosen (and why):**
- **Native app (React Native / Flutter / Kotlin + Swift):** Requires a second codebase, separate CI/CD, app-store review for every update, push-notification setup, and duplicate logic for the offline queue. Overkill when the web stack already handles offline.
- **Capacitor / Cordova wrapper:** Middle ground — publish to app stores if needed later, but adds native plugin maintenance. Can layer on top of the PWA later if push notifications or app-store presence become mandatory.
- **Electron / Tauri desktop:** Not worth it — teachers don't install school-management software as desktop apps; the installable PWA covers desktop Chrome/Edge.

## Packaging options (best fit ranked)

### Option 1 — PWA-only (production target)
Build the Vite SPA, serve via nginx (already Dockerized in `frontend/Dockerfile`), installable via "Add to Home Screen" / Chrome desktop install.

```
docker build -t skulapp-web:<tag> -f frontend/Dockerfile frontend
```
Served behind Caddy with TLS at `https://<domain>`.

### Option 2 — PWA + optional Capacitor wrapper (future)
If app-store distribution is required later, wrap the same PWA build with Capacitor to publish to Google Play / Apple App Store. The web code stays identical; only native plugins (push, camera, biometric) are added.

### Option 3 — Native app (out of scope for now)
Only revisit if push notifications to locked phones or offline voice input become hard requirements.

## How updates work

### Frontend (PWA shell)
1. `npm run build` → new hashed assets in `frontend/dist/`.
2. `sw.js` `CACHE_NAME` bumped (e.g. `shuleyetu-v1.0.1`).
3. Deploy new `skulapp-web:<tag>` image; Caddy serves it.
4. On next page load, browser detects new SW, installs it in the background, activates on next load, precaches new shell.
5. Users get the update instantly — no action required.

If using `vite-plugin-pwa` (recommended improvement), the SW is auto-generated with the correct asset hashes and `CACHE_NAME` is derived from the build, removing manual version bumps.

### Backend
- `skulapp-api:<tag>` rebuilt from `backend/Dockerfile`; static Go binary.
- `migrate` one-shot runs new `migrations/*.sql` before API starts (advisory-locked, checksummed, recorded in `schema_migrations`).
- `scripts/deploy.sh` does health-gated rollout with rollback to previous image tag.

### Database
- New migrations applied incrementally by `cmd/migrate`; idempotent and transactional.
- Rollback = restore from `scripts/backup.sh` (`pg_dump -Fc` + SHA-256) via `scripts/restore.sh` (`CONFIRM_RESTORE=yes`).

## Recommended improvements to make PWA production-ready

1. **Add `vite-plugin-pwa`** — auto-generates `sw.js` with correct asset hashes, `manifest.webmanifest`, and update UI. Replaces the hand-written `sw.js`.
2. **PNG icons** — replace the single SVG icon with PNGs at 72, 96, 128, 144, 152, 192, 384, 512 px + `apple-touch-icon` for iOS.
3. **Install prompt** — listen for `beforeinstallprompt` and show an "Install app" button in the UI (especially for iOS where there's no install prompt).
4. **Push notifications** — optional, for grade-publishing alerts. Requires VAPID keys + backend push service. Can be added later without changing the PWA architecture.
5. **`manifest.webmanifest` alias** — nginx already references it; add a copy or redirect so it resolves.

## Rollout / migration path

| Phase | Action |
|-------|--------|
| Phase 1 | Fix `vite.config.ts` to include `vite-plugin-pwa`; regenerate `sw.js` with asset hashes; add PNG icons + `apple-touch-icon`; add `manifest.webmanifest` alias in nginx. |
| Phase 2 | Add install-prompt UI button + `beforeinstallprompt` handling. |
| Phase 3 (optional) | Add push notifications (VAPID) + Capacitor wrapper if app-store presence is required. |

## Validation plan

- [ ] `npm run typecheck && npm run build` passes in `frontend/`.
- [ ] `npm run build` output includes a valid `sw.js` and `manifest.webmanifest`.
- [ ] Load `https://<domain>` in Chrome Android → "Install app" prompt appears; app works offline (shell loads from cache).
- [ ] Make a CBC grading change offline → sync queue grows → reconnect → `/sync/push` drains queue → results applied server-side.
- [ ] Bump `CACHE_NAME` / rebuild → new SW activates on reload without manual cache clearing.
- [ ] `go build ./... && go vet ./... && go test -race ./internal/...` passes (backend unchanged).
- [ ] `docker compose -f infrastructure/docker/docker-compose.prod.yml --env-file .env.prod up -d --build` deploys the new `skulapp-web:<tag>`.

## Open questions (to resolve before implementation)

1. Should push notifications be in scope now, or deferred to Phase 3? (Recommended: deferred.)
2. Is app-store distribution (Google Play / Apple App Store) required, or is "Add to Home Screen" sufficient? (Recommended: PWA-only first, Capacitor later if needed.)
3. Who owns icon/asset production — SVG→PNG conversion at 72–512px?
