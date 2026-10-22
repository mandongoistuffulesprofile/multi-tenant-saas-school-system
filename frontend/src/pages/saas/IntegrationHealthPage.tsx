import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

export default function IntegrationHealthPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [integrations, setIntegrations] = useState<any[]>([]);

  useEffect(() => {
    setIntegrations([
      { name: "M-Pesa STK Push", channel: "Daraja C2B", status: "healthy", success_rate: "98.2%", callback_lag: "120ms", queue_depth: 3 },
      { name: "M-Pesa C2B", channel: "Daraja C2B", status: "healthy", success_rate: "99.1%", callback_lag: "90ms", queue_depth: 0 },
      { name: "SMS Gateway", channel: "Africa's Talking", status: "healthy", success_rate: "99.5%", callback_lag: "200ms", queue_depth: 1 },
      { name: "WhatsApp", channel: "Meta Cloud API", status: "degraded", success_rate: "87.4%", callback_lag: "450ms", queue_depth: 12 },
    ]);
    setState("content");
  }, []);

  if (state === "loading") return <ViewState state="loading" />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.integrations")}</h1>
      <Card className="p-4">
        <DataTable
          data={integrations}
          columns={[
            { key: "name", header: t("name") },
            { key: "channel", header: t("saas.channel") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "success_rate", header: t("saas.success_rate") },
            { key: "callback_lag", header: t("saas.callback_lag") },
            { key: "queue_depth", header: t("saas.queue_depth") },
          ]}
          emptyMessage={t("no_integrations", { defaultMessage: "No integrations" })}
          keyField="name"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = { healthy: "bg-kenyan-green/20 text-kenyan-green", degraded: "bg-amber-100 text-amber-700", down: "bg-red-100 text-red-700" };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}
