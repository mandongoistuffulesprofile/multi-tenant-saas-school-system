# Handover — visual verification of the CBC banner and the payments dialog

Two changes are covered by jsdom tests but have **never been rendered in a real
browser**, because this workspace has no Redis, so the API cannot start:

| Change | Test | What a test cannot tell you |
| --- | --- | --- |
| CBC offline queue now says the marks are local and sends nothing | `frontend/src/components/CBCRubricAssessment.test.tsx` | that the amber notice is visible, not clipped by the table, and that nothing fires in the network panel |
| Payments dialog translated to `finance.payments.*` incl. the busy refusal | `frontend/src/pages/FinancePaymentsPage.test.tsx` | that the Kiswahili layout fits, the amber busy panel reads well, and the language switch actually changes it |

Both are text-asserted. This pass is about pixels and real network calls only —
do not re-test the logic, and do not weaken the two suites above.

## 1. Stack

```bash
# Postgres + Redis must be running locally.
cd backend
cp -n .env.example .env          # DATABASE_URL, REDIS_URL, JWT_SIGNING_KEY
go run ./cmd/migrate -dir ../migrations -seed

# One persona per role you need (teacher for CBC, bursar for payments):
DATABASE_URL=... DEV_EMAIL=teacher@demo.test DEV_PHONE=254700000002 \
  DEV_ROLE=TEACHER DEV_TENANT=demo-school DEV_PASSWORD='...' go run ./cmd/devuser
DATABASE_URL=... DEV_EMAIL=bursar@demo.test DEV_PHONE=254700000003 \
  DEV_ROLE=BURSAR DEV_TENANT=demo-school DEV_PASSWORD='...' go run ./cmd/devuser

go run ./cmd/api        # :8080, needs Redis
cd ../frontend && npm ci && npm run dev   # :5173, proxies /api -> :8080
```

Set the UI language to Kiswahili (header toggle) for the payments checks — the
dialog should follow it, which is the point of the translation.

## 2. CBC offline queue — `/cbc-assessment` as TEACHER

1. Pick a sub-strand and tap a level for one learner (e.g. `ME`).
2. Expected: the control reads **“1 change saved on this device”** with the small
   amber line **“Online sync not available yet”** beneath it.
3. Press it. Expected: an amber panel above the table reading
   **“Online sync is not available yet. 1 change are saved on this device and will
   be kept until sync is enabled.”**
   - Grammar bug to fix if you see it: `1 change are` — the sentence is assembled
     from `${n} change${n===1?'':'s'} are saved`; singular needs “is saved”. Fix in
     `frontend/src/components/CBCRubricAssessment.jsx` (`triggerSync`) and add the
     singular case to the jsdom test.
4. Open DevTools → Network, reload, tap another level, press the control. Expected:
   **no request to `/api/v1/assessments/...` at all**; only IndexedDB writes.
5. Expected: nothing overflows the table at 360px width (the notice sits between
   the header and the table).

## 3. Payments dialog — `/finance/payments` as BURSAR

1. Press **Rekodi Malipo**. Every label should be Kiswahili: Mwanafunzi, Kiasi
   (KES), Njia, Kumbukumbu (si lazima), Ghairi, Rekodi.
2. Switch the language to English and reopen: the same dialog should read Learner,
   Amount (KES), Method, Cancel, Record. If it does not change, the keys under
   `finance.payments.*` in `frontend/src/i18n/translations.ts` are not being read
   by this page.
3. **Reproduce the busy refusal** (needs two sessions; the API refuses after 3s):

   ```sql
   -- session 1 (psql): hold the invoice row
   BEGIN;
   SELECT set_config('app.current_tenant_id', 'demo-school', true);
   SELECT invoice_id FROM invoices
    WHERE tenant_id = 'demo-school' AND amount_outstanding > 0
    LIMIT 1 FOR UPDATE;
   ```

   Then submit a payment in the UI with no invoice selected. Expected after ~3s:
   the amber panel with **“Malipo mengine yanawekwa kwenye ankara hii kwa sasa.
   Jaribu tena baada ya muda mfupi.”** and buttons **Jaribu tena** / **Ondoa**;
   the typed amount is still in the field; **no error toast**.
4. `ROLLBACK;` in psql, then press **Jaribu tena**. Expected: success toast
   **“Malipo yamerekodiwa”**, the dialog closes, and the payment appears in the
   table. This is the path no test can prove end to end.
5. Check the panel at 360px: message and both buttons should stay on screen.

## 4. Optional — fill the three missing screenshots

`scripts/ui-screenshots/routes.mjs` declares 74 images and three have never been
captured: `33-admin-cbc-assessment.png`, `36-admin-report-card-print.png`,
`40-admin-bom-oversight.png`. With the stack up:

```bash
node scripts/ui-screenshots/check-routes.mjs
node scripts/ui-screenshots/capture.mjs --dry-run
node scripts/ui-screenshots/capture.mjs --replace
```

`/cbc-assessment` is one of the three, so this pass produces it. Review the images
before promoting; the README warns that a host without fonts produces wordless but
plausible screenshots (point `FONTCONFIG_FILE` at the bundled config).

## 5. Commit what you fixed

Follow the repository's cadence: one coherent slice, explicit `git add <paths>`
(never `-A`), imperative subject, body describing the verified behaviour. If the
push is rejected, `git fetch origin main` and merge before pushing again.

Report back: which of the two screens you saw, any wording/layout defect found and
fixed, and the screenshot paths if you captured them. If something could not be
checked (no bursar persona, Redis missing), say so rather than marking it done.
