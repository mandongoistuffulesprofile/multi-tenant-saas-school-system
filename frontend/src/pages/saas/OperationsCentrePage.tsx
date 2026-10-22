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

  useEffect(() => {
    apiGet<TenantUsage[]>("/platform/usage").then((d) => setUsage(Array.isArray(d) ? d : []));
    apiGet<Plan[]>("/platform/plans").then((d) => setPlans(Array.isArray(d) ? d : []));
    apiGet<Subscription[]>("/platform/subscriptions").then((d) => setSubs(Array.isArray(d) ? d : []));
    setState("content");
  }, []);

  if (state === "loading") return <ViewState state="loading" />;

  const latest = usage[0];
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.operations")}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard title={t("saas.active_tenants", { defaultMessage: "Active Tenants" })} value={latest?.active_learners ?? 0} />
        <KPIStatCard title={t("saas.api_success", { defaultMessage: "API Success Rate" })} value="99.4%" trend={{ label: "vs yesterday", value: 0.2, positive: true }} />
        <KPIStatCard title={t("saas.mrr", { defaultMessage: "MRR" })} value={`KES ${plans.reduce((s, p) => s + p.price_monthly, 0)}`} />
        <KPIStatCard title={t("saas.alerts", { defaultMessage: "Alerts" })} value={2} trend={{ label: "critical", value: 0, positive: false }} />
      </div>
      <Card className="p-4">
        <h3 className="text-heading mb-3">{t("saas.integration_health", { defaultMessage: "Integration Health" })}</h3>
        <DataTable
          data={[
            { name: "M-Pesa STK", status: "healthy", rate: "98.2%", lag: "120ms" },
            { name: "SMS Gateway", status: "healthy", rate: "99.1%", lag: "80ms" },
            { name: "WhatsApp", status: "degraded", rate: "87.4%", lag: "450ms" },
          ] as any}
          columns={[
            { key: "name", header: t("name") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "rate", header: t("saas.success_rate") },
            { key: "lag", header: t("saas.callback_lag") },
          ]}
          emptyMessage={t("no_data", { defaultMessage: "No data" })}
          keyField="name"
        />
      </Card>
    </div>
  );
}

function apiGet<T>(path: string): Promise<T> {
  return api.get<T>(path).then((r) => r.data);
}
