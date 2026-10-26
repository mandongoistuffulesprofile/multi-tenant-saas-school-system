import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import { KPIStatCard } from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import { Role } from "../lib/types";

export interface DashboardStat {
  label: string;
  value: string | number;
  role: Role[];
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { roles, tenantId } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [error, setError] = useState(false);

  const isSaasAdmin = roles.includes("SAAS_ADMIN");
  const isSchoolStaff = roles.includes("SCHOOL_ADMIN") || roles.includes("TEACHER");
  const isParent = roles.includes("PARENT") || roles.includes("GUARDIAN");

  useEffect(() => {
    let endpoints: string[] = [];
    if (isSaasAdmin) endpoints = ["/platform/subscriptions", "/platform/usage"];
    else if (isSchoolStaff) endpoints = ["/learners", "/attendance/registers"];
    else {
      setLoading(false);
      return;
    }
    setError(false);
    Promise.all(endpoints.map((ep) => api.get(ep).catch(() => ({ data: [] }))))
      .then((res) => {
        const s: Record<string, number> = {};
        res.forEach((r, i) => { s[endpoints[i]] = Array.isArray(r.data) ? r.data.length : 0; });
        setStats(s);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [roles, isSaasAdmin, isSchoolStaff]);

  if (loading) return <ViewState state="loading" />;
  if (error) return <ViewState state="error" message="Failed to load dashboard" />;

  const saasCards: DashboardStat[] = [
    { label: t("finance.subscriptions"), value: stats["/platform/subscriptions"] ?? 0, role: ["SAAS_ADMIN"] },
    { label: t("finance.usage_records"), value: stats["/platform/usage"] ?? 0, role: ["SAAS_ADMIN"] },
  ];
  const schoolCards: DashboardStat[] = [
    { label: t("learners"), value: stats["/learners"] ?? 0, role: ["SCHOOL_ADMIN", "TEACHER"] },
    { label: t("attendance_registers"), value: stats["/attendance/registers"] ?? 0, role: ["SCHOOL_ADMIN", "TEACHER"] },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-display">{t("dashboard")}</h1>
          <p className="text-body">{t("tenant_id")}: {tenantId || "—"}</p>
        </div>
      </div>

      {isSaasAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {saasCards.map((c) => (
            <KPIStatCard key={c.label} title={c.label} value={c.value} />
          ))}
        </div>
      )}

      {isSchoolStaff && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {schoolCards.map((c) => (
            <KPIStatCard key={c.label} title={c.label} value={c.value} />
          ))}
        </div>
      )}

      {isParent && (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-4xl mb-3">👨‍👩‍👧</span>
            <h3 className="text-heading mb-2">{t("parent_portal")}</h3>
            <p className="text-body max-w-sm">
              {t("parent.dashboard_intro")}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
