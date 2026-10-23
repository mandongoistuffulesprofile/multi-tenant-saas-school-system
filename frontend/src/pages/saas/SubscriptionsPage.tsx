import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import { KPIStatCard } from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { Plan, Subscription } from "../../lib/types";

export default function SubscriptionsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);

  
  useEffect(() => {
    Promise.all([
      api.get("/platform/subscriptions").then(r => Array.isArray(r.data) ? r.data : []).catch(() => []),
      api.get("/platform/plans").then(r => Array.isArray(r.data) ? r.data : []).catch(() => [])
    ]).then(([s, p]) => {
      if (s.length > 0) setSubscriptions(s);
      if (p.length > 0) setPlans(p);
      setState("content");
    });
  }, []);


  if (state === "loading") return <ViewState state="loading" />;

  const mrr = plans.reduce((s, p) => s + p.price_monthly, 0);
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.subscriptions")}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard title={t("saas.total_plans", { defaultMessage: "Total Plans" })} value={plans.length} />
        <KPIStatCard title={t("saas.active_subs", { defaultMessage: "Active Subscriptions" })} value={subs.filter((s) => s.status === "ACTIVE").length} />
        <KPIStatCard title={t("saas.mrr", { defaultMessage: "MRR" })} value={`KES ${mrr}`} />
        <KPIStatCard title={t("saas.arrears", { defaultMessage: "Arrears" })} value={subs.filter((s) => s.status === "PAST_DUE").length} />
      </div>
      <Card className="p-4">
        <h3 className="text-heading mb-3">{t("saas.subscription_list", { defaultMessage: "Subscriptions" })}</h3>
        <DataTable
          data={subs}
          columns={[
            { key: "tenant_id", header: t("tenant_id") },
            { key: "plan_id", header: t("saas.plan") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "started_at", header: t("saas.started_at") },
            { key: "ends_at", header: t("saas.ends_at") },
            { key: "auto_renew", header: t("saas.auto_renew"), render: (row: any) => row.auto_renew ? t("yes") : t("no") },
          ]}
          emptyMessage={t("no_subscriptions", { defaultMessage: "No subscriptions" })}
          keyField="subscription_id"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = { ACTIVE: "bg-kenyan-green/20 text-kenyan-green", PAST_DUE: "bg-amber-100 text-amber-700", SUSPENDED: "bg-red-100 text-red-700", CANCELLED: "bg-gray-100 text-gray-700" };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}
