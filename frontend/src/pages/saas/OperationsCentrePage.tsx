import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import { KPIStatCard } from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";
import { TenantUsage, Plan, Subscription } from "../../lib/types";

export default function OperationsCentrePage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [usage, setUsage] = useState<TenantUsage[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [health, setHealth] = useState<any[]>([]);

  useEffect(() => {
    apiGet<TenantUsage[]>("/platform/usage").then((d) => setUsage(Array.isArray(d) ? d : []));
    apiGet<Plan[]>("/platform/plans").then((d) => setPlans(Array.isArray(d) ? d : []));
    apiGet<Subscription[]>("/platform/subscriptions").then((d) => setSubs(Array.isArray(d) ? d : []));
    apiGet<any[]>("/platform/integrations").then((d) => setHealth(Array.isArray(d) ? d : []));
    setState("content");
    // Safety net for any silently-hung fetch: the KPIs render with defaults.
    const safety = setTimeout(() => setState((s) => (s === "loading" ? "content" : s)), 2500);
    return () => clearTimeout(safety);
  }, []);

  if (state === "loading") return <ViewState state="loading" />;

  // Logical fix: "Active Tenants" counts tenants, and MRR is derived from what
  // tenants actually subscribe to — never from the plan catalog.
  const activeTenants = usage.length;
  const mrr = subs.reduce((sum, s) => {
    const plan = plans.find((p) => p.plan_id === s.plan_id);
    return sum + (s.status === "CANCELLED" ? 0 : plan?.price_monthly ?? 0);
  }, 0);
  // Derived from the real platform/integrations rows — no made-up numbers.
  const healthy = health.filter((h) => h.status === "healthy").length;
  const alerts = health.filter((h) => h.status === "down" || h.status === "degraded").length;
  const apiSuccess = healthy + alerts > 0 ? Math.round((healthy / (healthy + alerts)) * 100) : null;
  const latest = usage[0];
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.operations")}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard title={'Active Tenants'} value={activeTenants} />
        <KPIStatCard title={'API Success Rate'} value={apiSuccess != null ? `${apiSuccess}%` : "—"} />
        <KPIStatCard title={'MRR'} value={`KES ${mrr.toLocaleString()}`} />
        <KPIStatCard title={'Alerts'} value={alerts} trend={alerts > 0 ? { label: "providers degraded", value: alerts, positive: false } : undefined} />
      </div>
      <Card className="p-4">
        <h3 className="text-heading mb-3">{'Integration Health'}</h3>
        <DataTable
          data={health.map((h) => ({ name: h.name, status: h.status, rate: h.success_rate != null ? `${h.success_rate}%` : "—", lag: h.callback_lag ?? "—" })) as any}
          columns={[
            { key: "name", header: t("name") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "rate", header: t("saas.success_rate") },
            { key: "lag", header: t("saas.callback_lag") },
          ]}
          emptyMessage={'No data'}
          keyField="name"
        />
      </Card>
    </div>
  );
}

function apiGet<T>(path: string): Promise<T> {
  return api.get<T>(path).then((r) => r.data);
}
