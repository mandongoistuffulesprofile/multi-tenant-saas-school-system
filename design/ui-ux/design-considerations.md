# UI/UX Design Considerations — Kenyan Primary School SaaS

**Version:** 0.1
**Status:** Design specification
**Applies to:** All 6 surfaces (S1–S5) across 67 views

---

## 1. Design Principles

| Principle | Description |
|-----------|-------------|
| **Mobile-First** | All surfaces designed for low-end Android Chrome (baseline device). Desktop is secondary for S1/S3/S4. |
| **Offline-First** | S2 (Teacher PWA) and S5 (Gate Kiosk) must function fully offline; sync when connectivity returns. |
| **High Contrast** | Kenyan flag colors (red #CE1126, green #008751, black #000000) for accessibility and brand recognition. |
| **Large Touch Targets** | Minimum 44px touch targets for all interactive elements (S2, S5 requirement). |
| **Bilingual** | All user-visible strings in English and Kiswahili; language toggle persisted per user. |
| **Low Bandwidth** | Parent pages under 30KB JSON per page; lazy images; minimal client bundles. |
| **Role-Based Visibility** | UI adapts strictly to RBAC matrix; hidden features never shown, not just disabled. |
| **Error States** | Every view implements: loading, empty, error(with retry), forbidden, offline(with stale-data indicator). |

---

## 2. Visual Design System

### Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--kenyan-red` | #CE1126 | Primary actions, errors, alerts, primary buttons |
| `--kenyan-green` | #008751 | Success states, "Meeting Expectation", confirmations |
| `--kenyan-black` | #000000 | Text, borders, high-contrast kiosk |
| `--kenyan-masai` | #D3A625 | Accents, warnings, secondary highlights |
| `--bg-gray-50` | #F9FAFB | Page backgrounds |
| `--text-gray-900` | #111827 | Primary text |
| `--text-gray-600` | #4B5563 | Secondary text |

### CBC Assessment Color Coding

| Level | Color | Hex | Usage |
|-------|-------|-----|-------|
| EE (Exceeding) | Green | #008751 | Exceeding Expectation cells |
| ME (Meeting) | Blue | #2563EB | Meeting Expectation cells |
| AE (Approaching) | Amber | #D97706 | Approaching Expectation cells |
| BE (Below) | Red | #CE1126 | Below Expectation cells |

### Typography

| Token | Font | Usage |
|-------|------|-------|
| `--font-sans` | Inter, system-ui | Body text, UI labels |
| `--font-display` | Poppins, system-ui | Headings, page titles |

### Component Specifications

| Component | Spec |
|-----------|------|
| **Primary Button** | `bg-kenyan-red text-white px-6 py-3 rounded-xl font-medium hover:bg-red-700 focus:ring-2 focus:ring-kenyan-red focus:ring-offset-2` |
| **Secondary Button** | `bg-white text-gray-900 border border-gray-300 px-6 py-3 rounded-xl font-medium hover:bg-gray-50` |
| **Input Field** | `w-full px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-kenyan-red` |
| **Card** | `bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden` |
| **Badge (EE/ME/AE/BE)** | `px-3 py-1 rounded-full text-xs font-semibold` |
| **Touch Target** | Minimum 44px × 44px for all interactive elements |

---

## 3. Surface-Specific UX Considerations

### S1 — School Admin Web (Desktop-First Responsive)

**Layout:**
- Left sidebar navigation (collapsible on tablet)
- Top header with school branding, user profile, notifications
- Main content area with grid-based KPI scorecards
- Responsive: stacks to single column on mobile

**Key Views & UX Patterns:**

| View | UX Pattern | Offline | Key States |
|------|-----------|---------|------------|
| V-A01 Login | Centered card, tenant subdomain detection | No | Loading, error, success |
| V-A02 Forgot Password | Multi-step wizard (phone → OTP → new password) | No | Step indicators, OTP countdown |
| V-A03 School Picker | List of schools with logos, auto-skip if one | No | Empty state, error |
| V-A04 Profile | Settings form, language toggle, notification prefs | Partial | Saved state, offline sync |
| V-H01 Dashboard | KPI grid (4 tiles), line chart, bar chart | Cached | Loading, empty, error |
| V-H02 School Profile | Form with logo/stamp upload, subdomain, funding mode | No | Success, validation errors |
| V-H03 Integrations | Payment channels, SMS sender ID, WhatsApp, test buttons | No | Connected/disconnected, test status |
| V-H04 Calendar | Timeline view, term dates, exam windows | Cached | Overlap warnings, seed template |
| V-H05 Grades/Streams | Grid view, drag-and-drop stream allocation | Cached | Rollout preview, dry-run |
| V-H06 Staff & Roles | Staff list, invitation status, role matrix | Cached | Pending invites, deactivated |
| V-H07 Teaching Allocation | Class × Learning Area matrix, teacher assignment | Cached | Unassigned warnings |
| V-H08–V-H13 Learner Registry | Searchable list, wizard forms, bulk import | Cached | Duplicate warnings, draft saves |

**Responsive Breakpoints:**
- Mobile (< 768px): Sidebar becomes bottom nav or drawer
- Tablet (768–1024px): Sidebar collapses to icons
- Desktop (> 1024px): Full sidebar + main content

---

### S2 — Teacher PWA (Phone-First, Offline-First)

**Layout:**
- Bottom tab navigation (My Classes, Grading, Attendance, Sync, Profile)
- Full-width touch targets (44px minimum)
- Large fonts (16px minimum for readability in bright sunlight)
- High-contrast mode for outdoor use

**Key Views & UX Patterns:**

| View | UX Pattern | Offline | Sync Behavior |
|------|-----------|---------|---------------|
| V-T01 My Classes | Class cards with pending counts, last sync timestamp | Yes | Shows cached workload when offline |
| V-T02 Grading Grid | Learners × Sub-strands, one-tap EE/ME/AE/BE cycle | Yes | Autosave to IndexedDB, background sync |
| V-T03 Evidence Capture | Camera/file attach, preview, upload queue | Yes | Resumable upload, offline queue |
| V-T04 Learner Remarks | Per-learner competencies, values, term remark | Yes | Draft autosave |
| V-T05 Attendance Register | One-tap present/absent/late/excused, "mark all present" | Yes | Register close sync |
| V-T06 Sync Centre | Queue length, last sync, failures, conflict list | Yes | Manual retry, keep-mine/keep-theirs |
| V-T07 Class Progress | Level distribution per learning area, learners needing support | Yes | Offline cached |

**Grading Grid Interaction:**
1. Teacher taps a cell → bottom drawer opens with 4 colored buttons (EE/ME/AE/BE)
2. Selection updates cell background color instantly (optimistic UI)
3. Long-press → sub-level selector (EE1/EE2/ME1/ME2/…), score field, remark
4. Auto-saves to IndexedDB within 500ms
5. Sync indicator shows pending changes
6. On reconnection, pushes diff-payload to server

**Offline States:**
- Banner at top: "Offline — changes saved locally"
- Sync button shows pending count
- Stale-data indicator: "Last synced 2 hours ago"
- Cells edited offline show amber border until synced

---

### S3 — Parent Portal (Low-Bandwidth, Phone-First)

**Layout:**
- Card-based layout, single column
- Minimal JavaScript, server-rendered where possible
- Lazy-loaded images (placeholders until in viewport)
- JSON responses under 30KB per page

**Key Views & UX Patterns:**

| View | UX Pattern | Offline | Data |
|------|-----------|---------|------|
| V-P01 Parent Home | Cards per child (photo, class, balance, notices) | Yes (cached) | Child summary |
| V-P02 Child Progress | Accordion by learning area, level badges, PDF download | Yes (cached) | Published reports only |
| V-P03 Fees & Pay | Balance, line items, Pay button (STK push) | No | Live balance, payment status |
| V-P04 Receipts | Payment history, receipt PDF download | Yes (cached) | Receipt PDFs |
| V-P05 Attendance | Month calendar with present/absent marks | Yes (cached) | Month view |
| V-P06 Notices | List with read/unread state | Yes (cached) | Guardian-addressed notices |
| V-P07 Consents | Purposes with grant/revoke toggles | Yes (cached) | Immediate revocation |
| V-P08 Activate Account | Claim code, guardian phone, new password | No | Code validation |

**Payment Flow (STK Push):**
1. Parent selects amount (default = full balance)
2. Clicks "Initiate M-Pesa Payment"
3. Modal spinner appears: "Sending STK PIN to your phone..."
4. Parent enters PIN on their handset
5. Webhook callback updates status: pending → success/failed/cancelled/timed-out
6. On success: receipt PDF available, SMS confirmation sent (consent-gated)
7. Double-tap guard prevents duplicate requests (2-minute cooldown)

**160-Character SMS Indicator:**
- Character counter below message input
- Turns red at 153 characters (concatenation threshold)
- Shows segment count: "1 segment", "2 segments"
- Variable sanitization warning: "Long names may increase message length"

---

### S4 — SaaS Root Console (Desktop-First)

**Layout:**
- Left navigation: Tenants, Subscriptions, Curriculum, Health, Audit
- Top header: Global health tiles (MRR, active tenants, API success rate)
- Main content: Data tables with row actions

**Key Views & UX Patterns:**

| View | UX Pattern | Key Actions |
|------|-----------|-------------|
| V-S01 Operations Centre | Health tiles, alerts, degraded integration banner | View metrics, acknowledge alerts |
| V-S02 Tenant Registry | Data table: status, tier, learners, last activity | Suspend, reactivate, impersonate, migrate |
| V-S03 Tenant Onboarding | Multi-step wizard with checklist | Create school, admin user, seed data |
| V-S04 Curriculum Configurator | Tree-view editor, diff report, publish scheduler | Edit strands, deploy system-wide |
| V-S05 Subscriptions | Plans, per-tenant subscriptions, platform invoices | Change plan, view arrears |
| V-S06 Integration Health | Per-tenant Daraja/STK success rates, callback lag, queue depth | View integration status |
| V-S07 Impersonation | Start session: tenant, reason, duration; read-only banner | Time-boxed access (max 60 min) |
| V-S08 Platform Audit | Searchable audit log, export | Search, filter, export |

**Impersonation UX:**
- Red banner at top: "Impersonating [School Name] — read-only mode"
- Session duration countdown
- Auto-expiry warning at 50 minutes
- All actions logged to both tenant and platform audit

---

### S5 — Gate Kiosk (Chromium Kiosk, High-Contrast)

**Layout:**
- Full-screen, no browser chrome
- Large text, high contrast (black background, white/green/red text)
- Idle state: "STUDENT BADGE SCANNER ACTIVE..."
- Result state: Large name, photo (if consent), class, Access Granted/Denied band

**UI States:**

```
┌─────────────────────────────────┐
│          🔒 GATE 1              │
│                                 │
│  [  STUDENT BADGE SCANNER       │
│    ACTIVE...  ]                 │
│                                 │
│  STATUS MONITOR:                │
│  ┌─────────────────────────┐   │
│  │  🟢 TAP RECEIVED        │   │
│  │  Name: Brian Omondi     │   │
│  │  Admission: ADM-2024-4112│   │
│  │  Grade: Primary 4 East  │   │
│  └─────────────────────────┘   │
│                                 │
│  >> Triggering Parent WhatsApp  │
└─────────────────────────────────┘
```

**Access Granted:**
- Green band: "ACCESS GRANTED"
- Parent notification: "Brian entered the school gate at 07:12 AM"
- Auto-return to idle after 3 seconds

**Access Denied:**
- Red band: "CONTACT ADMINISTRATION"
- Reasons: Unknown tag, inactive learner, fee arrears (if enabled)
- Clerk override: PIN + reason required

**Offline Mode:**
- Badge: "OFFLINE — decisions from cached roster"
- Queue count: "5 events waiting to sync"
- Manual entry: Clerk PIN + admission number

---

## 4. RBAC Visibility Rules (UI Enforcement)

| Feature | HEAD | DEPUTY | BURSAR | CLERK | TEACHER | PARENT | GATE |
|---------|------|--------|--------|-------|---------|--------|------|
| School settings | ✓ W | ✓ R | — | — | — | — | — |
| Staff & roles | ✓ W | ✓ R | — | ✓ R | — | — | — |
| Calendar/grades/streams | ✓ W | ✓ W | ✓ R | ✓ R | ✓ R | — | — |
| Learners & guardians | ✓ W | ✓ W | ✓ R (limited) | ✓ W | ✓ R own | ✓ R own children | — |
| Curriculum browser | ✓ R | ✓ R | — | — | ✓ R | — | — |
| Assessment entry | ✓ R | ✓ R | — | — | ✓ W own | — | — |
| Moderation | ✓ A | ✓ W | — | — | — | — | — |
| Report cards | ✓ A | ✓ W | — | — | ✓ W comments | ✓ R own children | — |
| Attendance | ✓ R | ✓ R | — | ✓ W | ✓ W own | ✓ R own children | — |
| Fee structures | ✓ A | — | ✓ W | — | — | — | — |
| Invoices | ✓ R | — | ✓ W | ✓ R | — | ✓ R own children | — |
| Payments & reconciliation | ✓ R | — | ✓ W | ✓ W | — | ✓ R own children | — |
| Broadcast messages | ✓ W | ✓ W | ✓ W (fees only) | — | — | — | — |
| Audit log | ✓ R | ✓ R (limited) | — | — | — | — | — |
| Gate devices | ✓ W | ✓ R | — | ✓ R | — | — | ✓ |

**UI Enforcement:**
- Hidden features are not rendered (not just disabled)
- Role-based menu items only
- API enforces server-side; UI matches for consistency
- "Forbidden" state shown when user attempts restricted action

---

## 5. View States (R-G12)

Every view must implement these 5 states:

```
┌─────────────────────────────────────┐
│  LOADING                            │
│  ┌─────────┐                        │
│  │  ⏳      │  Loading data...       │
│  └─────────┘                        │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  EMPTY                              │
│  ┌─────────┐                        │
│  │  📭     │  No data available     │
│  └─────────┘                        │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  ERROR (with retry)                 │
│  ┌─────────┐                        │
│  │  ⚠️     │  Failed to load        │
│  └─────────┘  [Retry] [Dismiss]     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  FORBIDDEN                          │
│  ┌─────────┐                        │
│  │  🔒     │  You don't have access │
│  └─────────┘                        │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  OFFLINE (stale data indicator)     │
│  ┌─────────┐                        │
│  │  📴     │  Offline — last synced │
│  └─────────┘  2 hours ago [Sync]    │
└─────────────────────────────────────┘
```

---

## 6. i18n (English / Kiswahili)

**Structure:**
```
src/i18n/
  translations.ts   # All strings keyed by context
  index.ts          # i18next initialization
```

**Key domains:**
- `common.*` — UI shell (buttons, labels, loading, errors)
- `auth.*` — Authentication flows
- `errors.*` — Error messages
- `cbc.*` — CBC terminology (EE, ME, AE, BE with translations)
- `finance.*` — Money, KES, fees, invoices
- `attendance.*` — Present, absent, late, excused

**CBC Terminology Translation:**

| English | Kiswahili |
|---------|-----------|
| Exceeding Expectation | Kuvutia Maelekezo |
| Meeting Expectation | Kupatana na Maelekezo |
| Approaching Expectation | Kutengeneza Maelekezo |
| Below Expectation | Chini ya Maelekezo |
| Learning Area | Mengo wa Mafunzo |
| Strand | Sehemu |
| Sub-Strand | Sehemu ndogo |
| Specific Learning Outcome | Matumizi ya kujifunza |
| Tuition | Shuleni |
| Transport | Usafiri |
| Feeding Program | Program ya Vyakula |
| Receipt | Resiti |

**Language Selection:**
- Persisted in user profile (`users.locale`)
- Default: English
- Parent messages and report cards template-able per language
- SMS messages sent in guardian's preferred language

---

## 7. Accessibility (WCAG 2.1 AA Target)

| Requirement | Implementation |
|-------------|---------------|
| Color contrast | Minimum 4.5:1 for normal text, 3:1 for large text |
| Touch targets | Minimum 44px × 44px (S2, S5) |
| Focus indicators | Visible focus ring on all interactive elements |
| Screen reader | ARIA labels on all buttons, inputs, badges |
| Resize text | Up to 200% without loss of functionality |
| Reduced motion | Respect `prefers-reduced-motion` |
| High contrast | S5 kiosk mode: black background, white/green/red text |

---

## 8. Performance Budgets

| Metric | Target | Surface |
|--------|--------|---------|
| Grading grid load (60 learners × 15 columns) | < 2s on 3G | S2 |
| Parent page JSON response | < 30KB | S3 |
| Gate tap-to-result (online) | < 1.5s | S5 |
| Login time-to-interactive | < 3s on 3G | S1–S4 |
| Image lazy loading | Below fold only | All |
| Bundle size | < 500KB gzipped | S1–S4 |

---

## 9. Error Handling UX

| Error Type | User Message | Action |
|------------|-------------|--------|
| Network error | "Network error. Check your connection." | Show retry button |
| Server error | "Server error. Try again later." | Show retry button |
| Unauthorized | "You are not authorized to perform this action." | Show back/home button |
| Not found | "The requested resource was not found." | Show back/home button |
| Validation error | Field-specific inline errors | Highlight field, show message below |
| OTP expired | "Verification code expired. Request a new one." | Resend OTP button |
| OTP invalid | "Invalid verification code." | Allow retry (max 5 attempts) |
| Duplicate admission | "A learner with this admission number already exists." | Merge or continue option |
| Offline sync conflict | "Conflict detected — choose which version to keep." | Keep mine / Keep theirs |

---

## 10. Micro-interactions

| Interaction | Behavior |
|-------------|----------|
| Cell selection (grading grid) | Instant color change, haptic feedback (if available) |
| Bottom drawer (assessment options) | Slide-up animation, 200ms |
| Sync indicator | Pulse animation while syncing |
| Payment STK | Spinner with "Sending PIN..." text |
| Receipt download | Checkmark animation on completion |
| Error toast | Slide-in from top, auto-dismiss after 5s |
| Success confirmation | Green checkmark, fade out after 3s |

---

## 11. Design Files to Create (Future)

| File | Purpose |
|------|---------|
| `design/figma/` | Figma design system file |
| `design/components/` | Reusable component library |
| `design/wireframes/` | Low-fidelity wireframes for all 67 views |
| `design/prototypes/` | Interactive prototypes for user testing |
| `design/accessibility/` | WCAG audit checklist |

---

## 12. Open UI/UX Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| D-01 Frontend framework | React, Vue, Svelte, vanilla | **React** (chosen for ecosystem, PWA support) |
| D-04 Gate lockout | On/Off by default | **Off by default** (legal restrictions) |
| D-05 WhatsApp provider | Meta Cloud API, BSP | **SMS first**, abstract behind interface |
| D-06 Biometric storage | Device-only, cloud hash | **Device-only templates** (privacy) |
| D-07 Sub-levels on reports | Show 4-level, Show 8-level | **Show 4-level**, keep 8-level data |
| D-08 Backdating threshold | 3 days, 7 days, 14 days | **7 days** |
| D-10 Hosting region | Kenya, EU, US | **Kenya** (data residency preference) |

---

**Implementation Priority:** S1/S2/S3 auth views first, then grading grid (S2), then parent portal (S3), then bursar finance (S1).
