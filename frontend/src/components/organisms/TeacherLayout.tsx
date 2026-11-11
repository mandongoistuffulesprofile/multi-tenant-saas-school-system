import React, { ReactNode, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import Badge from "../atoms/Badge";
import { GraduationCap, ClipboardList, Clock, RefreshCw, User } from "lucide-react";
import TabBar, { type Tab } from "../organisms/TabBar";

/** A Tab with an optional role gate — filtered before reaching the shared TabBar. */
interface RoleTab extends Tab {
  roles: string[];
}

const TABS: RoleTab[] = [
  { path: "/teacher/classes", labelKey: "teacher.my_classes", icon: GraduationCap, roles: ["TEACHER", "SCHOOL_ADMIN", "HEAD", "DEPUTY"] },
  { path: "/teacher/grading", labelKey: "teacher.grading", icon: ClipboardList, roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/attendance", labelKey: "teacher.attendance", icon: Clock, roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/sync", labelKey: "teacher.sync_centre", icon: RefreshCw, roles: ["TEACHER", "SCHOOL_ADMIN"] },
  { path: "/teacher/profile", labelKey: "teacher.profile", icon: User, roles: ["TEACHER", "SCHOOL_ADMIN", "HEAD", "DEPUTY"] },
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

      <TabBar tabs={visibleTabs} currentPath={location.pathname} onNavigate={() => setMenuOpen(false)} />

      {menuOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
      )}
    </div>
  );
}