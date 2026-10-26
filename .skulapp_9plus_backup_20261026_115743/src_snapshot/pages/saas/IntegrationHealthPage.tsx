import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

export default function IntegrationHealthPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [integrations, setIntegrations] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    // Derived from real data: M-Pesa rows come from mpesa_stk_requests and
    // fee_payments callback lag; unconfigured providers are reported as such.
    api
      .get("/platform/integrations")
      .then((r) => {
        if (!alive) return;
        setIntegrations(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load integration health'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.integrations")}</h1>
      <Card className="p-4">
        <DataTable
          data={integrations}
          columns={[
            { key: "name", header: t("name") },
            { key: "channel", header: t("saas.channel"), render: (row: any) => row.channel || "—" },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "success_rate", header: t("saas.success_rate"), render: (row: any) => row.success_rate != null ? `${row.success_rate}%` : "—" },
            { key: "callback_lag", header: t("saas.callback_lag") },
            { key: "queue_depth", header: t("saas.queue_depth") },
          ]}
          emptyMessage={'No integrations'}
          keyField="name"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = {
    healthy: "bg-kenyan-green/20 text-kenyan-green",
    degraded: "bg-amber-100 text-amber-700",
    down: "bg-red-100 text-red-700",
    unconfigured: "bg-gray-100 text-gray-600",
  };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}
