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
  roles: string[];
}

const TABS: Tab[] = [
  { path: "/teacher/classes", labelKey: "teacher.my_classes", icon: "🏫", roles: ["TEACHER", "SCHOOL_ADMIN", "HEAD", "DEPUTY"] },
  { path: "/teacher/grading", labelKey: "teacher.grading", icon: "📝", roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/attendance", labelKey: "teacher.attendance", icon: "✅", roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/sync", labelKey: "teacher.sync_centre", icon: "🔄", roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/profile", labelKey: "teacher.profile", icon: "👤", roles: ["TEACHER", "SCHOOL_ADMIN", "HEAD", "DEPUTY"] },
] as const;

interface TeacherLayoutProps {
  children?: ReactNode;
}

export default function TeacherLayout({ children }: TeacherLayoutProps) {
  const { t } = useTranslation();
  const { roles } = useAuthStore();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleTabs = TABS.filter((tab) => tab.roles.some((r) => roles.includes(r)));
  const activeTab = visibleTabs.find((tab) => location.pathname === tab.path) || visibleTabs[0];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <button
          type="button"
          className="p-2 rounded-full text-gray-600 hover:bg-gray-100"
          aria-label="Menu"
          onClick={() => setMenuOpen((m) => !m)}
        >
          ≡
        </button>
        <h1 className="font-display font-bold text-kenyan-red text-lg">{activeTab ? t(activeTab.labelKey) : t("teacher.my_classes")}</h1>
        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <Badge variant="default" className="text-xs">{t("online", { defaultMessage: "Online" })}</Badge>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200">
        <div className="flex h-16 items-center justify-around px-2">
          {visibleTabs.map((tab) => {
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
                end={tab.path === "/teacher/classes"}
                onClick={() => setMenuOpen(false)}
              >
                <span className="text-xl">{tab.icon}</span>
                {t(tab.labelKey)}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
      )}
    </div>
  );
}
