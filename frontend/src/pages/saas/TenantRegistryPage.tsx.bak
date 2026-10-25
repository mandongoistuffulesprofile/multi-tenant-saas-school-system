import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

export default function TenantRegistryPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [tenants, setTenants] = useState<any[]>([]);

  useEffect(() => {
    setTenants([
      { tenant_id: "t1", school_name: "Nairobi Academy", subdomain: "nairobiacademy", tier: "STANDARD", learners: 342, status: "ACTIVE", last_activity: "2h ago" },
      { tenant_id: "t2", school_name: "Mombasa Primary", subdomain: "mombasaprimary", tier: "BASIC", learners: 210, status: "ACTIVE", last_activity: "5h ago" },
      { tenant_id: "t3", school_name: "Kisumu Hill School", subdomain: "kisumuhill", tier: "PREMIUM", learners: 480, status: "PAST_DUE", last_activity: "1d ago" },
    ]);
    setState("content");
  }, []);

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
            { key: "tier", header: t("saas.tier") },
            { key: "learners", header: t("learners") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "last_activity", header: t("saas.last_activity") },
            { key: "actions", header: t("actions"), render: () => <ActionsCell /> },
          ]}
          emptyMessage={t("no_tenants", { defaultMessage: "No tenants" })}
          keyField="tenant_id"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = { ACTIVE: "bg-kenyan-green/20 text-kenyan-green", PAST_DUE: "bg-amber-100 text-amber-700", SUSPENDED: "bg-red-100 text-red-700", CANCELLED: "bg-gray-100 text-gray-700" };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}

function ActionsCell() {
  return (
    <div className="flex gap-1">
      <ButtonSize text="Suspend" variant="ghost" />
      <ButtonSize text="Impersonate" variant="secondary" />
    </div>
  );
}

function ButtonSize({ text, variant }: { text: string; variant: "ghost" | "secondary" }) {
  return (
    <button type="button" className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
      variant === "ghost" ? "border-gray-300 text-gray-600 hover:bg-gray-100" : "border-kenyan-red text-kenyan-red hover:bg-kenyan-red/10"
    }`}>
      {text}
    </button>
  );
}
