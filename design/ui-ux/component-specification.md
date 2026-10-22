# UI Component Specification — Kenyan Primary School SaaS

**Version:** 0.1
**Status:** Design specification

---

## 1. Atomic Design Structure

### Atoms (Basic Building Blocks)

#### Button
| Variant | Classes | Usage |
|---------|---------|-------|
| `btn-primary` | `bg-kenyan-red text-white px-6 py-3 rounded-xl font-medium hover:bg-red-700` | Primary actions: Sign In, Save, Submit, Pay |
| `btn-secondary` | `bg-white text-gray-900 border border-gray-300 px-6 py-3 rounded-xl` | Secondary actions: Cancel, Back, Reset |
| `btn-outline` | `bg-transparent text-kenyan-red border border-kenyan-red px-6 py-3 rounded-xl` | Destructive actions: Delete, Suspend |
| `btn-icon` | `p-2 rounded-lg hover:bg-gray-100` | Icon-only: Close, Edit, More |

**States:** default, hover, active, disabled, loading (spinner inside)

#### Input
| Variant | Classes | Usage |
|---------|---------|-------|
| `input-text` | `w-full px-4 py-3 bg-white border border-gray-300 rounded-xl` | Text, email, phone, password |
| `input-select` | `w-full px-4 py-3 bg-white border border-gray-300 rounded-xl appearance-none` | Dropdowns: grade, stream, role |
| `input-checkbox` | `w-5 h-5 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red` | Checkboxes: consent, toggles |
| `input-radio` | `w-5 h-5 rounded-full border-gray-300 text-kenyan-red` | Radio: role selection, payment method |

**States:** default, focus, error (red border), disabled, readonly

#### Badge
| Variant | Classes | Usage |
|---------|---------|-------|
| `badge-EE` | `bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs` | Exceeding Expectation |
| `badge-ME` | `bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs` | Meeting Expectation |
| `badge-AE` | `bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs` | Approaching Expectation |
| `badge-BE` | `bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs` | Below Expectation |
| `badge-success` | `bg-green-100 text-green-800` | Success states |
| `badge-warning` | `bg-amber-100 text-amber-800` | Warning states |
| `badge-error` | `bg-red-100 text-red-800` | Error states |

#### Label
- `block text-sm font-medium text-gray-700 mb-1.5`
- Used for all form field labels

#### Text
| Variant | Classes | Usage |
|---------|---------|-------|
| `text-h1` | `text-2xl font-bold text-gray-900` | Page titles |
| `text-h2` | `text-xl font-bold text-gray-900` | Section titles |
| `text-body` | `text-base text-gray-900` | Body content |
| `text-caption` | `text-sm text-gray-600` | Helper text |
| `text-error` | `text-sm text-red-600` | Error messages |

---

### Molecules (Composed Atoms)

#### InputField (Label + Input + Error)
```
┌─────────────────────────────┐
│ Label                       │
│ ┌─────────────────────────┐ │
│ │ input                   │ │
│ └─────────────────────────┘ │
│ error message (red, small)  │
└─────────────────────────────┘
```

#### KPICard (Icon + Title + Value + Trend)
```
┌─────────────────────────┐
│ 📊  Total Active Pupils │
│        1,234            │
│    ▲ 12% vs last term   │
└─────────────────────────┘
```

#### AssessmentCell (Learner × Sub-strand Grid Cell)
```
┌─────────────┐
│   EE        │  ← colored background
│   (tap to   │     change)
│   change)   │
└─────────────┘
```

#### BottomDrawer (Mobile overlay)
```
┌─────────────────────────┐
│        Handle           │
├─────────────────────────┤
│  EE  ME  AE  BE         │  ← 4 colored buttons
│                         │
│  [Long-press for       │
│   sub-level + score]    │
└─────────────────────────┘
```

#### SyncBanner (Offline indicator)
```
┌─────────────────────────┐
│ 📴 Offline              │
│ Last synced 2h ago      │
│ [Sync Now]              │
└─────────────────────────┘
```

---

### Organisms (Complex Components)

#### GradingGrid (V-T02)
```
┌─────────────────────────────────────────────────────┐
│ Grade 4 │ Mathematics │ Fractions │ [Filter] [Sync] │
├─────────┴─────────────┴─────────────┴───────────────┤
│ Learner           │ EE  │ ME  │ AE  │ BE  │ Remark  │
├───────────────────┼─────┼─────┼─────┼─────┼─────────┤
│ Brian Omondi      │ ●   │ ○   │ ○   │ ○   │         │
│ ADM-2024-4112     │     │     │     │     │         │
├───────────────────┼─────┼─────┼─────┼─────┼─────────┤
│ Sarah Wanjiku     │ ○   │ ●   │ ○   │ ○   │         │
│ ADM-2024-4113     │     │     │     │     │         │
└───────────────────┴─────┴─────┴─────┴─────┴─────────┘
Progress: 45/60 assessed    [Save All] [Sync]
```

