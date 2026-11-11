# Role Portal & Brutal-Minimal Design Plan

## Context

This plan concerns the frontend of Shule Yetu, a Kenyan school-management SaaS (Go + PostgreSQL 18 + React 18 + TypeScript + Vite + Tailwind + i18next + Zustand).

### Grounded findings (read from actual code, not speculation)

1. **Login flow works today.** `frontend/src/pages/LoginPage.tsx` is a single form (School Code + Username + Password). It authenticates via `POST /auth/login`, which returns `token_pair`, `user_id`, `tenant_id`, `roles`, and `tenant`. After success it routes by role: SAAS_ADMIN→`/platform/operations`, TEACHER→`/teacher/classes`, PARENT→`/parent`, else→`/dashboard` (lines 44-53).

2. **The "fucked" part is SchoolPicker.** `frontend/src/pages/SchoolPickerPage.tsx` is reached *after* auth (protected route `/select-school`, `App.tsx:116-118`). It calls `GET /me/memberships` then `POST /auth/tenant/switch`. It renders memberships as a flat unstyled `<button>` list showing `school_name · subdomain · role` (lines 78-90). No role distinction, no cards — just a plain list between login and dashboard.

3. **There is no GATE role.** `frontend/src/lib/roles.ts` defines 11 roles: SCHOOL_ADMIN, HEAD, DEPUTY, BURSAR, CLERK, TEACHER, PARENT, GUARDIAN, ADMIN, BOM, SAAS_ADMIN. No GATE role exists. The Gate Kiosk is a physical-device surface (S5 per `design/ui-ux/design-considerations.md`), reached by a clerk — not a login door.

4. **Palette drift.** `tailwind.config.js` defines `--kenyan-red:#CE1126`, `--kenyan-green:#008751`, `--kenyan-black:#000000`, `--kenyan-masai:#D3A625`. But `Button.tsx` primary ships as `bg-slate-900`, not kenyan-red. The spec's proposed rebrand (`#F3F3F5` bone, `#0A0E14` ink, `#A81826` crimson, `#0F6944` green) conflicts with the shipped tokens — migrating it is a rebrand, not a tweak.

5. **Icon coverage is near-zero.** `lucide-react@^1.61.0` is installed but only 4-5 distinct icons are imported across 67 views (`Landmark`, `User`, `Lock`, `FileSpreadsheet`, `Receipt`, `X`, `Plus`). The app reads unfinished.

## Decision summary

- **Icons:** Lucide (base, strokeWidth 1.5–2) + Streamline Sharp Line/Solid (accent, bounded set ~18 icons for high-worth trust moments only). Chosen over Tabler/Phosphor/Heroicons because only this split delivers brutal geometry + corporate gravity + modernity + legacy trust simultaneously. Sharp free tier is CC BY 4.0 (~100-icon cap) — acceptable if scoped to accent-only use.
- **Role chooser:** One card per `(school, role)` pair — the only non-lossy unit, since role and school are co-located in the `Membership[]` from `GET /me/memberships` and both are required to set the session (`tenant_id` + `roles`). "Roles alone" and "schools alone" both drop data the backend needs.
- **Keep SchoolPickerPage route.** It is the live post-auth multi-school switcher via `POST /auth/tenant/switch`. Do not replace it; redesign its rendering to cards and add a shared `<RoleCard>` component.
- **Add new pre-login portal** (`/role-selector` or `/portal`) as the unified entry: choose `(school, role)` card → tailored credential chamber per role → authenticate → route to surface. Eliminates LoginPage → SchoolPicker → dashboard bounce.

## Color discipline (rated /100 against context, not imagined values)

