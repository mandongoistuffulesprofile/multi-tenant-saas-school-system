import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

interface Consent {
  id: string;
  purpose: string;
  granted: boolean;
  date: string;
}

export default function ParentConsentsPage() {
  const { t } = useTranslation();
  const [consents, setConsents] = useState<Consent[]>([
    { id: "c1", purpose: "Use of learner photos in school publications", granted: true, date: "2024-01-05" },
    { id: "c2", purpose: "SMS notifications to guardian phone", granted: true, date: "2024-01-05" },
    { id: "c3", purpose: "M-Pesa payment notifications", granted: false, date: "—" },
  ]);

  const toggle = (id: string) => {
    setConsents((cs) => cs.map((c) => c.id === id ? { ...c, granted: !c.granted, date: new Date().toISOString().slice(0, 10) } : c));
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.consents")}</h1>
      <p className="text-body">{t("parent.consent_desc", { defaultMessage: "Grant or revoke consents. Revocation is immediate." })}</p>
      <Card className="p-4">
        <DataTable
          data={consents}
          columns={[
            { key: "purpose", header: t("purpose") },
            { key: "granted", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "date", header: t("updated_at") },
            { key: "action" as keyof Consent, header: t("action"), render: () => <></> },
          ]}
          emptyMessage={t("no_consents", { defaultMessage: "No consents" })}
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

function ToggleButton({ row, onToggle }: { row: any; onToggle: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <Button variant={row.granted ? "secondary" : "ghost"} size="sm" onClick={() => onToggle(row.id)}>
      {row.granted ? t("revoke") : t("grant")}
    </Button>
  );
}
