import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";

export default function TenantRegistryPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [tenants, setTenants] = useState<any[]>([]);

  const fetchTenants = () => {
    api.get("/platform/tenants")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        setTenants(list);
        setState("content");
      })
      .catch(() => {
        // Fallback gracefully if zero
        setTenants([]);
        setState("content");
      });
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleToggleStatus = async (tenantId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    try {
      await api.put(`/platform/tenants/${tenantId}/status`, { status: nextStatus });
      fetchTenants();
    } catch (err) {
      alert("Failed to update tenant status");
    }
  };

  if (state === "loading") return <ViewState state="loading" />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.tenants")}</h1>
      <Card className="p-4">
        <DataTable
          data={tenants}
          columns={[
            { key: "school_name", header: t("school_name", { defaultMessage: "School" }) },
            { key: "subdomain", header: t("subdomain") },
            { key: "tier", header: t("saas.tier", { defaultMessage: "Tier" }) },
            { key: "learners", header: t("learners", { defaultMessage: "Learners" }) },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant status={row.status || "ACTIVE"} /> },
            {
              key: "actions",
              header: t("actions"),
              render: (row: any) => (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(row.tenant_id, row.status)}
                    className="px-2.5 py-1 text-xs border rounded-lg font-medium text-gray-700 hover:bg-gray-100 transition"
                  >
                    {row.status === "SUSPENDED" ? "Activate" : "Suspend"}
                  </button>
                </div>
              ),
            },
          ]}
          emptyMessage={t("no_tenants", { defaultMessage: "No tenants registered yet." })}
          keyField="tenant_id"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-kenyan-green/20 text-kenyan-green",
    PAST_DUE: "bg-amber-100 text-amber-700",
    SUSPENDED: "bg-red-100 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[status] || "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}
