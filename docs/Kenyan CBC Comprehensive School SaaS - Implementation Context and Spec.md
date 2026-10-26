# Kenyan CBC Comprehensive School SaaS: Implementation Context and Spec

Brief for the coding agent. Compiled from the owner's blueprint and a long design discussion. Read all of it before touching code.

## 0. How to read this document

Every statement carries an authority tag.

- **\[SPEC\]** came from the owner's drafted blueprint. Treat as intended behavior.
- **\[DECISION\]** the owner explicitly decided it. Do not override.
- **\[PROPOSAL\]** a recommended resolution of a gap or contradiction. Implement as the default, keep it easy to change, and list it in your final report so the owner can confirm.
- **\[VERIFY\]** an external fact (law, rates, formats) that was not confirmed. Never vasive option. Ask only when a choice is irreversible.
- **Secrets and PII.** Never log M-Pesa credentials, PINs, or full phone numbers. Encrypt stored credentials.
- **Finish with a report:** what was added, what was reused, what conflicts were found, which \[PROPhardcode it. Make it configurable data or ask the owner.

Important: the author of this brief has **not seen the repository**. All code-level details below (table names, id types, framework layout) are assumptions taken from a draft schema. Section 2 tells you how to reconcile with what actually exists.

## 1. Background: what is being built and why

A multi-tenant SaaS school management system for Kenyan schools under the Competency-Based Curriculum (CBC). Competitors include EBingwa, SQUL, Zeraki, Gegohub SMS, SkulManager and Cloud School System. The differentiators the owner cares about:

- Payments by physical produce (in-kind) for boarding fees, valued automatically.
- A paper-first kitchen and store workflow that matches how Kenyan school stores really work.
- Offline-first intake, because gates and stores have unreliable networks.
- Per-school M-Pesa paybills, parent SMS/WhatsApp alerts, and a low-bandwidth parent portal.
- Very low friction onboarding, and live demos done with real data typed on the spot, not a staged simulation.

The owner is a technical solo developer, so prefer pragmatic, maintainable solutions over exotic architecture. Planned stack (**\[VERIFY\] against the repo, it may have changed**): Go ingest gateway plus Safaricom Daraja for M-Pesa, PWA with IndexedDB for offline teacher and store use, Java/Spring Boot notification engine, Africa's Talking SMS fallback, WhatsApp parent alerts, PostgreSQL with row-level security. Planned sprints: (1) webhook and payments engine, (2) grading grid and offline sync, (3) notification engine and low-bandwidth parent portal.

This brief covers the **comprehensive school scope**, the **in-kind fee engine**, the **kitchen/store reconciliation engine**, **tenant admin configuration**, the **onboarding wizards**, and the **UX and business-value layer**.

## 2. Safe implementation protocol (read twice)

The goal is to add this scope without breaking existing code.

1. **Inspect before writing.** Read the migrations folder, the ORM models, existing tenant middleware, auth, and tests. Produce a short inventory of what already exists for each concept in this brief (tenants, students, fees, inventory, wizards, audit). Do not assume the draft DDL matches reality.
2. **Match existing conventions.** Reuse the existing primary key type, naming style, money type, migration tool, and error format. If existing ids are INT or UUID, use the same in new foreign keys. Never change an existing primary key type in place.
3. **Additive migrations only.** New tables and new nullable columns first. No drops, renames, or type changes to existing columns without an explicit owner instruction. Any NOT NULL or UNIQUE added to a populated table needs a backfill step and a safe order (add nullable, backfill, then constrain).
4. **Do not rewrite working modules.** If the M-Pesa webhook engine, grading code or auth already work, extend them through new tables and new services. Do not refactor them as a side effect.
5. **Tenant context is sacred.** Every new query and endpoint is tenant-scoped. If an existing tenant mechanism exists, use it. Do not introduce a second one.
6. **Work in small vertical slices**, each with migration, service, endpoint, test. Run the existing test suite before and after each slice. Stop and report if a previously passing test fails.
7. **Conflicts.** If the repo contradicts this brief, prefer the repo for implementation details and this brief for business rules. Record each conflict in a short list and continue with the least inOSAL\] items were implemented, and which \[VERIFY\] items are pending.

