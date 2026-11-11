import React from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

export interface Tab {
  path: string;
  labelKey: string;
  icon: React.ElementType;
}

interface TabBarProps {
  tabs: Tab[];
  currentPath: string;
  /** When true the active tab is matched by prefix (e.g. /parent/fees/pay matches /parent/fees). */
  prefixMatch?: boolean;
  onNavigate?: () => void;
}

/**
 * Shared bottom navigation bar for mobile-first layouts (Teacher, Parent).
 * TeacherLayout and ParentLayout both render this identical shell — keep it
 * here so a visual fix lands in one place.
 */
export default function TabBar({ tabs, currentPath, prefixMatch = false, onNavigate }: TabBarProps) {
  const { t } = useTranslation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200">
      <div className="flex h-16 items-center justify-around px-2">
        {tabs.map((tab) => {
          const active = prefixMatch
            ? currentPath === tab.path || currentPath.startsWith(tab.path + "/")
            : currentPath === tab.path;
          return (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 p-2 rounded-xl text-sm font-medium transition ${
                  isActive || active
                    ? "bg-kenyan-red/10 text-kenyan-red"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`
              }
              end={!prefixMatch}
              onClick={onNavigate}
            >
              <tab.icon className="w-5 h-5 stroke-[1.5]" />
              <span className="text-xs">{t(tab.labelKey)}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}