**Features:**
- Horizontal scroll on mobile
- Sticky left column (learner name + admission ID)
- One-tap cycles: EE → ME → AE → BE → EE
- Long-press: opens sub-level selector + score + remark
- Auto-save on change (IndexedDB)
- Sync indicator shows pending count
- Cells locked after moderation (grayed out)

#### LoginForm (V-A01)
```
┌─────────────────────────┐
│  [School Logo]          │
│                         │
│  Welcome back           │
│  Sign in to your school │
│                         │
│  ┌─────────────────┐   │
│  │ School Code     │   │  ← optional, auto-detected
│  │ nairobiacademy  │   │
│  └─────────────────┘   │
│                         │
│  ┌─────────────────┐   │
│  │ Email/Phone     │   │
│  │ you@school.ke   │   │
│  └─────────────────┘   │
│                         │
│  ┌─────────────────┐   │
│  │ Password        │   │
│  │ •••••••• [👁]   │   │
│  └─────────────────┘   │
│                         │
│  [   Sign In   ]        │
│                         │
│  Forgot password?       │
└─────────────────────────┘
```

#### ForgotPasswordWizard (V-A02)
```
Step 1/3: Phone
┌─────────────────────────┐
│ Phone Number            │
│ ┌─────────────────┐     │
│ │ 07XXXXXXXX      │     │
│ └─────────────────┘     │
│                         │
│  [ Send Code ]          │
└─────────────────────────┘

Step 2/3: OTP
┌─────────────────────────┐
│ Enter 6-digit code      │
│ ┌─┬─┬─┬─┬─┬─┐           │
│ │_│_│_│_│_│_│           │
│ └─┴─┴─┴─┴─┴─┘           │
│                         │
│  [ Verify ]             │
│  Resend in 4:30         │
└─────────────────────────┘

Step 3/3: New Password
┌─────────────────────────┐
│ New Password            │
│ ┌─────────────────┐     │
│ │ ••••••••        │     │
│ └─────────────────┘     │
│                         │
│  Confirm Password       │
│ ┌─────────────────┐     │
│ │ ••••••••        │     │
│ └─────────────────┘     │
│                         │
│  [ Reset Password ]     │
└─────────────────────────┘
```

#### FinanceDashboard (V-B01)
```
┌─────────┬─────────┬─────────┬─────────┐
│ Collected │ Outstanding │ Collection │ Unmatched │
│ Today   │ This Term │ Rate    │ Count   │
│ KES 45k │ KES 2.3M  │ 78%     │ 3       │
└─────────┴─────────┴─────────┴─────────┘

[Collection Trend Chart]  [By Grade Breakdown]

[Unmatched Transactions Queue]
│ TransID     │ Amount │ Bill Ref │ Time       │ Action   │
│ SRE45FT67X  │ 15,000 │ ADM-2024 │ 08:12 AM   │ [Match]  │
│ ...         │ ...    │ ...      │ ...        │ [...]    │
```

#### TeacherPWA BottomNav
```
┌──────┬──────┬──────┬──────┬──────┐
│  🏠  │  📝  │  ✓   │  🔄  │  👤  │
│ Classes│Grading│Attendance│Sync│Profile│
│   3    │   12   │          │  5 │       │
│ pending│ pending│          │ pending│       │
└──────┴──────┴──────┴──────┴──────┘
```

#### GateKiosk (V-G01)
```
┌─────────────────────────────────┐
│           🔒 GATE 1             │
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

ACCESS GRANTED (green band) or
CONTACT ADMINISTRATION (red band)
```

---

## 2. Responsive Behavior

### Breakpoints
| Breakpoint | Min Width | Usage |
|------------|-----------|-------|
| `sm` | 640px | Small phones |
| `md` | 768px | Tablets |
| `lg` | 1024px | Laptops |
| `xl` | 1280px | Desktops |

### Surface-Specific Layouts

