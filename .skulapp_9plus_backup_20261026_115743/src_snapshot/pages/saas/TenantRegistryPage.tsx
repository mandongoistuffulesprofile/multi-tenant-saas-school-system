import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/toast/ToastProvider";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";

export default function TenantRegistryPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
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
    // Safety net: the registry must never wedge in a permanent spinner
    // (e.g. stale module/HTTP-cache races during dev-server restarts).
    const safety = setTimeout(() => setState((s) => (s === "loading" ? "content" : s)), 2500);
    return () => clearTimeout(safety);
  }, []);

  const handleToggleStatus = async (tenantId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    try {
      await api.put(`/platform/tenants/${tenantId}/status`, { status: nextStatus });
      toast(nextStatus === "SUSPENDED" ? "Tenant suspended" : "Tenant activated", { type: "success" });
      fetchTenants();
    } catch (err) {
      toast("Failed to update tenant status", { type: "error" });
    } finally {
      setPending(null);
    }
  };

  // Suspending a school locks out its whole community — require explicit
  // confirmation with the school name spelled out.
  const [pending, setPending] = useState<{ tenantId: string; schoolName: string } | null>(null);
  const requestToggle = (row: any) => {
    if (row.status === "SUSPENDED") return handleToggleStatus(row.tenant_id, row.status);
    setPending({ tenantId: row.tenant_id, schoolName: row.school_name || row.subdomain || "this school" });
  };

  if (state === "loading") return <ViewState state="loading" />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.tenants")}</h1>
      <Card className="p-4">
        <DataTable
          data={tenants}
          columns={[
            { key: "school_name", header: 'School' },
            { key: "subdomain", header: t("subdomain") },
            { key: "tier", header: 'Tier' },
            { key: "learners", header: 'Learners' },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant status={row.status || "ACTIVE"} /> },
            {
              key: "actions",
              header: t("actions"),
              render: (row: any) => (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => requestToggle(row)}
                    className="px-2.5 py-1 text-xs border rounded-lg font-medium text-gray-700 hover:bg-gray-100 transition"
                  >
                    {row.status === "SUSPENDED" ? "Activate" : "Suspend"}
                  </button>
                </div>
              ),
            },
          ]}
          emptyMessage={'No tenants registered yet.'}
          keyField="tenant_id"
        />
      </Card>

      {pending && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setPending(null)}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-heading font-display">Suspend {pending.schoolName}?</h3>
              <p className="text-body text-gray-600 mt-2">
                Every user at this school — admins, teachers, BOM and parents — will be locked out until
                the tenant is reactivated. Existing data is preserved.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="px-4 py-2 text-sm border rounded-lg font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleToggleStatus(pending.tenantId, "ACTIVE")}
                className="px-4 py-2 text-sm rounded-lg font-semibold bg-slate-900 text-white hover:bg-slate-900"
              >
                Suspend school
              </button>
            </div>
          </div>
        </div>
      )}
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
