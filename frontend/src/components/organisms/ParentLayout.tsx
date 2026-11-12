import React, { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Badge from "../atoms/Badge";
import { Home, BarChart3, CreditCard, Receipt, Clock, Megaphone, Signature } from "lucide-react";
import TabBar, { type Tab } from "../organisms/TabBar";

const TABS: Tab[] = [
  { path: "/parent", labelKey: "parent.home", icon: Home },
  { path: "/parent/progress", labelKey: "parent.progress", icon: BarChart3 },
  { path: "/parent/fees", labelKey: "parent.fees_pay", icon: CreditCard },
  { path: "/parent/receipts", labelKey: "parent.receipts", icon: Receipt },
  { path: "/parent/attendance", labelKey: "parent.attendance", icon: Clock },
  { path: "/parent/notices", labelKey: "parent.notices", icon: Megaphone },
  { path: "/parent/consents", labelKey: "parent.consents", icon: Signature },
] as const;

interface ParentLayoutProps {
  children?: ReactNode;
}

export default function ParentLayout({ children }: ParentLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-display font-bold text-kenyan-red text-lg">SkulApp</span>
        </div>
        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <Badge variant="default" className="text-xs">{t("online", { defaultValue: "Online" })}</Badge>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">{children}</main>

      <TabBar tabs={TABS} currentPath={location.pathname} prefixMatch={true} />
    </div>
  );
}