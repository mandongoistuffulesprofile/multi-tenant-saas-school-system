import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { AccessLog } from "../../lib/types";
import Input from "../../components/atoms/Input";
import { formatAuditNarrative } from "../../lib/auditNarrative";

export default function PlatformAuditPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .get("/platform/audit")
      .then((r) => {
        if (!alive) return;
        setLogs(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  const filtered = logs.filter((l) =>
    formatAuditNarrative(l as any).toLowerCase().includes(search.toLowerCase()) ||
    (l.tenant_id || "").toString().toLowerCase().includes(search.toLowerCase())
  );

  if (state === "loading") {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-56 bg-slate-100 rounded-lg animate-pulse" />
        <Card className="p-4">
          <div className="h-9 w-full max-w-sm bg-slate-100 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-6 border-t border-slate-100 animate-pulse" />
            ))}
          </div>
        </Card>
      </div>
    );
  }
  if (state === "error") return <ViewState state="error" message={'Failed to load audit trail'} />;
  if (filtered.length === 0) return <ViewState state="empty" message={'No audit logs'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.audit")}</h1>
      <Card className="p-4">
        <Input placeholder={t("saas.search_audit")} value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="max-w-sm" />
        <DataTable
          data={filtered}
          columns={[
            { key: "accessed_at", header: t("common.timestamp"), render: (row: any) => String(row.accessed_at || "").replace("T", " ").slice(0, 19) },
            { key: "narrative", header: t("common.audit_what_happened"), render: (row: any) => formatAuditNarrative(row) },
            { key: "tenant_id", header: t("common.audit_school"), render: (row: any) => row.tenant_code || row.tenant_id || "—" },
            { key: "ip_address", header: t("common.audit_source_ip") },
          ]}
          expandable={(row: any) => (
            <div className="text-xs space-y-1 font-mono">
              <div><b>{t("common.audit_record")}:</b> {row.resource_type} / {row.resource_id}</div>
              <div><b>{t("common.audit_source_ip")}:</b> {row.ip_address}</div>
              {row.user_agent && <div><b>User agent:</b> {row.user_agent}</div>}
            </div>
          )}
          emptyMessage={'No audit logs'}
          keyField="log_id"
        />
      </Card>
    </div>
  );
}