## 3. Domain: the Kenyan comprehensive school

- **\[SPEC\]** A comprehensive school integrates Pre-Primary (PP1 and PP2), Primary (Grades 1 to 6) and Junior School (Grades 7 to 9) in one institution, with one Board of Management (BOM) and one principal or head of institution, assisted by deputies or senior teachers per section. It aligns with the 2-6-3-3-3 structure. Senior School (Grades 10 to 12) is **not** part of it.
- The source text is slightly inconsistent, naming Pre-Primary and then saying Grades 1 to 9. **\[DECISION\]** Model **levels as a per-tenant enabled set** (PP1, PP2, Grade 1 to 9). Never hardcode the level list. A tenant may enable any subset.
- **\[SPEC\]** Funding is treated per tier with separate sub-ledgers: Pre-Primary under devolved county frameworks (parental or county levies), Primary under Free Primary Education (FPE) capitation, Junior School under Free Day Junior School Education (FDJSE) capitation, which splits into Operational (for example repairs and maintenance, electricity, internet, personal emoluments) and Tuition (for example lab materials, assessment, stationery) accounts.
- **\[DECISION\]** Finance behavior for public versus private schools is custom-set by each school, not a fixed global mode. Therefore the funding sources and voteheads above are **editable templates** cloned per tenant, not fixed code paths. **\[VERIFY\]** All capitation amounts, votehead splits and circular rules. Store them as tenant data. Do not embed figures.
- **\[DECISION\]** Each school has its own M-Pesa paybill and may add more.
- Assessment: CBC grading must be **level-aware** (Pre-Primary, lower primary, upper primary, junior), with national assessment points at Grade 6 (KPSEA) and Grade 9 (KJSEA). **\[CONFIRMED\]** KNEC 8-point scale: EE1(90-100,8pts), EE2(75-89,7), ME1(58-74,6), ME2(41-57,5), AE1(31-40,4), AE2(21-30,3), BE1(11-20,2), BE2(0-10,1). No aggregate score; per-subject reporting only. KJSEA = 60% summative + 20% SBA (Grades 7-8) + 20% KPSEA. KPSEA uses 4 capacity bands (no points). Earlier grading work in this project was primary-focused, so check it for assumptions that break at PP or Junior level.
- **\[PROPOSAL\]** Boarding is not universal (many comprehensive schools are day schools). Treat in-kind, kitchen and boarding as **per-tenant feature flags**, and `students.is_boarder` as real data. Default should be FALSE unless a school enables boarding. The draft schema defaulted it to TRUE, so check and adjust only through a safe migration.

## 4. Tenancy model

- **\[SPEC and DECISION\]** Row-Level Security via `tenant_id` on every tenant table. The draft also mentioned schema-per-tenant or database-per-tenant. That is a contradiction. **\[PROPOSAL\]** Use one shared schema with RLS. Do not mix models.
- Required mechanics:
  - Every tenant table has `tenant_id` NOT NULL and a `UNIQUE (tenant_id, id)`.
  - Child foreign keys are **composite**: `FOREIGN KEY (tenant_id, student_id) REFERENCES students (tenant_id, id)`. The draft used single-column foreign keys, which would allow a row to reference another tenant's record.
  - `ENABLE` and `FORCE ROW LEVEL SECURITY`, with a policy using `current_setting('app.tenant_id', true)::bigint` in both USING and WITH CHECK. A missing setting must yield zero rows, not an error leak.
  - Set the tenant with `SET LOCAL app.tenant_id` inside each transaction. This matters with connection pools in transaction mode.
  - The application database role must not be a superuser and must not have BYPASSRLS. Migrations and super-admin cross-tenant reads use a separate role and a deliberate code path.
- Roles: **System Super-Admin** (tenant onboarding, subscriptions, platform analytics, health) and **School (Tenant) Admin** (fee voteheads, recipes, in-kind rates, staff roles, variance tolerances, all inside their tenant).
- Super-Admin views of tenant data are audited.

## 5. Data model

### 5.1 Draft tables from the blueprint **\[SPEC\]**

