import React, { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import Badge from "../atoms/Badge";
import { BarChart3, Users, Plus, BookOpen, Shield, ShieldCheck, Layout, Theater, CreditCard, Zap } from "lucide-react";
import TopBar from "../organisms/TopBar";

interface Tab {
  path: string;
  labelKey: string;
  icon: React.ElementType;
}

const TABS: Tab[] = [
  { path: "/platform/operations", labelKey: "saas.operations", icon: Layout },
  { path: "/platform/tenants", labelKey: "saas.tenants", icon: Users },
  { path: "/platform/onboard", labelKey: "saas.onboard", icon: Plus },
  { path: "/platform/curriculum", labelKey: "saas.curriculum", icon: BookOpen },
  { path: "/platform/subscriptions", labelKey: "saas.subscriptions", icon: CreditCard },
  { path: "/platform/integrations", labelKey: "saas.integrations", icon: Zap },
  { path: "/platform/impersonate", labelKey: "saas.impersonate", icon: Theater },
  { path: "/platform/audit", labelKey: "saas.audit", icon: ShieldCheck },
] as const;

interface SaaSLayoutProps {
  children?: ReactNode;
}

export default function SaaSLayout({ children }: SaaSLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const activeTab = TABS.find((tab) => location.pathname === tab.path || location.pathname.startsWith(tab.path + "/")) || TABS[0];
  const [pendingHelp, setPendingHelp] = useState(0);

  /* Notification: password-help queue count, visible from every console tab. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await api.get("/platform/password-assistance");
        if (alive) setPendingHelp(Number(response.data?.pending) || 0);
      } catch {
        // Best effort; the Operations page still loads the queue.
      }
    };
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopBar
        left={
          <>
            <span className="font-display font-bold text-kenyan-red text-lg">SkulApp Console</span>
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">saas root</span>
          </>
        }
        right={
          <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
            <Badge variant="default" className="text-xs">{t("online", { defaultValue: "Online" })}</Badge>
            <button
              onClick={async () => {
                try { await api.post("/auth/logout"); } catch {}
                localStorage.clear();
                window.location.href = "/login";
              }}
              className="ml-3 text-xs text-gray-500 hover:text-kenyan-red font-medium transition"
            >
              {t("sign_out", { defaultValue: "Sign Out" })}
            </button>
          </div>
        }
      />

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
                  <tab.icon className="w-5 h-5 stroke-[1.5]" />
                  {t(tab.labelKey)}
                  {tab.path === "/platform/operations" && pendingHelp > 0 && (
                    <span
                      className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white"
                      aria-label={`${pendingHelp} password help requests pending`}
                    >
                      {pendingHelp}
                    </span>
                  )}
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
