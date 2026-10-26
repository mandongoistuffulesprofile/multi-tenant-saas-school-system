# Kenyan School Marks Entry: Ground Truth vs. Implementation

## 1. The Reality on the Ground

In a typical Kenyan school (CBC primary / junior secondary), **individual subject teachers rarely sit at desktop computers to type marks**. The actual flow is:

1. **Subject teacher** hand-writes raw scores on a physical mark-sheet or printed broadsheet (KPSEA/KJSEA continuous assessments use rubric bands: EE, ME, AE, BE, plus raw scores out of 50/100).
2. **Director of Studies (DOS), school clerk, or trusted student assistant** (lab captain / senior prefect) is tasked with re-typing those paper sheets into a computer.
3. The **clerk/DOS** cleans up errors and presents the final summary to the **Headteacher** for approval before uploading to the official KNEC CBA portal or printing report cards.

### Why the "corporate SaaS" model fails here
- **Per-subject isolation** forces the clerk to open 9 separate screens for one broadsheet → 10× slower.
- **Individual teacher logins** result in password sharing anyway (teachers give credentials to students to avoid typing).
- **Aggregate ranking** (1st, 2nd, 3rd) violates CBC guidelines; per-subject achievement levels are required.

---

## 2. Architectural Risks of the Ground Reality

| Risk | Cause | Impact |
|------|-------|--------|
| **Typo injection** | Manual re-keying (85 → 58, 880 instead of 88) | Corrupted report cards, KNEC portal rejection |
| **Rubric misalignment** | Raw 0–100 vs. CBC 8-point sub-levels (EE1–BE2) | Non-compliant reports |
| **Credential sharing** | Teachers give passwords to students | Full account access, audit gaps, denial of responsibility |

---

## 3. Best-Fit Solution: "Delegated Broadsheet Data Desk"

### 3.1 Delegated Access (Zero-Trust Entry)
- **Teacher generates a temporary 4-digit PIN** (or QR) valid for 4 hours → "Create Temporary Student Entry PIN".
- **Student assistant opens `/entry`**, types the PIN → immediate access to enter marks for that **specific class only**.
- **Master credentials never shared.**
- **Sandbox isolation**: delegate can only type marks for the assigned class/assessment. No access to fee ledgers, staff records, audit logs, or report-card printing.

### 3.2 Broadsheet Class-Level Grid
The entry screen matches the **physical broadsheet layout** (all subjects in one grid), not subject silos:

```
+-------------------------------------------------------------------+
| BROADSHEET DATA DESK: GRADE 8 EAST  [ Term 1 Mid-Term Continuous ] |
+-----------+-------+-------+-------+----------+----------+-----------+
| Adm & Name| MATH  | ENG   | KISW  | INT SCI  | PRE-TECH | AGRI      |
+-----------+-------+-------+-------+----------+----------+-----------+
| 1042 J.N. |  78   | ME1   | EE2   |   65     | AE1      | ME2       |
| 1043 A.O. |  82   | EE1   | ME2   |   71     | ME1      | EE2       |
+-----------+-------+-------+-------+----------+----------+-----------+
| Keyboard: [Tab] Next Subject  |  [Enter] Next Student Row           |
+-------------------------------------------------------------------+
```

### 3.3 Input Engine
- **Dual entry**: raw numbers (78), CBC sub-level codes (ME1), or numeric shortcuts (6 → ME1). Auto-converts raw marks to CBC sub-levels instantly.
- **Defensive range guards**: cell soft-locks in red if out of bounds (e.g., 780 instead of 78); submission blocked until corrected.
- **Outlier highlighting**: sudden score anomalies (e.g., historical BE2 → 98%) flagged for DOS/clerk review.

### 3.4 Two-Step Verification
1. **Entry**: Assistant finishes typing → clicks **[Submit for Review]** → status becomes `PENDING_VERIFICATION`.
2. **Approval**: DOS/Headteacher reviews summary → clicks **[Approve & Lock]** → marks commit permanently.

### 3.5 One-Tap WhatsApp/SMS Sign-Off
- System sends WhatsApp/SMS to teacher: *"40 Grade 7 Math marks entered. Click here to review & lock: [link]"*
- Teacher taps **[CONFIRM]** from phone (e.g., while having tea).
- Immutable audit trail: *"Data entered via Delegate PIN #4091, approved by Tr. Mwangi at 4:15 PM."*

---

## 4. CBC Grading Scale (Confirmed — KNEC Official)

