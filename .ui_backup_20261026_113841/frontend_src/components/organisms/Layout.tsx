import React, { ReactNode, useState, useEffect } from "react";
import { NavLink, useLocation, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Button from "../atoms/Button";
import Badge from "../atoms/Badge";
import {
  SCHOOL_ADMIN_ROLES,
  FINANCE_ROLES,
  ADMIN_ROLES,
  ACADEMIC_ROLES,
} from "../../lib/roles";

interface LayoutProps {
  children?: ReactNode;
}

// Grouped IA: same-context pages live in one section to prevent sidebar clutter.
type SideItem = { path: string; label: string };

const SECTION_GROUPS: { id: string; label: string; items: SideItem[] }[] = [
  {
    id: "people",
    label: "nav_people",
    items: [
      { path: "/learners", label: "learners" },
      { path: "/grades-streams", label: "grades_streams" },
      { path: "/teaching-allocation", label: "teaching_allocation" },
      { path: "/staff", label: "staff" },
    ],
  },
  {
    id: "finance",
    label: "nav_finance",
    items: [
      { path: "/finance/invoices", label: "invoices" },
      { path: "/finance/payments", label: "payments" },
      { path: "/finance/fee-categories", label: "fee_categories" },
      { path: "/finance/fee-structures", label: "fee_structures" },
      { path: "/finance/mpesa", label: "M-Pesa Ledger" },
      { path: "/finance/reconciliation", label: "Reconciliation" },
      { path: "/finance/board-pack", label: "Board Pack" },
    ],
  },
  {
    id: "academics",
    label: "nav_academics",
    items: [
      { path: "/calendar", label: "calendar" },
      { path: "/curriculum", label: "curriculum" },
      { path: "/assessment", label: "assessment" },
      { path: "/reports", label: "reports" },
      { path: "/attendance", label: "attendance" },
    ],
  },
  {
    id: "outreach",
    label: "nav_outreach_compliance",
    items: [
      { path: "/comms", label: "comms" },
      { path: "/compliance", label: "compliance" },
      { path: "/knec", label: "knec" },
      { path: "/bom-oversight", label: "BOM Oversight" },
    ],
  },
  {
    id: "system",
    label: "nav_system",
    items: [
      { path: "/school", label: "school" },
      { path: "/integrations", label: "integrations" },
      { path: "/platform", label: "platform" },
    ],
  },
];

const TOP_ITEM: SideItem = { path: "/dashboard", label: "dashboard" };
const BOTTOM_ITEM: SideItem = { path: "/profile", label: "profile" };

const ALL_ITEM_ROLES: Record<string, readonly string[]> = {
  "/dashboard": [...ADMIN_ROLES, "TEACHER", "PARENT", "GUARDIAN"],
  "/profile": ["SCHOOL_ADMIN", "TEACHER", "PARENT", "GUARDIAN", "ADMIN"],
  "/learners": [...ADMIN_ROLES, "TEACHER"],
  "/grades-streams": SCHOOL_ADMIN_ROLES,
  "/teaching-allocation": SCHOOL_ADMIN_ROLES,
  "/staff": ADMIN_ROLES,
  "/finance/invoices": FINANCE_ROLES,
  "/finance/payments": FINANCE_ROLES,
  "/finance/fee-categories": FINANCE_ROLES,
  "/finance/fee-structures": FINANCE_ROLES,
  "/finance/mpesa": FINANCE_ROLES,
  "/finance/reconciliation": FINANCE_ROLES,
  "/finance/board-pack": FINANCE_ROLES,
  "/calendar": [...ADMIN_ROLES, "TEACHER"],
  "/curriculum": [...ACADEMIC_ROLES, "TEACHER"],
  "/assessment": [...ACADEMIC_ROLES, "TEACHER"],
  "/reports": [...ACADEMIC_ROLES, "TEACHER"],
  "/attendance": [...ADMIN_ROLES, "TEACHER"],
  "/comms": ADMIN_ROLES,
  "/compliance": SCHOOL_ADMIN_ROLES,
  "/knec": SCHOOL_ADMIN_ROLES,
  "/bom-oversight": SCHOOL_ADMIN_ROLES,
  "/school": SCHOOL_ADMIN_ROLES,
  "/integrations": SCHOOL_ADMIN_ROLES,
  "/platform": SCHOOL_ADMIN_ROLES,
};

function sectionForPath(path: string): string | null {
  return SECTION_GROUPS.find((g) => g.items.some((i) => i.path === path))?.id ?? null;
}

const LABEL_KEYS = new Set([
  "learners", "grades_streams", "teaching_allocation", "staff", "invoices", "payments",
  "fee_categories", "fee_structures", "calendar", "curriculum", "assessment", "reports",
  "attendance", "comms", "compliance", "knec", "school", "integrations", "platform",
  "dashboard", "profile",
]);

function isKey(label: string) {
  return LABEL_KEYS.has(label.trim());
}

const SECTION_LABELS: Record<string, string> = {
  people: "People",
  finance: "Finance",
  academics: "Academics",
  outreach: "Outreach & Compliance",
  system: "System",
};

const SECTION_LABELS_SW: Record<string, string> = {
  people: "Watu",
  finance: "Fedha",
  academics: "Elimu na Masomo",
  outreach: "Ushirikiano na Ufuatiliaji",
  system: "Mfumo",
};

/* Command-K palette state (native, no dependency) */
interface PaletteState { open: boolean; query: string }

const NAV_PAGES: { keys: string; path: string }[] = [
  { keys: "dashboard overview kpi", path: "/dashboard" },
  { keys: "learners learners directory students", path: "/learners" },
  { keys: "grades streams placement", path: "/grades-streams" },
  { keys: "teaching allocation subjects teachers", path: "/teaching-allocation" },
  { keys: "staff faculty", path: "/staff" },
  { keys: "invoices billing invoicing", path: "/finance/invoices" },
  { keys: "payments settlements receiving cash", path: "/finance/payments" },
  { keys: "fee categories classification", path: "/finance/fee-categories" },
  { keys: "fee structures matrix", path: "/finance/fee-structures" },
  { keys: "mpesa ledger daraja c2b forensic", path: "/finance/mpesa" },
  { keys: "reconciliation matching", path: "/finance/reconciliation" },
  { keys: "board pack executive pack export", path: "/finance/board-pack" },
  { keys: "calendar terms year", path: "/calendar" },
  { keys: "curriculum cbc areas", path: "/curriculum" },
  { keys: "assessment exams events", path: "/assessment" },
  { keys: "reports report cards", path: "/reports" },
  { keys: "attendance register", path: "/attendance" },
  { keys: "comms messages broadcast communications", path: "/comms" },
  { keys: "compliance odpc gdpr audit trail", path: "/compliance" },
  { keys: "knec ministry submissions", path: "/knec" },
  { keys: "school profile settings", path: "/school" },
  { keys: "integrations daraja webhooks api", path: "/integrations" },
];


export default function Layout({ children }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const { roles, clearAuth } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("app_lang") || "en"; } catch { return "en"; } });
  const [palette, setPalette] = useState<PaletteState>({ open: false, query: "" });
  const [badges, setBadges] = useState<Record<string, number | string>>({});
  const [impSchool, setImpSchool] = useState<string | null>(() => { try { return localStorage.getItem("imp_school"); } catch { return null; } });

  /* Exit an impersonation session: restore the platform-owner tokens. */
  const exitImpersonation = () => {
    try {
      const restore = JSON.parse(sessionStorage.getItem("imp_restore") || "null");
      if (restore?.access) {
        localStorage.setItem("access_token", restore.access);
        if (restore.refresh) localStorage.setItem("refresh_token", restore.refresh);
        if (restore.roles) localStorage.setItem("roles", restore.roles);
      } else {
        clearAuth();
      }
      sessionStorage.removeItem("imp_restore");
      localStorage.removeItem("imp_school");
      setImpSchool(null);
    } catch { /* fallthrough */ }
    window.location.href = "/saas-admin";
  };

  /* EN/SW toggle: persists and switches every translated surface. */
  const toggleLang = () => {
    const next = lang === "en" ? "sw" : "en";
    setLang(next);
    try { localStorage.setItem("app_lang", next); } catch { /* private mode */ }
    i18n.changeLanguage(next);
  };

  /* Command-K: parametric search. receipt:CODE jumps straight into a
   * forensic webhook; learner:<adm|name> opens the directory filtered;
   * bare text matches page names. */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => ({ ...p, open: !p.open }));
      }
      if (e.key === "Escape") setPalette((p) => ({ ...p, open: false }));
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  /* Live sidebar badges: one light fetch, best-effort, admin-finance only. */
  useEffect(() => {
    const numericRoles = ["ADMIN", "SCHOOL_ADMIN", "HEAD", "DEPUTY"];
    if (!roles.some((r) => numericRoles.includes(r))) return;
    let alive = true;
    (async () => {
      const safe = async (p: string): Promise<any> => { try { return (await api.get(p)).data; } catch { return null; } };
      const [learners, invoices, mpesa] = await Promise.all([
        safe("/learners"), safe("/finance/invoices"), safe("/finance/mpesa/events"),
      ]);
      if (!alive) return;
      setBadges({
        "/learners": Array.isArray(learners) ? learners.length : null,
        "/finance/invoices": Array.isArray(invoices) ? invoices.length : null,
        "/finance/mpesa": (mpesa && mpesa.stats ? `${mpesa.stats.sync_percent}% sync` : null) as any,
      });
    })();
    return () => { alive = false; };
  }, [roles]);

  const isSaasAdmin = roles.includes("SAAS_ADMIN");
  const navigate = useNavigate();
  const navTo = (p: string) => navigate(p);

  const utilityItems: SideItem[] = [
    ...(isSaasAdmin ? [{ path: "/saas-admin", label: "SaaS Console" }] : []),
    ...(roles.includes("PARENT") || roles.includes("GUARDIAN") ? [{ path: "/parent", label: "Parent Portal" }] : []),
  ];

  const allowed = (path: string) => (ALL_ITEM_ROLES[path] || []).some((r) => roles.includes(r));

  const canSeeItem = (item: SideItem) => allowed(item.path) || allowed(item.path + "");

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const cur = sectionForPath(location.pathname);
    return cur ? { [cur]: true } : { people: true };
  });
  useEffect(() => {
    const cur = sectionForPath(location.pathname);
    if (cur) setOpenSections((o) => (o[cur] ? o : { ...o, [cur]: true }));
  }, [location.pathname]);

  const handleLogout = () => {
    clearAuth();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Command-K parametric palette */}
      {palette.open && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center pt-24" onClick={() => setPalette({ open: false, query: "" })}>
          <div className="w-full max-w-xl enterprise-card overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={palette.query}
              onChange={(e) => setPalette((p) => ({ ...p, query: e.target.value }))}
              placeholder="Search… receipt:QHK8921JK · learner:ADM-103 · or page name"
              className="w-full px-4 py-3 text-sm outline-none border-b border-slate-200 font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const q = palette.query.trim();
                  const rx = q.match(/^receipt:\s*(\S+)/i);
                  const lr = q.match(/^learner:\s*(\S+)/i);
                  let dest = NAV_PAGES.find((n) => n.keys.toLowerCase().includes(q.toLowerCase()) || n.keys.split(" ").some((k) => k.startsWith(q.toLowerCase())))?.path;
                  if (rx) dest = `/finance/mpesa?focus=${encodeURIComponent(rx[1])}`;
                  if (lr) dest = `/learners`;
                  if (dest) { setPalette({ open: false, query: "" }); navTo(dest); }
                }
              }}
            />
            <div className="max-h-72 overflow-y-auto text-sm">
              {(() => {
                const q = palette.query.trim().toLowerCase();
                const hits = NAV_PAGES.filter((n) => !q || n.keys.includes(q) || q.startsWith("/") && n.path.startsWith(q));
                if (q.startsWith("receipt:")) return <div className="px-4 py-3 text-xs text-gray-500">Press Enter to open the forensic view for <b className="font-mono">{palette.query.split(":")[1]}</b></div>;
                if (q.startsWith("learner:")) return <div className="px-4 py-3 text-xs text-gray-500">Press Enter to open the Learner Directory</div>;
                if (!hits.length) return <div className="px-4 py-3 text-xs text-gray-500">No matches</div>;
                return hits.slice(0, 8).map((n) => (
                  <button
                    key={n.path}
                    onClick={() => { setPalette({ open: false, query: "" }); navTo(n.path); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 flex justify-between"
                  >
                    <span className="font-medium">{t(n.keys.split(" ")[0]) !== n.keys.split(" ")[0] ? t(n.keys.split(" ")[0]) : n.keys.split(" ")[0].replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    <span className="font-mono text-[10px] text-gray-400">{n.path}</span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        {impSchool && (
          <div className="w-full bg-slate-900 text-white text-xs px-4 py-2 flex items-center justify-between no-print">
            <span className="font-bold tracking-wide">
              🎭 AUDIT SESSION: viewing <b>{impSchool}</b> as school admin — every action is attributed and logged (Platform Audit)
            </span>
            <button
              onClick={exitImpersonation}
              className="px-3 py-1 rounded-md bg-white text-slate-900 font-black hover:bg-slate-100"
            >
              Exit Impersonation
            </button>
          </div>
        )}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label="Toggle navigation"
              onClick={() => setCollapsed((c) => !c)}
            >
              ≡
            </button>
            <span className="font-display font-bold text-kenyan-red text-lg">SkulApp</span>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <span className="text-sm text-gray-600">{t("tenant_id")}:</span>
            <span className="text-sm font-medium text-gray-900 font-mono">{(() => {
              try { return localStorage.getItem("school_code") || (isSaasAdmin ? "Platform" : "School"); }
              catch { return isSaasAdmin ? "Platform" : "School"; }
            })()}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-medium text-gray-900">{t("role")}</span>
              <span className="text-xs text-gray-500 capitalize">{roles.join(", ").toLowerCase()}</span>
            </div>
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
              <button
                type="button"
                onClick={toggleLang}
                className="px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-bold text-slate-700 hover:border-slate-400 transition"
                title="Switch language English / Kiswahili"
                aria-label="Switch language"
              >
                {lang === "en" ? "EN 🇬🇧 → SW" : "SW 🇰🇪 → EN"}
              </button>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                {t("sign_out")}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out ${
            collapsed ? "-translate-x-full" : "translate-x-0"
          } md:relative md:translate-x-0`}
        >
          <div className="flex h-full flex-col">
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {canSeeItem(TOP_ITEM) && (
                <NavLink
                  key={TOP_ITEM.path}
                  to={TOP_ITEM.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                      isActive
                        ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`
                  }
                  end
                >
                  <span className="text-lg">{iconFor(TOP_ITEM.path)}</span>
                  {t(TOP_ITEM.label)}
                </NavLink>
              )}
              {utilityItems.map((item) => (                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                      isActive
                        ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`
                  }
                >
                  <span className="text-lg">{iconFor(item.path)}</span>
                  {isKey(item.label) ? t(item.label) : item.label}
                  {badges[item.path] != null && item.path === "/dashboard" ? null : (
                    <span className={`ml-auto text-[10px] font-bold financial-data ${typeof badges[item.path] === "string" ? "text-emerald-700" : "text-gray-400"}`}>
                      {String(badges[item.path])}
                    </span>
                  )}
                </NavLink>
              ))}
              {SECTION_GROUPS.map((group) => {
                const items = group.items.filter((item) =>
                  (ALL_ITEM_ROLES[item.path] || []).some((r) => roles.includes(r))
                );
                if (!items.length) return null;
                const isOpen = !!openSections[group.id];
                return (
                  <div key={group.id}>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 mt-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600 transition"
                      onClick={() => setOpenSections((o) => ({ ...o, [group.id]: !o[group.id] }))}
                      aria-expanded={isOpen}
                    >
                      <span>{lang === "sw" ? SECTION_LABELS_SW[group.id] : SECTION_LABELS[group.id]}</span>
                      <span className="flex items-center gap-1 text-gray-300 normal-case font-normal">
                        {items.length}
                        <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="space-y-1 mt-1">
                        {items.map((item) => (
                          <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                              `flex items-center gap-3 pl-6 pr-3 py-2 rounded-xl text-sm transition ${
                                isActive
                                  ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                              }`
                            }
                          >
                            <span className="text-base">{iconFor(item.path)}</span>
                            {isKey(item.label) ? t(item.label) : item.label}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {canSeeItem(BOTTOM_ITEM) && (
                <div className="pt-2 mt-2 border-t border-gray-100">
                  <NavLink
                    key={BOTTOM_ITEM.path}
                    to={BOTTOM_ITEM.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                        isActive
                          ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`
                    }
                  >
                    <span className="text-lg">{iconFor(BOTTOM_ITEM.path)}</span>
                    {t(BOTTOM_ITEM.label)}
                  </NavLink>
                </div>
              )}
            </nav>
            <div className="p-3 border-t border-gray-100 md:hidden">
              <Button variant="ghost" fullWidth onClick={handleLogout} size="sm">
                {t("sign_out")}
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex-1 p-6">
          {children ?? <Outlet />}
        </div>
      </div>
    </div>
  );
}

function iconFor(path: string): string {
  const map: Record<string, string> = {
    "/dashboard": "📊",
    "/school": "🏫",
    "/integrations": "🔌",
    "/calendar": "📅",
    "/staff": "👥",
    "/learners": "🧒",
    "/finance/fee-categories": "🏷️",
    "/finance/fee-structures": "💰",
    "/finance/invoices": "🧾",
    "/finance/payments": "💳",
    "/finance/mpesa": "📲",
    "/finance/reconciliation": "🧮",
    "/finance/board-pack": "🏛️",
    "/grades-streams": "🎓",
    "/teaching-allocation": "🧑‍🏫",
    "/bom-oversight": "📋",
    "/curriculum": "📖",
    "/assessment": "📝",
    "/reports": "📈",
    "/comms": "💬",
    "/compliance": "🛡️",
    "/attendance": "✅",
    "/knec": "🏛️",
    "/platform": "⚙️",
    "/saas-admin": "🧩",
    "/parent": "👨‍👩‍👧",
    "/profile": "👤",
  };
  return map[path] ?? "•";
}
