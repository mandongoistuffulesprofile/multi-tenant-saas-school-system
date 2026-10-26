# M-PESA FORENSIC LEDGER — AMENDED SPECIFICATION
**Status: IMPLEMENTED (Round 3) · Supersedes the original "Transaction Audit Log #QHK8921JK" report**

Original report sections are quoted below where amended. Every amendment reflects code
that is live in this deployment — nothing here is aspirational.

---

## 1. VERIFICATION & CRYPTOGRAPHY (amended)

**Original report said:** *Cryptographic Stamp: SHA-256: `4a2f8b...e91a` [Copy Immutable Proof].*

**Why amended:** a lone SHA-256 fingerprint of a payload proves nothing by itself.
Anyone with DB write access (or an insider) can edit a row and re-hash it silently.
The institutional control is an **append-only, hash-chained ledger keyed with a secret
only the server holds**:

```
hash(n) = HMAC-SHA256(secret, seq(n) | prev_hash | CANON(event))
hash(1) = HMAC-SHA256(secret, "1|GENESIS|CANON(event)")
```

- Secret: `app_secrets` (single row, md5-of-session-random generated at bootstrap);
  production deployments may inject `LEDGER_HMAC_KEY` env override.
- Append-only is **DB-enforced**: a trigger on `ledger_events` raises an exception for
  any `UPDATE` or `DELETE` — an insider with direct DB access cannot rewrite history
  without the query itself failing.
- Per-tenant chains (`ledger_chain_state.last_seq/last_hash`) with
  `SELECT … FOR UPDATE` on the chain state row inside a single transaction, so
  concurrent ingests cannot fork the chain.

**Live endpoints:**
- `GET /finance/ledger/verify` → recomputes the whole chain from GENESIS
  (`{valid, depth, broke_at, chain_head.integrity: VERIFIED|MISMATCH}`).
- Copy-immutable-proof ships in the forensic drawer as
  `seq|event_type|hash` per chain entry.

## 2. WEBHOOK FACTS TABLE (amended)

**Original report said:** rows implied a raw C2B table already existed.

**Amend:** before this round there was **no raw C2B table**. Now:

`mpesa_c2b_events` — one row per Safaricom receipt, idempotent on
`UNIQUE (tenant_id, trans_id)`:
`trans_id, trans_time, trans_amount, business_short_code, bill_ref_number,
msisdn_masked, sender_name, raw_payload (JSONB), status, student_id, ingest_source`

- `ingest_source ∈ {WEBHOOK, BACKFILL, SEED}` — visible in the UI header so an
  auditor knows every row's origin.
- **MSISDN masking retained from your report** (`254712****89`) applied at ingest.
- **TransTime is EAT (UTC+3)**: `20261026140211` renders as `26-10-2026 14:02 EAT`
  in the drawer (your Network-timestamp UTC conversion was correct).

**Simulator:** `POST /finance/mpesa/simulate-webhook` (admin only) pushes a labelled
demo receipt through the **real** pipeline (match → postings → chain). No restart
hacks, no bypass.

## 3. GENERAL LEDGER (amended)

**Original report said:** `GL-1010 (Asset)`, `GL-1200 (A/R)` as flat constants.

**Amend:** accounts live in a **seeded chart-of-accounts table** per tenant
(`chart_of_accounts`, idempotent seed):

| code | name | type |
|------|------|------|
| 1010 | M-Pesa Paybill Settlement | ASSET |
| 1200 | Accounts Receivable — Education | ASSET |
| 2100 | Suspense — Unallocated Receipts | LIABILITY |
| 4100 | Tuition & Other Fees Income | INCOME |

Double-entry (`ledger_postings`), each pair bound to the **chain event** (not the C2B
row) so postings inherit the hash):

- Ingest, payer identified: **Dr 1010 / Cr 1200** → status `ALLOCATED`.
- Ingest, no match: **Dr 1010 / Cr 2100** → status `SUSPENSE`.
- Resolve (`PATCH /finance/mpesa/events/:id/resolve`):
  **Dr 2100 / Cr 1200**, status → `ALLOCATED`, ledger receipt folded into
  `payments` (source MPESA) and `fee_balances.total_paid`.
- Resolve is **idempotent-guarded**: a second resolve returns `409 Already allocated`.
- The forensic drawer renders the full posting history so the resolve pair is as
  visible as the original ingest pair.

## 4. ORPHAN AUTO-RESOLVER (unchanged in intent, implemented)

- Matching: ADM-normalisation on BillRef (`ADM8821`/`ADM 0882`/`adm-0882` all match)
  → exact hit = 100 score; else **name-similarity score** (Levenshtein ≤ 28% edit
  distance on tokens across student + guardian names), threshold 40%,
  top-5 ranked suggestions with basis string ("ADM number in bill reference" /
  "name similarity").
- One-click **Verify & Reconcile to Student Account** posts the GL move, appends the
  `C2B_RESOLVE` chain event, and toasts the ledger seq — the auditor-visible
  confirmation that money, GL and chain moved atomically.