| Surface | Mobile (<768px) | Tablet (768–1024px) | Desktop (>1024px) |
|---------|----------------|---------------------|-------------------|
| S1 Admin Web | Bottom nav drawer, stacked cards | Collapsible sidebar, grid | Full sidebar, dashboard grid |
| S2 Teacher PWA | Bottom tab nav, full-width | Bottom tab nav, grid | Bottom tab nav, grid (wide) |
| S3 Parent Portal | Single column cards | Single column cards | Centered max-width card |
| S4 SaaS Root | Not available (desktop only) | Collapsible sidebar | Full sidebar, data tables |
| S5 Gate Kiosk | Full-screen kiosk | Full-screen kiosk | Full-screen kiosk |

---

## 3. Component Library Structure

```
frontend/src/components/
├── atoms/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Label.tsx
│   ├── Badge.tsx
│   ├── Text.tsx
│   ├── Icon.tsx
│   └── Spinner.tsx
├── molecules/
│   ├── InputField.tsx
│   ├── KPICard.tsx
│   ├── AssessmentCell.tsx
│   ├── BottomDrawer.tsx
│   ├── SyncBanner.tsx
│   └── ErrorState.tsx
├── organisms/
│   ├── GradingGrid.tsx
│   ├── LoginForm.tsx
│   ├── FinanceDashboard.tsx
│   ├── TeacherBottomNav.tsx
│   └── GateKiosk.tsx
├── templates/
│   ├── AuthLayout.tsx
│   ├── DashboardLayout.tsx
│   ├── PWAOverlay.tsx
│   └── KioskLayout.tsx
└── pages/
    ├── LoginPage.tsx
    ├── ForgotPasswordPage.tsx
    ├── GradingGridPage.tsx
    └── ...
```

---

## 4. Animation & Motion Guidelines

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| Page transition | 200ms | ease-out | Route changes |
| Bottom drawer open | 250ms | ease-out | Mobile overlays |
| Cell color change | 150ms | ease-in-out | Grading grid selection |
| Sync pulse | 1000ms | ease-in-out infinite | Syncing indicator |
| Error toast | 300ms | ease-out | Error notifications |
| Success checkmark | 400ms | cubic-bezier | Confirmation |
| Button press | 100ms | ease-in | Touch feedback |

**Reduced Motion:** Respect `prefers-reduced-motion: reduce` — disable animations, use instant transitions.

---

## 5. Offline-First Component Behaviors

### IndexedDB Storage Keys
| Key | Data | TTL |
|-----|------|-----|
| `offline_assessments` | Pending assessment results | 30 days |
| `offline_attendance` | Pending attendance marks | 7 days |
| `offline_roster` | Cached learner roster | 24 hours |
| `offline_curriculum` | Cached strands/sub-strands | 7 days |
| `sync_queue` | Outbox events waiting to push | 30 days |

### Sync Conflict Resolution UI
```
┌─────────────────────────────────────┐
│  Sync Conflict                      │
├─────────────────────────────────────┤
│  Learner: Brian Omondi              │
│  Sub-strand: Fractions              │
├─────────────────────────────────────┤
│  Your version:    ME (Meeting)      │
│  Server version:  EE (Exceeding)    │
│  Server updated:  2 hours ago       │
├─────────────────────────────────────┤
│  [Keep Mine] [Keep Theirs] [Merge]  │
└─────────────────────────────────────┘
```

---

## 6. Error Boundary Strategy

```
ErrorBoundary (component)
├── NetworkError → Show retry button + offline banner
├── ValidationError → Show inline field errors
├── AuthError → Redirect to login
├── PermissionError → Show forbidden state
└── UnknownError → Show error page with support contact
```

---

## 7. Testing Checklist for UI/UX

- [ ] All touch targets ≥ 44px on S2/S5
- [ ] Color contrast ≥ 4.5:1 for normal text
- [ ] All forms have associated labels
- [ ] Keyboard navigation works (Tab order logical)
- [ ] Screen reader announcements for dynamic content
- [ ] Offline banner appears when connection lost
- [ ] Sync indicator shows pending count
- [ ] Bilingual text displays correctly (EN/SW)
- [ ] Error states show retry action
- [ ] Loading states show for all async operations
- [ ] Empty states show helpful messaging
- [ ] Forbidden state shown for unauthorized actions
- [ ] Mobile layout usable on 320px width
- [ ] Kiosk mode readable in bright sunlight

---

## 8. Future Enhancements

| Feature | Priority | Notes |
|---------|----------|-------|
| Dark mode | Low | Optional for night use |
| Voice input for assessment | Medium | Teachers with limited typing |
| Biometric login (teacher) | Medium | Fingerprint on device |
| Offline map for school bus | Low | Transport route tracking |
| SMS templates with variables | High | Already in plan (M11) |
| WhatsApp Business integration | Medium | D-05 open decision |
