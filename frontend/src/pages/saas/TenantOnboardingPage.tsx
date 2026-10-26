import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import { api } from "../../lib/api";

export default function TenantOnboardingPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<any>(null);
  const [form, setForm] = useState({
    school_name: "",
    subdomain: "",
    county: "",
    admin_email: "",
    admin_phone: "",
    plan: "STANDARD",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    try {
      const res = await api.post("/platform/tenants", {
        school_name: form.school_name,
        subdomain: form.subdomain.toLowerCase().trim(),
        county: form.county,
        admin_email: form.admin_email.trim(),
        admin_phone: form.admin_phone.trim(),
        plan: form.plan,
      });
      setCreatedTenant(res.data);
      setStep(2);
    } catch (err: any) {
      setError(err.response?.data?.message || t("errors.failed_to_create_tenant", { defaultMessage: "Failed to create tenant" }));
    } finally {
      setProcessing(false);
    }
  };

  if (step === 2) {
    return (
      <div className="p-4 space-y-4">
        <ViewState state="content" message={t("saas.tenant_created", { defaultMessage: "Tenant created successfully!" })} />
        <Card className="p-6 max-w-lg mx-auto text-center space-y-3">
          <p className="font-semibold text-lg text-kenyan-green">School Provisioned</p>
          <p className="text-sm text-gray-600">Subdomain: <code className="bg-gray-100 px-2 py-1 rounded">{form.subdomain}</code></p>
          <p className="text-sm text-gray-600">Plan: <span className="font-medium">{createdTenant?.plan_code || form.plan}</span></p>
          <p className="text-sm text-gray-600">Admin: <span className="font-medium">{form.admin_email}</span></p>
          {createdTenant?.temp_password && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <p className="text-amber-800 font-semibold mb-1">School Admin Temporary Password</p>
              <code className="bg-white px-3 py-1 rounded border border-amber-300 font-mono text-base select-all">{createdTenant.temp_password}</code>
              <p className="text-[11px] text-amber-700 mt-2">Share this privately — the school admin must change it at first login.</p>
            </div>
          )}
          <Button variant="primary" onClick={() => { setStep(0); setForm({ school_name: "", subdomain: "", county: "", admin_email: "", admin_phone: "", plan: "STANDARD" }); }}>
            {t("saas.onboard_another")}
          </Button>
        </Card>
      </div>
    );
  }

  const steps = [
    { title: t("saas.school_details", { defaultMessage: "School Details" }), fields: [
      { label: t("school_name", { defaultMessage: "School Name" }), key: "school_name" },
      { label: t("subdomain", { defaultMessage: "Subdomain" }), key: "subdomain" },
      { label: t("county", { defaultMessage: "County" }), key: "county" },
    ] },
    { title: t("saas.admin_user", { defaultMessage: "Admin User" }), fields: [
      { label: t("email", { defaultMessage: "Admin Email" }), key: "admin_email" },
      { label: t("phone", { defaultMessage: "Admin Phone" }), key: "admin_phone" },
    ] },
  ];

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.onboard")}</h1>
      {error && <div className="p-3 bg-slate-100 text-slate-900 font-semibold text-sm rounded-lg border border-red-200">{error}</div>}
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
              <label className="label block mb-1">{f.label}</label>
              <Input
                value={form[f.key as keyof typeof form]}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [f.key]: e.target.value })}
                required
              />
            </div>
          ))}
          {step === 0 && (
            <div className="flex justify-end">
              <Button variant="primary" type="button" onClick={() => setStep(1)}>{t("next")} →</Button>
            </div>
          )}
          {step === 1 && (
            <>
              <div>
                <label className="label block mb-1">{t("saas.plan", { defaultMessage: "Plan" })}</label>
                <select
                  className="input-field bg-white"
                  value={form.plan}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, plan: e.target.value })}
                >
                  <option value="BASIC">Basic — public schools</option>
                  <option value="STANDARD">Standard — comprehensive</option>
                  <option value="ENTERPRISE">Enterprise — large schools & BOM</option>
                </select>
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" type="button" onClick={() => setStep(0)}>← {t("back")}</Button>
                <Button variant="primary" type="submit" loading={processing}>{t("saas.create_tenant")}</Button>
              </div>
            </>
          )}
        </form>
      </Card>
    </div>
  );
}