`tenants`, `in_kind_rates`, `students`, `fee_transactions` (payment\_mode CASH, MPESA, BANK\_DIRECT, IN\_KIND), `in_kind_intake_logs`, `inventory_items`, `meal_recipes`, `daily_store_requisitions` (unique per tenant and physical slip number, status RECONCILED or FLAGGED), `store_requisition_items` (expected\_qty, actual\_issued\_qty, variance\_qty, unit\_cost\_at\_time). The in-kind intake log keeps `unit_rate_applied` as a rate snapshot. Keep that behavior. Indexes by (tenant\_id, ...) exist in the draft.

### 5.2 Gaps found in the draft and the **\[PROPOSAL\]** fixes

| Gap | Why it matters | Fix |
| --- | --- | --- |
| No stock lots | FIFO and cost per plate are impossible with only `current_stock_qty` | Add `inventory_lots` and `inventory_movements` |
| No ledger tables though double-entry is required | Cannot post debits and credits | Add `ledger_accounts`, `journal_entries`, `journal_lines` |
| No voteheads or funding sources | Per-tier sub-ledgers and FDJSE splits cannot be modeled | Add `funding_sources`, `voteheads` (tenant-editable) |
| No audit table, yet audit is mandatory | Section 4 of the blueprint demands immutable logs | Add append-only `audit_events` |
| `meal_recipes` repeats the meal on every ingredient row | Denormalized | Split into `meal_recipes` and `recipe_items` |
| Requisition items do not reference the recipe used | Cannot explain the expected quantity | Add `recipe_id` to the requisition |
| `effective_term` is free text | Typos break rate lookup | Add `terms` and reference it |
| Status lacks an approval state | Hard lock needs PIN approval | Add PENDING\_APPROVAL, APPROVED, REJECTED |
| SERIAL INT keys and DECIMAL(10,2) money | Limits and rounding risk | Follow existing repo types. For new money columns use NUMERIC(14,2), quantities NUMERIC(12,3) |
| Single-column FKs | Cross-tenant reference risk | Composite FKs, see section 4 |

### 5.3 New table sketches (adapt names, types and conventions to the repo)

```sql
-- Ledger
ledger_accounts(id, tenant_id, code, name, type CHECK IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE'), funding_source_id NULL, is_active)
journal_entries(id, tenant_id, entry_date, source_type, source_id, memo, reverses_entry_id NULL, is_test BOOLEAN DEFAULT FALSE, created_by, created_at)
journal_lines(id, tenant_id, entry_id, account_id, student_id NULL, votehead_id NULL,
  debit NUMERIC(14,2) DEFAULT 0, credit NUMERIC(14,2) DEFAULT 0,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0)))
-- Invariant (service layer, inside one transaction): sum(debit) = sum(credit) per entry.
-- Entries are never edited or deleted. Corrections are reversing entries.

-- Stock
inventory_lots(id, tenant_id, inventory_item_id, received_at, source_type, source_id,
  qty_received NUMERIC(12,3), qty_remaining NUMERIC(12,3) CHECK (qty_remaining >= 0), unit_cost NUMERIC(14,4))
inventory_movements(id, tenant_id, lot_id, inventory_item_id, qty NUMERIC(12,3), unit_cost NUMERIC(14,4),
  ref_type, ref_id, created_at)  -- positive in, negative out

-- Audit (append-only: revoke UPDATE and DELETE from the app role, or block with a trigger)
audit_events(id, tenant_id NULL, actor_user_id, action, entity_type, entity_id, before JSONB, after JSONB, reason, created_at)

-- Wizards
wizard_state(id, tenant_id, wizard_type CHECK IN ('SUPER_ADMIN','SCHOOL_ADMIN'), current_step, status, draft JSONB, version INT, updated_by, updated_at,
  UNIQUE (tenant_id, wizard_type))

-- Reliable messaging (outbox, so SMS never blocks or gets lost)
notification_outbox(id, tenant_id, channel, recipient, template_key, payload JSONB, status, attempts, created_at, sent_at)
```

Supporting tables: `terms` (academic year, term number, start, end, is\_current, exactly one current per tenant), `funding_sources`, `voteheads`, `recipe_items`, per-tenant `settings` for variance thresholds and feature flags.

Every new tenant table gets the RLS pattern from section 4.

## 6. Module 1: In-kind fee payment engine

