import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
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
    let alive = true;
    // Real audit trail: server-written audit_log rows (logins, impersonation,
    // writes, consent changes, report runs…).
    api
      .get("/platform/audit")
      .then((r) => {
        if (!alive) return;
        setLogs(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = logs.filter((l) =>
    (l.action || "").toLowerCase().includes(search.toLowerCase()) ||
    (l.resource_type || "").toLowerCase().includes(search.toLowerCase()) ||
    (l.tenant_code || l.tenant_id || "").toString().toLowerCase().includes(search.toLowerCase())
  );

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load audit trail'} />;
  if (filtered.length === 0) return <ViewState state="empty" message={'No audit logs'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.audit")}</h1>
      <Card className="p-4">
        <Input placeholder={'Search audit log'} value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="max-w-sm" />
        <DataTable
          data={filtered}
          columns={[
            { key: "accessed_at", header: t("timestamp"), render: (row: any) => String(row.accessed_at || "").replace("T", " ").slice(0, 19) },
            { key: "action", header: t("action") },
            { key: "resource_type", header: t("saas.resource_type") },
            { key: "resource_id", header: t("saas.resource_id") },
            { key: "tenant_code", header: t("tenant_id"), render: (row: any) => row.tenant_code || row.tenant_id || "—" },
            { key: "ip_address", header: t("saas.ip_address") },
          ]}
          emptyMessage={'No audit logs'}
          keyField="log_id"
        />
      </Card>
    </div>
  );
}
