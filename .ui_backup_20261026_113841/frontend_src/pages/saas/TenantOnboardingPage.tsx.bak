import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";

export default function TenantOnboardingPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [form, setForm] = useState({ school_name: "", subdomain: "", county: "", admin_email: "", admin_phone: "", plan: "STANDARD" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    await new Promise((r) => setTimeout(r, 1500));
    setProcessing(false);
    setStep(2);
  };

  if (step === 2) {
    return (
      <ViewState state="content" message={t("saas.tenant_created", { defaultMessage: "Tenant created successfully" })} />
    );
  }

  const steps = [
    { title: t("saas.school_details", { defaultMessage: "School Details" }), fields: [
      { label: t("school_name"), key: "school_name" },
      { label: t("subdomain"), key: "subdomain" },
      { label: t("county"), key: "county" },
    ] },
    { title: t("saas.admin_user", { defaultMessage: "Admin User" }), fields: [
      { label: t("email"), key: "admin_email" },
      { label: t("phone"), key: "admin_phone" },
      { label: t("saas.plan"), key: "plan" },
    ] },
  ];

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.onboard")}</h1>
      <div className="flex gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={i} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            i <= step ? "bg-kenyan-red/10 text-kenyan-red" : "bg-gray-100 text-gray-500"
          }`}>
            {i + 1}. {s.title}
          </div>
        ))}
      </div>
      <Card className="p-6">
        <h2 className="text-heading mb-4">{steps[step].title}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {steps[step].fields.map((f) => (
            <div key={f.key}>
              <label className="label block">{f.label}</label>
              <Input value={form[f.key as keyof typeof form]} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [f.key]: e.target.value })} />
            </div>
          ))}
          {step === 0 && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => setStep(1)}>{t("next")} →</Button>
            </div>
          )}
          {step === 1 && (
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setStep(0)}>← {t("back")}</Button>
              <Button variant="primary" type="submit" loading={processing}>{t("saas.create_tenant")}</Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