**Problem \[SPEC\].** Parents in agrarian regions pay boarding fees with produce such as maize and beans. Entering this live at a crowded gate on reporting day is slow, so the flow must be very fast and resilient.

**Flow \[SPEC\].**

1. Find the learner by admission number or by scanning a barcode or QR card.
2. Choose the commodity (maize, beans, rice, firewood, and others the school defines) and enter the quantity, in kg or in bags (a bag converts via `standard_unit_weight_kg`, for example 90 kg per bag of maize).
3. The system fetches the **active rate for the current term** set by the School Admin (example: 1 kg maize = KES 50) and computes the value (180 kg x 50 = KES 9,000).
4. Post the double entry:
   - **Debit** the Central Food Inventory asset account (+180 kg maize).
   - **Credit** the student's fee receivable under the Boarding and Catering votehead (reduces what the student owes by KES 9,000).
5. Create an `inventory_lots` row with unit cost equal to the rate applied. This is what makes FIFO and plate costing possible later.
6. Issue an instant receipt (SMS to the registered parent contact, plus printable paper receipt).

**Accounting wording note.** The blueprint called the credit a liability balance. From the school's side, an unpaid student fee is a **receivable (asset)**. The credit reduces that receivable. Use this wording in code comments and UI.

**Rules \[PROPOSAL\].**

- Snapshot the rate and the unit conversion on the intake log. Later rate changes never alter past receipts.
- The whole intake (fee\_transactions row, intake log, lot, journal entry, outbox message) commits in **one transaction**.
- Exactly one active rate per item per term. Reject intake if none exists, with a corrective action pointing to the In-Kind Rate Manager.
- Quantity and rate must be greater than zero. Reasonable upper bounds should be configurable to catch typing slips (for example 1800 kg instead of 180 kg), as a soft warning that needs confirmation.
- Voiding is a reversing journal entry plus a stock movement that removes the lot quantity (blocked if that quantity was already consumed, and then escalated to an adjustment with a reason).
- Optional quality note per intake (for example rejected or damp grain) is a nice-to-have, not part of the core.

## 7. Module 2: Kitchen and bulk cafeteria engine

**Problem \[SPEC\].** Kitchens cook in bulk for hundreds of boarders, so per-student ration tracking is unrealistic. Storekeepers and head cooks use carbonized counterfoil requisition books early in the morning, not computers.

**Paper-first, deferred entry \[SPEC\].**

