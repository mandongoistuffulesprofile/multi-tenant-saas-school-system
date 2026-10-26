import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { useToast } from "../../components/toast/ToastProvider";

interface Consent {
  id: string;
  purpose: string;
  granted: boolean;
  date: string;
}

export default function ParentConsentsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "empty" | "error">("loading");
  const [consents, setConsents] = useState<Consent[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get("/compliance/consent-records")
      .then((r) => {
        if (!alive) return;
        setConsents(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const toggleConsent = (id: string) => {
    const current = consents.find((c) => c.id === id);
    if (!current || busyId) return;
    setBusyId(id);
    api
      .patch(`/compliance/consent-records/${id}`, { granted: !current.granted })
      .then(() => {
        setConsents((cs) => cs.map((c) => c.id === id
          ? { ...c, granted: !c.granted, date: new Date().toISOString() }
          : c));
        toast(!current.granted ? "Consent granted" : "Consent revoked", { type: "success" });
      })
      .catch(() => toast("Could not update consent", { type: "error" }))
      .finally(() => setBusyId(null));
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load consents'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.consents")}</h1>
      <p className="text-body">{'Grant or revoke consents. Revocation is immediate.'}</p>
      <Card className="p-4">
        <DataTable
          data={consents}
          columns={[
            { key: "purpose", header: t("purpose") },
            { key: "granted", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "date", header: t("updated_at"), render: (row: any) => String(row.date || "").slice(0, 10) },
            { key: "action" as keyof Consent, header: t("action"), render: (row: any) => (
              <button
                type="button"
                disabled={busyId === row.id}
                onClick={() => toggleConsent(row.id)}
                className="px-3 py-1 text-xs font-semibold rounded-full bg-kenyan-green/10 text-kenyan-green border border-kenyan-green/30 hover:bg-kenyan-green/20 disabled:opacity-50"
              >
                {busyId === row.id ? "…" : row.granted ? t("revoke") : t("grant")}
              </button>
            ) },
          ]}
          emptyMessage={'No consents'}
          keyField="id"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${
      row.granted ? "bg-kenyan-green/20 text-kenyan-green border-kenyan-green" : "bg-red-100 text-red-700 border-red-200"
    }`}>
      {row.granted ? t("granted") : t("revoked")}
    </span>
  );
}