| Sub-level | Points | Raw Mark Range |
|-----------|--------|----------------|
| EE1 | 8 | 90–100% |
| EE2 | 7 | 75–89% |
| ME1 | 6 | 58–74% |
| ME2 | 5 | 41–57% |
| AE1 | 4 | 31–40% |
| AE2 | 3 | 21–30% |
| BE1 | 2 | 11–20% |
| BE2 | 1 | 0–10% |

**Key rules:**
- **No aggregate score**; per-subject reporting only.
- KJSEA = 60% summative + 20% SBA (Grades 7-8) + 20% KPSEA.
- KPSEA uses 4 capacity bands (no points).
- **No class ranking** (1st, 2nd, 3rd) for CBC cohorts — violates CBC guidelines.

---

## 5. Additional Ground-Truth Edge Cases & Mitigations

### 5.1 Missing SBA Lockout (KNEC Portal)
- **Reality**: Blank fields in continuous assessment sheets cause portal rejection and candidate lockouts.
- **Fix**: Pre-flight "AB" (Absent) substitution for legitimate absences; dashboard audit flags missing entries.

### 5.2 OTP Gatekeeper Bottleneck
- **Reality**: Headteachers are frequently out of school; OTPs halt uploads every 15 minutes.
- **Fix**: Staging queue (clerk compiles payload) → one-tap WhatsApp "Batch Verification" link for principal approval without sharing portal credentials.

### 5.3 Hardware Failure & High-Density Printing
- **Reality**: Single overworked printer, cyber-café dependency.
- **Fix**: Compact Black-and-White Eco-Format (single page per student) + encrypted PDF links via WhatsApp/SMS.

### 5.4 Multi-Curriculum Cohort Overlap — OBSOLETE
- **8-4-4 is fully phased out.** All Kenyan schools operate under CBC only as of 2026.
- No 8-4-4 cohort exists in any school. The spec's "multi-curriculum cohort overlap" feature is **not needed**.
- Senior School (Grades 10-12) uses the same CBC framework with pathway-based placement.

---

## 6. RBAC: Dedicated Data Entry Operator Role

| Permission | Data Entry Operator | Clerk/DOS | Headteacher |
|------------|---------------------|-----------|-------------|
| Enter marks (assigned class) | ✅ | ✅ | ✅ |
| View fee balances | ❌ | ✅ | ✅ |
| Edit master settings | ❌ | ❌ | ✅ |
| Approve & lock marks | ❌ | ✅ | ✅ |
| Access audit logs | ❌ | ❌ | ✅ |

---

## 7. Pitch to the Headteacher

> *"Headteacher, we know that in real life, teachers often delegate the re-typing of paper mark-sheets to clerks or trusted assistants. Our system includes a specialized Data Entry Desk Mode. It lets staff or assistants type paper mark-sheets 5× faster with zero mouse clicks, automatically converts raw scores into KNEC CBC rubrics (EE, ME, AE, BE), and blocks typing errors before they ruin your report cards. You keep complete control because no mark goes live until you or the DOS click 'Approve'."*

---

## 8. Open Items for Implementation

1. **Delegated PIN expiry** – 4 hours (configurable by tenant).
2. **Outlier threshold** – define what constitutes a "sudden score anomaly" (e.g., >30% deviation from historical mean).
3. **WhatsApp/SMS provider** – integrate Africa's Talking or Safaricom APIs for one-tap approval links.
4. **CBC rubric auto-conversion** – map raw 0–100 to 8-point sub-levels per confirmed KNEC scale (no `cbc_scales` table needed; use the official scale directly).

---

## 9. NEMIS / KEMIS Code Format (Confirmed)

- **School code is a 4-character alphanumeric UIC** (e.g., `LVR8`, `6WF4`, `22WA`).
- **KEMIS** (Kenya Education Management Information System) is replacing NEMIS as of 2026.
- **Validation**: Accept up to 4 alphanumeric chars; do NOT enforce a regex pattern.
- **Partial unique index**: `upper(nemis_code)` where not null — prevents duplicate codes without leaking other school names.
- **Optional field**: Never required for go-live.

---

## 10. Safaricom Paybill (Confirmed)

- **Paybill numbers**: 5–7 digits (Safaricom standard).
- **Account numbers**: Merchant-defined, up to 14 digits.
- **Validation**: `^\d{5,7}$` for paybill; up to 14 digits for account number.
- **Store credentials encrypted**; never display again after initial entry.