**Shipped palette: 78/100.**
- +18 context fit: Kenyan flag red/green/black is culturally resonant; red = primary CTAs, green = success/CBC-EE, black = S5 kiosk high-contrast (#000 bg + white text survives bright equatorial sunlight).
- +8 accessibility backbone: black/red/green give the 4.5:1 contrast WCAG 2.1 AA requires.
- −6 implementation drift: primary button ships `bg-slate-900`, not `bg-kenyan-red`. Palette is only half-applied.
- −6 red-on-white fails 4.5:1 (#CE1126 on white ≈ 3.79:1); passes 3:1 for large text only. Avoid red body text/icons on white.
- −4 potential busyness: three saturated hues equal-weight on data-dense admin screens reads loud. Black as dominant neutral; red only primary CTAs; green only success/CBC-EE; masai gold (#D3A625) appears in spec tokens but in zero components read — apply deliberately or drop.

**Proposed rebrand (user's spec): #F3F3F5 bone / #0A0E14 ink / #A81826 crimson / #0F6944 sovereign green.**
- This conflicts with shipped `tailwind.config.js` tokens. Treat as a separate rebrand decision; do not assume it replaces shipped palette without explicit sign-off. If adopted, every `kenyan-red`/`kenyan-green`/`slate-900` component reference migrates.

## Iconography

- Base: Lucide `strokeWidth={1.5}` on PWA/kiosk, `strokeWidth={2}` on desktop. Used for nav, table sorts, form indicators, alerts, empty states.
- Accent: Streamline Sharp Line + Sharp Solid. Confined to high-worth trust moments: institutional badge/header mark, ODPC compliance shield, M-Pesa STK push live indicator, Gate Kiosk verification state, empty-state hero icons.
- Do not mix Lucide + Sharp at equal weight. Lucide is the workhorse (90%); Sharp is the accent (10%).

## Role portal architecture (single-page unified chamber)

### Layout split (desktop)
- Left 60% — Role Matrix: four institutional doors, each a `<RoleCard>`:
  1. School Governance & Bursar (SCHOOL_ADMIN / HEAD / DEPUTY / BURSAR) — financial ledger + NEMIS sync, desktop-first.
  2. CBC Educator & Class Teacher (TEACHER) — tablet/mobile PWA, offline IndexedDB sync, grading grid.
  3. Parent & Guardian Portal (PARENT / GUARDIAN) — ultra-low-bandwidth 2G/3G friendly, SMS OTP, fee paybill.
  4. Gate Kiosk & Physical Security — **not a login role.** Reach via a separate kiosk URL or clerk PIN entry; do not place a "Gate" role card here because no GATE role exists in `roles.ts`.
- Right 40% — Context-Aware Authentication Chamber: the credential form swaps inline based on selected role, no page refresh/redirect:
  - Teacher: Staff ID + 6-digit Quick PIN.
  - Parent/Guardian: Phone Number + 1-tap SMS OTP.
  - Admin/Bursar: School Code + Username + Password.
  - Gate Kiosk: Terminal Passcode / NFC scan prompt (separate kiosk path).

### Multi-tenancy resolver (inline branch pills)
- For users with multiple `(school, role)` memberships, branch selection pills appear inside the credentials card *after* role choice. User picks branch → clicks "Establish Secure Session." This collapses LoginPage → SchoolPicker → dashboard into one page.

### Critical contradiction to resolve before implementation
- **Pre-login portal cannot fetch `GET /me/memberships`.** That endpoint requires a valid token (it is behind `Protected`, `App.tsx:116`). A role matrix showing a specific user's schools *requires* auth first. Therefore the pre-login role matrix must be **role-only cards** (no school pre-bound), OR the user authenticates first and then sees the school picker.
- Honest minimal path that keeps "one page, no bounce": keep `LoginPage` as the credential entry, then immediately render the `(school, role)` role-card chooser inline (swap the form for the matrix) before routing to the dashboard. This preserves `POST /auth/login` semantics and eliminates the separate SchoolPicker page without inventing a pre-login memberships query.

## Role-card component (shared)
- New `<RoleCard>` atom: school name, subdomain, role badge, status, selected/active state, `onClick`. Reused by both the post-auth chooser (replacing SchoolPicker's flat button list) and any future pre-login role-only matrix.
- Role badges derived from `lib/roles.ts` vocabulary only (no GATE).

## Ordered implementation tasks

1. **Fix Button palette drift** (`frontend/src/components/atoms/Button.tsx`): set primary to `bg-kenyan-red text-white hover:bg-red-700`, matching the spec's primary-action intent. Unblock before icons matter.
2. **Add `<RoleCard>` atom** (`frontend/src/components/atoms/RoleCard.tsx`): school name, subdomain, role badge, status, selected state.
3. **Redesign SchoolPickerPage rendering** (`frontend/src/pages/SchoolPickerPage.tsx`): replace flat `<button>` list with RoleCard grid. Keep `GET /me/memberships` + `POST /auth/tenant/switch` calls byte-identical; keep route alive.
4. **Add Sharp accent icons** (~18): institutional badge, ODPC shield, M-Pesa STK live indicator, Gate Kiosk verification state, empty-state heroes. CC BY 4.0 attribution if using free tier.
5. **Wire Sharp into high-worth moments only**: `KPIStatCard` icon slot, `InstitutionalEmptyState`, gate kiosk, impersonation banner, sync pulse.
6. **Inline role-card chooser post-login**: after `LoginPage` authenticates, swap form for `(school, role)` RoleCard matrix inline; select branch → `POST /auth/tenant/switch` → route to surface. Eliminates separate SchoolPicker bounce for single-membership users.
7. **Tailored credential chambers** (optional Phase 2): per-role input shapes (Staff ID+PIN, Phone+OTP, School Code+Username+Password) as inline swaps within the login chamber.
8. **Typecheck + build**: `cd frontend && npm run typecheck && npm run build`.

## Risks
- Pre-login portal claiming to show a user's specific schools before auth is architecturally impossible (`GET /me/memberships` needs a token). Must be role-only or post-auth.
- Rebranding to `#F3F3F5`/`#0A0E14`/`#A81826`/`#0F6944` is a breaking token migration; not in scope unless explicitly approved.
- Sharp free tier caps at ~100 icons/project; fine for ~18 accent icons, do not expand without checking.
- Mixing Lucide (stroke) and Sharp (solid/line) at equal weight breaks visual consistency; enforce the 90/10 split.

## Validation
- `cd frontend && npm run typecheck && npm run build`
- Manual smoke: login → inline role-card matrix → select branch → dashboard route correct per role.
- SchoolPicker still reachable for multi-school switch; cards render with school name + subdomain + role.
- WCAG contrast check on primary red button and black kiosk surface.

## Open question (recommended answer)
- Adopt shipped Kenyan palette (78/100, fix button drift) vs. adopt proposed rebrand? **Recommended: fix shipped palette drift first; treat rebrand as separate decision.**


