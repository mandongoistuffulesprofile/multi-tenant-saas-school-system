import React, { ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import Badge from "../atoms/Badge";
import Button from "../atoms/Button";

interface Tab {
  path: string;
  labelKey: string;
  icon: string;
}

const TABS: Tab[] = [
  { path: "/platform/operations", labelKey: "saas.operations", icon: "📊" },
  { path: "/platform/tenants", labelKey: "saas.tenants", icon: "🏫" },
  { path: "/platform/onboard", labelKey: "saas.onboard", icon: "➕" },
  { path: "/platform/curriculum", labelKey: "saas.curriculum", icon: "📚" },
  { path: "/platform/subscriptions", labelKey: "saas.subscriptions", icon: "💳" },
  { path: "/platform/integrations", labelKey: "saas.integrations", icon: "🔌" },
  { path: "/platform/impersonate", labelKey: "saas.impersonate", icon: "🎭" },
  { path: "/platform/audit", labelKey: "saas.audit", icon: "📋" },
] as const;

interface SaaSLayoutProps {
  children?: ReactNode;
}

export default function SaaSLayout({ children }: SaaSLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const activeTab = TABS.find((tab) => location.pathname === tab.path || location.pathname.startsWith(tab.path + "/")) || TABS[0];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-display font-bold text-kenyan-red text-lg">SkulApp Console</span>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">saas root</span>
        </div>
        <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
          <Badge variant="default" className="text-xs">{t("online", { defaultMessage: "Online" })}</Badge>
          <button
            onClick={() => { localStorage.clear(); window.location.href = "/login"; }}
            className="ml-3 text-xs text-gray-500 hover:text-kenyan-red font-medium transition"
          >
            {t("sign_out", { defaultMessage: "Sign Out" })}
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden md:flex w-64 flex-col border-r border-gray-200 bg-white">
          <nav className="px-4 py-6 space-y-1">
            {TABS.map((tab) => {
              const active = location.pathname === tab.path || location.pathname.startsWith(tab.path + "/");
              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition ${
                      isActive
                        ? "bg-kenyan-red/10 text-kenyan-red font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`
                  }
                >
                  <span className="text-lg">{tab.icon}</span>
                  {t(tab.labelKey)}
                </NavLink>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
