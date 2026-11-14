# UI screenshots

Replaces `docs/ui-design/screenshots/` with current, browser-accurate captures of
every route in `frontend/src/App.tsx`, driven by `puppeteer-core`.

```bash
# 1. Stack up: Vite on :5173 proxying /api to :8080, seeded demo tenant.
# 2. Check the manifest still matches the router (fails on drift):
node scripts/ui-screenshots/check-routes.mjs

# 3. See the plan without launching a browser:
node scripts/ui-screenshots/capture.mjs --dry-run

# 4. Capture into docs/ui-design/screenshots.new and validate:
node scripts/ui-screenshots/capture.mjs

# 5. When every route passed, promote over the old set:
node scripts/ui-screenshots/capture.mjs --replace
```

## Files

| File | Purpose |
| --- | --- |
| `routes.mjs` | The manifest: path, output filename, persona, waits, assertions. |
| `check-routes.mjs` | Parses `App.tsx` and fails if the manifest and the router drift apart. |
| `capture.mjs` | Logs in per persona, captures, asserts, and promotes only after a clean run. |

## Preflight

Before any persona work, the run checks four things and stops with a single
message if any is missing — nothing is captured and nothing is replaced:

| Check | How | If it fails |
| --- | --- | --- |
| Chrome | executable at `--chrome` | install Chrome or pass `--chrome /path` |
| API | `GET <api-url>/health/ready` (also pings PostgreSQL and Redis) | start the API, or start the named dependency |
| dev server | `GET <base-url>/` | `cd frontend && npm run dev` |
| puppeteer-core | module loads from `--puppeteer-root` | `npm install puppeteer-core`, or point `--puppeteer-root` |

`/health/ready` returns 503 naming the dependency that is down, so a half-up
stack reports `API … answering, but its database is unreachable` with the
PostgreSQL hint rather than a wall of per-page 500s. `--dry-run` skips the
preflight, since it does not touch the network or the browser.

## What a run checks per route

- document response is not 4xx/5xx, and no API call on the page returned 5xx
- the page is not the not-found route, which catches a route that exists in
  `App.tsx` but was dropped from the build. The harness looks for
  `NotFoundPage`'s `data-page="not-found"` element first, so the copy can be
  translated or reworded without breaking the check; only when that element is
  absent (a build older than the marker) does it fall back to matching "404"
  and "Page not found"
- the visible text is at least `minText` characters (default 120), so a blank
  shell cannot pass
- optional `expectText` / `waitForText` from the manifest
- the PNG is at least 10 KiB (a white rectangle usually is not)

Failures are printed, the run exits 1, and **the old screenshots are left
untouched** — promotion only happens on a fully green run with `--replace`.
`--replace` copies the old PNGs to `docs/ui-design/screenshots.previous/`
before writing, then deletes PNGs that the new set does not contain (nothing
else in the directory is touched). Use `--no-backup` to skip the copy.

Each run also writes `screenshots.new/capture-report.json` and prints, per
screenshot, the visible text length and the first 70 characters — enough to
confirm from the terminal that a shot shows the page you meant, without opening
the image.

## Personas

Login is `POST /api/v1/auth/login` against `--api-url`, then the returned
cookies (`access_token`, `refresh_token`, …) are set on a fresh browser context
per persona, so sessions never leak between captures. Credentials live in
`routes.mjs` and are the dev-only demo accounts.

| Persona | Account | Covers |
| --- | --- | --- |
| `public` | none | login, forgot/reset password, parent activation |
| `admin` | `admin@demo.test` | admin shell, finance, compliance, comms, reports |
| `teacher` | `teacher@demo.test` | `/teacher/*` |
| `parent` | `parent@demo.test` | `/parent/*` |
| `platform` | `platform@demo.test` | `/platform/*` |

Param routes are resolved at runtime: `/reports/cards/:card_id/print` takes the
first card from `GET /api/v1/reports/cards`, `/platform/tenants/:tenantId/setup`
the first tenant from `GET /api/v1/platform/tenants`. Override with
`--report-card-id <uuid>` / `--tenant-id <id>`; if nothing resolves, that route
is skipped (and reported) rather than photographed blank.

## Notes and gotchas

- `/cbc-assessment` and `/bom-oversight` sit behind `import.meta.env.DEV`, so
  a production build (`vite preview`, or a deployed bundle) has no such route
  and the `*` fallback answers with the not-found screen. Those entries are
  marked `devOnly`: when the not-found screen appears the route is **skipped**
  with `dev-only route: this build serves the not-found page — start the
  frontend with npm run dev to capture it`, not failed on `minText`. The run
  still succeeds, and `--replace` keeps any existing PNG for a skipped route
  instead of deleting it as stale. Capture against `npm run dev` to refresh
  those two images.
- Redirect aliases (`/fees`, `/invoices`, `/record-payment`, …) and `*` are in
  the manifest as `skip` entries, purely so `check-routes.mjs` can prove every
  declared route has been considered.
- `--only <regex>` captures a subset for a quick re-take, e.g.
  `--only '^/finance/'`.
- The default `--chrome` is `/usr/bin/google-chrome`; pass `--chrome` if your
  browser is elsewhere. `--puppeteer-root` defaults to `/tmp/kilo/shots`, the
  module directory that provides `puppeteer-core`.
- Output and backup directories are git-ignored; only the promoted PNGs in
  `docs/ui-design/screenshots/` belong in a commit.
