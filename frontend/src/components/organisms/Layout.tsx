import React, { ReactNode, useState } from "react";
import { NavLink, useLocation, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import Button from "../atoms/Button";
import Badge from "../atoms/Badge";

interface LayoutProps {
  children?: ReactNode;
}

const SIDEBAR_ITEMS = [
  { path: "/dashboard", label: "dashboard", roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT", "GUARDIAN"] },
  { path: "/school", label: "school", roles: ["SCHOOL_ADMIN"] },
  { path: "/integrations", label: "integrations", roles: ["SCHOOL_ADMIN"] },
  { path: "/calendar", label: "calendar", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/staff", label: "staff", roles: ["SCHOOL_ADMIN"] },
  { path: "/learners", label: "learners", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/finance/fee-categories", label: "fee_categories", roles: ["SCHOOL_ADMIN", "HEAD", "DEPUTY", "BURSAR"] },
  { path: "/finance/fee-structures", label: "fee_structures", roles: ["SCHOOL_ADMIN", "HEAD", "DEPUTY", "BURSAR"] },
  { path: "/finance/invoices", label: "invoices", roles: ["SCHOOL_ADMIN"] },
  { path: "/finance/payments", label: "payments", roles: ["SCHOOL_ADMIN"] },
  { path: "/curriculum", label: "curriculum", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/assessment", label: "assessment", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/reports", label: "reports", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/comms", label: "comms", roles: ["SCHOOL_ADMIN"] },
  { path: "/compliance", label: "compliance", roles: ["SCHOOL_ADMIN"] },
  { path: "/attendance", label: "attendance", roles: ["SCHOOL_ADMIN", "TEACHER"] },
  { path: "/knec", label: "knec", roles: ["SCHOOL_ADMIN"] },
  { path: "/platform", label: "platform", roles: ["SCHOOL_ADMIN", "HEAD", "DEPUTY"] },
  { path: "/parent", label: "parent_portal", roles: ["PARENT", "GUARDIAN"] },
  { path: "/profile", label: "profile", roles: ["SCHOOL_ADMIN", "TEACHER", "PARENT", "GUARDIAN"] },
] as const;

export default function Layout({ children }: LayoutProps) {
  const { t } = useTranslation();
  const { roles, clearAuth } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  const isSaasAdmin = roles.includes("SAAS_ADMIN");

  const visibleItems = SIDEBAR_ITEMS.filter((item) =>
    item.roles.some((r) => roles.includes(r))
  );

  const handleLogout = () => {
    clearAuth();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
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
            <span className="text-sm font-medium text-gray-900">{isSaasAdmin ? "Platform" : "School"}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-medium text-gray-900">{t("role")}</span>
              <span className="text-xs text-gray-500 capitalize">{roles.join(", ").toLowerCase()}</span>
            </div>
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
              <Badge variant="default">{t("language")}: en/sw</Badge>
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
              {visibleItems.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                        isActive
                          ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      }`
                    }
                    end={item.path === "/dashboard"}
                  >
                    <span className="text-lg">{iconFor(item.path)}</span>
                    {t(item.label)}
                  </NavLink>
                );
              })}
            </nav>
            <div className="p-3 border-t border-gray-100">
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
    "/curriculum": "📚",
    "/assessment": "📝",
    "/reports": "📈",
    "/comms": "💬",
    "/compliance": "🛡️",
    "/attendance": "✅",
    "/knec": "🏛️",
    "/platform": "⚙️",
    "/parent": "👨‍👩‍👧",
    "/profile": "👤",
  };
  return map[path] ?? "•";
}
