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
  { path: "/parent", labelKey: "parent.home", icon: "🏠" },
  { path: "/parent/progress", labelKey: "parent.progress", icon: "📈" },
  { path: "/parent/fees", labelKey: "parent.fees_pay", icon: "💰" },
  { path: "/parent/receipts", labelKey: "parent.receipts", icon: "🧾" },
  { path: "/parent/attendance", labelKey: "parent.attendance", icon: "✅" },
  { path: "/parent/notices", labelKey: "parent.notices", icon: "📢" },
  { path: "/parent/consents", labelKey: "parent.consents", icon: "✍️" },
] as const;

interface ParentLayoutProps {
  children?: ReactNode;
}

export default function ParentLayout({ children }: ParentLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const activeTab = TABS.find((tab) => location.pathname === tab.path) || TABS[0];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-display font-bold text-kenyan-red text-lg">SkulApp</span>
        </div>
        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <Badge variant="default" className="text-xs">{t("online", { defaultMessage: "Online" })}</Badge>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200">
        <div className="flex h-16 items-center justify-around px-2">
          {TABS.map((tab) => {
            const active = location.pathname === tab.path;
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 p-2 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-kenyan-red/10 text-kenyan-red"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  }`
                }
                end={tab.path === "/parent"}
              >
                <span className="text-xl">{tab.icon}</span>
                {t(tab.labelKey)}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