- No confident match → drawer says manual allocation required (no silent auto-post).
- All actions land in `audit_log` (visible in **Platform Audit**).

## 5. GATEWAY DIAGNOSTICS BAR (amended)

**Original report said:** fixed `14ms` / `99.98%` figures.

**Amend:** fabricated latencies are exactly the kind of number an auditor sniffs out.
The bar now shows only **derived-from-real-rows** facts:

`● Last webhook: 5m ago · STK queue: 2 pending · Receipts allocated 4/5 (80%) ·
⇅ Hash chain 6 events · SHA-256 VERIFIED`

Daraja keys are tenant-configured in Integrations; without live Daraja credentials the
bar honestly shows what exists (backfill/simulated traffic ages and all).

## 6. BOARD PACK (amended)

**Original report said:** "dynamic cryptographic QR code" on exported PDFs.

**Amend (dependency decision):** no third-party QR/image library was approved; shipping
a hand-rolled QR encoder is a correctness risk we refuse. Live substitute:

- `/finance/board-pack` — print-optimised (⌘P / Save as PDF via native print CSS;
  chrome hidden with `body.printing-pack` rules).
- Every figure set comes from real invoices/payments; the document carries a
  **24-char verification code** = HMAC of the canonical pack envelope.
- Verification: `GET /finance/board-pack/verify?code=…` recomputes and compares —
  any edit to underlying finance data invalidates the stamp. Tamper-evidence
  property preserved; only the *visual* QR glyph is deferred (documented upgrade).

## 7. UI ENGINE (amended from the manifesto)

Built natively, zero new dependencies as mandated:

| Manifesto item | Amended implementation |
|---|---|
| Inter/Geist + JetBrains Mono | Existing system stack + **`financial-data`** CSS: `font-feature-settings: "tnum","zero"`, `tabular-nums slashed-zero`, `-0.02em` tracking — fixed-width digits without a font install |
| Cmdk / Radix dialog | Native `Ctrl/Cmd+K` keydown palette: `receipt:QHK…` → opens that forensic drawer via `?focus=`, `learner:` → directory, bare text → page names |
| TanStack Table virtual | Existing DataTable + **Compact/Comfortable density toggle** (`py-1.5 text-xs` vs `py-3`) |
| Tailwind `rounded-md` card | **`.enterprise-card`**: 1px hairline border, zero box-shadow, 6px radius |
| Next.js migration | **Refused this round** — shipped product is a Vite SPA; migration is a separate architectural project (documented, not slide-ware) |
| Webhook pulse indicator | Emerald row highlight on fresh receipts + live sidebar badges (learner count, invoice count, M-Pesa sync %) |
| Destructive-action typing guard | Impersonation requires a typed **reason** (goes to Platform Audit); ledger resolve is idempotency-guarded instead of confirm-spam |

**Multi-tenant workflow audit fixes (same round):**

- SaaS console desk was a **hardcoded 3-fake-school demo** → now live: real tenants,
  learner/staff rolls, MRR derived from actual plan pricing (BASIC 0 / STANDARD
  9,900 / ENTERPRISE 24,900).
- "Login As" was a **fake toast** → now mints a real `imp:true` JWT scoped to the
  tenant, stashes the platform session, shows an
  `AUDIT SESSION: viewing <school>` banner with one-click **Exit Impersonation**
  that restores the platform token. Suspended tenants are refused (verified 403).
- Onboard wizard demanded no admin email and wrote nothing → now creates the
  tenant **and** the school-admin login server-side, returning the one-time
  temporary password in the success toast.
- Subscriptions page showed a raw tenant UUID as "School Code" → joined to
  `school_name` + `subdomain`.

## 8. DOCUMENTED UPGRADE PATH (not built — by decision, listed for future rounds)

1. **QR glyph** on board pack via an audited QR library (needs dep approval).
2. **Zod** validation of full Daraja 2.0 callback envelope at the webhook edge.
3. **TanStack Table + virtual** for 50k-row settlement scrolling.
4. **Public third-party verifier** — a no-login `GET /verify/:code` endpoint that
   renders pack integrity verdicts for donors, plus the QR linking to it.
5. Dark mode (`zinc-950`) — explicitly deferred (light-mode-only decision).
6. Donor **ring-fenced fund ledger** (dual-payer splits per learner) — data model
   not present; needs payer-split fields before any UI promise.

## 9. LIVE INTERCONTROLS SUMMARY (as of writing)

- Chain: 7 events, `valid: true`, `chain_head.integrity: VERIFIED`;
  seq 3 = QHK8921JK ingest (suspense), seq 4 = resolve, seq 5–7 = simulated orphans
  (# killed by resolve during QA); 2 backfilled receipts at #1–2.
- Board-pack stamp rotates with data (observed `D74741FD…` → `1BB9C501…` after the
  QA resolve) — the expected behaviour for an envelope-hash.
- BOM Oversight is **real-only**: enrollment, teachers/TLR, attendance %, NEMIS/UPI
  gap, live collection engine, and an honest *“capitation not tracked in this
  system yet”* block — the gender-parity and Akaunti-1/2 walls were removed rather
  than faked.
