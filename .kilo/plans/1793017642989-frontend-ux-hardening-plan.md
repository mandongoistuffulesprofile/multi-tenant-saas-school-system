# Frontend UX Hardening Plan

## Context
- Stack: Vite + React 18 + Tailwind + i18next + Zustand + axios
- Phase 2 scope explicitly excluded frontend; backend RLS/tx refactor complete and green.
- Concern: no obvious offline-first support, no retry/interceptor layer, unproven error/empty/skeleton states → risk of hard crashes and poor offline behavior.

## Decisions (to confirm)
1. Keep frontend out of Phase 2 commit scope; treat as separate Phase 3.
2. If implemented: add axios retry/offline queue, error boundaries, skeleton/empty states, i18n fallback messages, optimistic updates where safe.
3. Offline-first: register service worker (or use existing serviceWorkerRegistration.ts), cache critical shell, queue mutations for sync on reconnect.

## Risks
- Changing frontend risks breaking existing i18n/routes; must keep `/platform/*`, `/health`, `/webhooks/*` unaffected (backend only).
- No test files observed for frontend; add tests before/with UX changes.

## Validation
- `cd frontend && npm run typecheck && npm run build`
- Manual offline/API-down smoke test for hard-crash vs graceful failure.

## Open question
Proceed with Phase 3 UI/UX plan? (Recommended: yes, after backend Phase 2 is fully merged.)