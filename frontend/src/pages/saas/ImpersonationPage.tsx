import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";

export default function ImpersonationPage() {
  const { t } = useTranslation();
  const [tenant, setTenant] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("30");
  const [processing, setProcessing] = useState(false);
  const [active, setActive] = useState(false);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setProcessing(false);
    setActive(true);
  };

  if (active) {
    return (
      <div className="p-6 text-center">
        <Card className="p-8 mx-auto max-w-md">
          <div className="text-4xl mb-3">🎭</div>
          <h2 className="text-heading mb-2">{t("saas.impersonating", { defaultMessage: "Impersonation Active" })}</h2>
          <p className="text-body">{t("saas.readonly_mode", { defaultMessage: "Read-only mode — all actions audited" })}</p>
          <div className="mt-4 p-4 rounded-xl bg-kenyan-red/10 border border-kenyan-red/20 text-kenyan-red text-sm font-medium">
            {t("saas.session_expires", { defaultMessage: "Session expires in" })} <span className="font-mono">59:42</span>
          </div>
          <Button variant="primary" onClick={() => setActive(false)} fullWidth>{t("saas.end_session")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.impersonate")}</h1>
      <Card className="p-6">
        <p className="text-body mb-6">{t("saas.impersonate_desc", { defaultMessage: "Time-boxed read-only access to a tenant (max 60 min). All actions logged." })}</p>
        <form onSubmit={handleStart} className="space-y-4">
          <Input label={t("tenant_id")} placeholder="nairobiacademy" value={tenant} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTenant(e.target.value)} required />
          <Input label={t("reason")} placeholder="Investigate fee discrepancy" value={reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)} required />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label block">{t("saas.duration_min")}</label>
              <Input type="number" value={duration} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(e.target.value)} />
            </div>
          </div>
          <p className="text-caption text-muted">{t("saas.max_60min", { defaultMessage: "Maximum session: 60 minutes" })}</p>
          <Button variant="primary" type="submit" loading={processing} disabled={processing}>{t("saas.start_session")}</Button>
        </form>
      </Card>
    </div>
  );
}
