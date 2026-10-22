import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { AccessLog } from "../../lib/types";
import Input from "../../components/atoms/Input";

export default function PlatformAuditPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLogs([
      { log_id: "l1", tenant_id: "t1", user_id: "u1", action: "LOGIN", resource_type: "auth", resource_id: "u1", ip_address: "192.168.1.50", accessed_at: "2024-01-15 07:30:00" },
      { log_id: "l2", tenant_id: "t2", user_id: "u2", action: "VIEW_REPORT", resource_type: "report", resource_id: "r1", ip_address: "10.0.0.20", accessed_at: "2024-01-15 08:15:00" },
      { log_id: "l3", tenant_id: "t1", user_id: "u3", action: "EXPORT", resource_type: "learners", resource_id: "all", ip_address: "172.16.0.5", accessed_at: "2024-01-15 09:00:00" },
    ]);
    setState("content");
  }, []);

  const filtered = logs.filter((l) => l.action.toLowerCase().includes(search.toLowerCase()) || l.resource_type.includes(search.toLowerCase()));

  if (state === "loading") return <ViewState state="loading" />;
  if (filtered.length === 0) return <ViewState state="empty" message={t("no_audit_logs", { defaultMessage: "No audit logs" })} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.audit")}</h1>
      <Card className="p-4">
        <Input placeholder={t("saas.search_audit", { defaultMessage: "Search audit log" })} value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="max-w-sm" />
        <DataTable
          data={filtered}
          columns={[
            { key: "accessed_at", header: t("timestamp") },
            { key: "action", header: t("action") },
            { key: "resource_type", header: t("saas.resource_type") },
            { key: "resource_id", header: t("saas.resource_id") },
            { key: "tenant_id", header: t("tenant_id") },
            { key: "ip_address", header: t("saas.ip_address") },
          ]}
          emptyMessage={t("no_audit_logs", { defaultMessage: "No audit logs" })}
          keyField="log_id"
        />
      </Card>
    </div>
  );
}