1. Storekeeper and head cook fill and sign a paper slip (for example Slip #1042: 60 kg maize, 40 kg beans).
2. Later, a clerk or bursar opens the Daily Store Batch Entry screen and enters: slip number (unique per tenant), date, meal type, menu item (for example Githeri), and the issued quantities from the slip.
3. The system pulls the **active boarder count N** and the admin-configured recipe scale per 100 students, then computes expected usage. Example: N = 400 and maize 15 kg per 100 gives expected 60 kg.
4. It compares expected versus actual issued and acts on the variance band.

**Variance bands.** The blueprint says at most 5 percent is normal and above 10 percent is abnormal, leaving 5 to 10 percent undefined, and Module 3 says thresholds are configurable. **\[PROPOSAL\]**

- `variance_pct = abs(actual - expected) / expected` per ingredient. If expected is 0 and actual is above 0, treat it as hard lock.
- Tenant settings: `soft_threshold_pct` (default 5) and `hard_threshold_pct` (default 10). Validate soft is less than hard.
- Up to soft: **OK**. Deduct stock by FIFO and compute cost per plate.
- Above soft up to hard: **soft warning**. Deduct, mark FLAGGED, notify the bursar.
- Above hard: **hard lock**. Save as PENDING\_APPROVAL, notify bursar and principal, and require a **supervisor PIN with a typed reason** to approve or reject. **Open question for the owner:** should stock deduction wait for approval (proposed, inventory shows pending issues) or post immediately and only flag? Implement behind one setting so either works.
- Use the boarder count **snapshot** stored on the requisition (`boarder_count_fed`), not a live count later.

**FIFO and costing \[PROPOSAL\].** Consume lots ordered by `received_at, id`, lock the lot rows (`FOR UPDATE`) inside the transaction, split an issue across lots when needed, write an `inventory_movements` row per lot touched, and compute `unit_cost_at_time` as the weighted cost of what was consumed. Cost per plate is total consumed cost divided by `boarder_count_fed`. If stock is insufficient, block with a corrective message unless a supervisor override is given, and log it.

**Recipes.** `meal_recipes` (meal name, meal type BREAKFAST, LUNCH, SUPPER or TEA\_SNACK) plus `recipe_items` (inventory item and quantity per 100 students). Nothing is hardcoded. All ratios come from the tenant's own recipes.

## 8. Module 3: Tenant admin configuration screens \[SPEC\]

No code changes are needed to customize operations.

- **In-Kind Rate Manager:** add commodities, units, standard bag weight, rate per unit per term. Offer a copy-last-term shortcut.
- **Kitchen Menu and Recipe Builder:** daily menus and raw ingredients per 100 students.
- **Audit and Variance Controls:** soft and hard percentage thresholds and the supervisor PIN holders.

All configuration writes produce audit events.

## 9. Offline-first intake \[SPEC and PROPOSAL\]

If the network drops, intake data goes to IndexedDB in the PWA and syncs through a background queue.

- Each offline record gets a **client-generated UUID** used as an idempotency key (unique per tenant). A retry returns the existing record and never double-posts.
- Offline receipts carry a **provisional number**, replaced or mapped to the official sequence on sync. Official receipt numbers are allocated server-side per tenant.
- Store the rate snapshot with the record. On sync, if that rate was valid at the recorded time, accept it. If a rate changed in between and they disagree, flag for bursar review rather than silently rewriting a value the parent was already told.
- Sync conflicts and rejections surface in a visible Sync Issues list with fix actions. Never drop a record silently.
- SMS is sent from the outbox after commit, so offline intakes notify the parent only once they are really posted.

## 10. Decision: seed data versus wizards

The owner asked whether seed data is truly required, since live demos with real data typed on the spot feel more convincing than a staged simulation. Resolution:

- **Bootstrap (reference) data is required.** Without roles, permissions, level set, votehead templates, grading scales and term structure the system breaks. **\[DECISION\]** Generate it **per tenant by the wizard from templates**, not as one global seed.
- **Demo (sample) data is optional.** Do not require it. An optional Generate sample data button exists in the wizard and is **off by default**.
- **Demo-safe tenants \[PROPOSAL\].** A tenant flag `is_demo` shows a banner and enables snapshot and one-click reset, so live-entered demo data can be wiped. Test transactions are marked `is_test`, voidable, and excluded from reports and exports.

## 11. Onboarding wizards

### 11.1 Shared mechanics \[PROPOSAL\]

- Server-side draft in `wizard_state` so any step can be resumed from any device.
- Each step commits atomically and is idempotent. Every commit writes an audit event.
- Dependency graph, not a rigid order. A step is blocked only if something it needs is missing, and the message names it with a jump link (example: In-kind rates need a current term. Set up terms).
- Three severities: **blocking**, **warning** (acknowledge to continue), **info**.
- API errors use one shape: `{code, field, message, fix_action}`. The UI renders `fix_action` as a button that opens the exact fix.
- Smart defaults from templates and the previous term. The admin mostly confirms.
- A readiness score on the dashboard that doubles as the go-live gate.

### 11.2 Wizard 1: Super-Admin (tenant provisioning)

1. **Identify school:** name, county, optional NEMIS code. Block duplicates by fuzzy name match plus code. Warn on near matches.
2. **Subdomain:** lowercase letters, digits and hyphens, 3 to 30 characters, no leading or trailing hyphen, reserved words blocked (admin, api, www), live availability check, suggested alternatives from the school name.
3. **Plan:** tier, billing basis (per student per term), trial dates (end after start), student cap for capped tiers, `is_demo` flag.
4. **Modules (feature flags):** boarding, in-kind, kitchen, M-Pesa, SMS/WhatsApp. Enforce dependencies: kitchen requires boarding and inventory, in-kind requires inventory. Auto-enable what is required and say why.
5. **First School Admin:** name, email, phone. Normalize Kenyan phone numbers to one canonical format (E.164 style). No collision with existing admins. Expiring invite link, 2FA on first login.
6. **Review and provision:** one transaction creates the tenant, sets RLS context, clones templates (roles, level set, votehead templates, grading scales), creates the admin and writes the audit event. On failure roll back fully and show which stage failed. Then run an **isolation smoke test** (a query under the new tenant context returns zero rows from other tenants). Mark ACTIVE only if it passes.

### 11.3 Wizard 2: School Admin

1. **School profile:** logo, contacts, NEMIS code (see section 12). School type (public, private, other) is only a label that pre-picks templates and never locks behavior.
2. **Structure:** enabled levels (PP1 to Grade 9), classes and streams. At least one level. Class names unique per level.
3. **Calendar:** academic year and terms. No overlap, inside the year, exactly one current term, default three terms.
4. **Funding and fees:** funding sources, voteheads per level, fee structure per level per term. Votehead amounts must sum to the fee total. Each enabled level needs a structure or an explicit no-fees choice. Capitation splits must reconcile to their totals.
5. **Payments:** one or more paybills, purpose mapping, account number format. Digits only. **\[VERIFY\]** length rules with Safaricom. A Send test callback button with live status. Credentials encrypted and never shown again.
6. **Stores and in-kind (if flagged):** items, units, bag weight, rate per unit per term. Rate and bag weight above zero. Warn if a rate moved by more than a set percentage from last term.
7. **Kitchen (if flagged):** menus, ingredients per 100 students, thresholds (soft below hard), supervisor PIN holder must hold a supervisor role.
8. **People:** staff, roles, invites. At least one bursar and one principal. Warn if stores are enabled but no storekeeper exists.
9. **Learners and guardians:** import or add one (flow below).
10. **Opening balances (optional):** arrears per learner per votehead and opening stock. Post as journal entries and opening lots, never as direct edits. Totals must reconcile before commit.
11. **Notifications:** sender ID and SMS templates. A test SMS is required before enabling parent alerts.
12. **Go-live check:** blocking items must clear. Offer a voidable **test transaction** to prove the full path end to end.

### 11.4 Import flow (learners and guardians)

Download template, upload, map columns (auto-detect headers), validate per row (admission number unique per tenant, level exists, phone normalized, probable duplicates flagged by name plus guardian phone). **Commit valid rows and hold the bad ones**, with a downloadable error report and a fix-and-retry loop, so one bad row never blocks the batch. Match guardians by phone so one guardian can link to several children.

## 12. NEMIS code: accepted, never required \[DECISION\]

- Optional field **School code (NEMIS)** on the school profile and on Super-Admin step 1. It counts toward a separate Polish list, not toward the go-live gate.
- Validation: trim, uppercase, remove spaces. **\[CONFIRMED\]** NEMIS school code is a 4-character alphanumeric UIC (e.g., `LVR8`, `6WF4`). Accept up to 4 chars; do NOT enforce a regex pattern. KEMIS (Kenya Education Management Information System) is replacing NEMIS as of 2026; treat both as optional identifiers.
- Uniqueness through a partial unique index on `upper(nemis_code)` where not null. If a code is already registered, return `NEMIS_CODE_IN_USE` with the fix action Contact support. **A school admin must never see the other school's name** (tenant data leak). Only the Super-Admin sees the match.
- The Super-Admin duplicate check treats a present code as a strong signal and otherwise falls back to name plus county.
- Records who entered it and when. Show a Verified badge **only if** a real lookup integration is built, and never imply a Ministry lookup happened.
- Printed receipts, report headers and exports show the code **only when present**, never N/A or an empty slot.

```sql
ALTER TABLE tenants ADD COLUMN nemis_code VARCHAR(40), ADD COLUMN nemis_recorded_by BIGINT, ADD COLUMN nemis_recorded_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_tenants_nemis ON tenants (upper(nemis_code)) WHERE nemis_code IS NOT NULL;
```

UI copy: label **School code (NEMIS)** with a muted Optional tag. Helper: Have it handy? Add it now. You can also add it later in School Profile. Absent state: No school code on file. Add your NEMIS code to include it on official reports and exports.

## 13. UX and business-value layer

**Audience:** school boards and administrators across generations, from older board members to millennial staff. The interface must feel professional, clear and calm, and communicate ROI, quality and ease of use without clutter.

- **Plain words first.** Needs your attention for flagged variance, Fees collected for ledger credits. Technical terms are one click deeper for the bursar.
- **Four to six headline numbers** per board view. Details on demand.
- **Legibility as a quality signal:** base text 16px or larger, WCAG AA contrast, labeled buttons, no icon-only actions. Red only for real exceptions.
- **Board Pack:** one-tap, one-page PDF summary for paper-driven boards.
- **Visible accountability:** figures can show recorded by and when.
- **Wizard finish:** a calm Your school is ready screen listing what was set up. No confetti.
- **Empty states** always state what the area is, why it matters, and one next action. Examples: In-kind rates: Set what each commodity is worth this term and every delivery is valued automatically (Add first rate). Requisitions: Once the store issues its first slip, expected versus actual usage appears here. Arrears: Starting fresh? Nothing to do. Carrying balances forward? Import opening balances.

**Value ledger \[PROPOSAL\].** Business value is shown as short, quotable statements that are **computed from the tenant's own data**, with the source visible on hover. Boards distrust invented figures, so never display a made-up statistic. Examples with their sources:

- n receipts issued automatically this term (fee\_transactions and notification logs).
- KES x received in produce and valued instantly at your set rates (in\_kind\_intake\_logs).
- n store issues checked against recipes, k needed attention (daily\_store\_requisitions).
- Every adjustment recorded: who, when, why (audit\_events count).
- Fee balances reconciled to the shilling across the enabled levels (ledger totals).
- Term closed in d days (term dates).

Estimates, such as hours saved, must be labeled as estimates, be based on assumptions the client edits, and appear only where value just happened: wizard completion, the Board Pack header and the term-close summary. Not as a banner on every page. An optional Kiswahili version of parent-facing messages is welcome, using an i18n key and string table.

## 14. Open questions and VERIFY list

1. Does hard-lock approval hold stock deduction or post and flag? (Section 7. Implement as a setting.)
2. Real NEMIS code format and whether any Ministry lookup will ever exist.
3. Safaricom paybill: 5-7 digits (confirmed). Account number: merchant-defined, up to 14 digits. Store as tenant data.
4. Current FPE and FDJSE capitation rules and votehead splits. Store as tenant data only.
5. Exact CBC performance scales by level and the KPSEA and KJSEA rules — **CONFIRMED**: KNEC 8-point scale (EE1=90-100/8pts … BE2=0-10/1pt). No aggregate score; per-subject reporting only. KJSEA = 60% summative + 20% SBA (Grades 7-8) + 20% KPSEA. KPSEA uses 4 capacity bands. No `cbc_scales` table needed; use official scale directly.
6. Whether the repo already has wizard, audit, ledger or inventory tables that should be extended instead of added — **CONFIRMED**: None existed; all new tables created (migrations 0011-0018). No extensions needed.
7. Actual primary key and money types in the repo — **CONFIRMED**: UUID for IDs, `numeric(12,2)` for money, `numeric(12,3)` for quantities. Composite PKs `(tenant_id, id)` on new tables.

## 15. Acceptance checks

- Cross-tenant isolation: a query under tenant A returns no tenant B rows, and a composite FK rejects a cross-tenant reference.
- In-kind: 180 kg at 50 per kg creates a 9,000 credit, a 180 kg lot, a balanced journal entry and one outbox message, all in one transaction. Retrying with the same client UUID changes nothing.
- Rate change after intake does not alter prior receipts.
- Kitchen: with N = 400 and 15 kg per 100, expected is 60 kg. 62 kg is OK, 65 kg is a soft warning, 70 kg is a hard lock requiring a PIN and a reason. Expected 0 with actual above 0 hard-locks.
- FIFO consumes the oldest lot first and splits across lots correctly. Insufficient stock blocks with a corrective message.
- Void creates a reversing entry and never deletes.
- audit\_events cannot be updated or deleted by the application role.
- Wizards: a half-finished wizard resumes on another device. A bad import row does not block valid rows. Provisioning rolls back cleanly on failure.
- A tenant with no NEMIS code still reaches go-live. A duplicate code never reveals another school's name to a school admin.
- The existing test suite passes before and after every slice.
