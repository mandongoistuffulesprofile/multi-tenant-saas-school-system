import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";
import Button from "../components/atoms/Button";

// Institutional identity printed on CBC report cards, leaving certificates and
// M-Pesa receipts. MoE registration and KNEC centre code are what make those
// documents valid outside the school gate. `labelKey` is a translation key, not
// a label: the field list is static so the keys are stable.
const PROFILE_FIELDS: { key: string; labelKey: string; placeholder?: string; mono?: boolean }[] = [
  { key: "school_name", labelKey: "school_profile_page.school_name" },
  { key: "moe_registration_number", labelKey: "school_profile_page.moe_registration_number", placeholder: "e.g. MOE/PRI/12839/2018", mono: true },
  { key: "knec_code", labelKey: "school_profile_page.knec_code", placeholder: "e.g. 20401021", mono: true },
  { key: "nemis_code", labelKey: "school_profile_page.nemis_code", placeholder: "e.g. 01012001", mono: true },
  { key: "kemis_code", labelKey: "school_profile_page.kemis_code", mono: true },
  { key: "county", labelKey: "school_profile_page.county", placeholder: "e.g. Nairobi" },
  { key: "sub_county", labelKey: "school_profile_page.sub_county", placeholder: "e.g. Westlands" },
  { key: "zone_ward", labelKey: "school_profile_page.zone_ward" },
  { key: "address", labelKey: "school_profile_page.address" },
  { key: "default_locale", labelKey: "school_profile_page.default_locale", placeholder: "e.g. en-KE" },
  { key: "hosts_junior", labelKey: "school_profile_page.hosts_junior", placeholder: "true/false" },
  { key: "kra_pin", labelKey: "school_profile_page.kra_pin", placeholder: "e.g. P051234567Z", mono: true },
  { key: "mpesa_account_format", labelKey: "school_profile_page.mpesa_account_format", placeholder: "STUDENT_ADM_NO", mono: true },
];

export default function SchoolProfilePage() {
  const { t } = useTranslation();
  const [school, setSchool] = useState<any>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [stampPreview, setStampPreview] = useState<string | null>(null);
  const [headSigPreview, setHeadSigPreview] = useState<string | null>(null);
  const { toast } = useToast();

  const applySchool = (data: any) => {
    setSchool(data);
    const next: Record<string, string> = {};
    PROFILE_FIELDS.forEach((f) => { next[f.key] = data?.[f.key] ?? ""; });
    next.school_motto = data?.school_motto ?? "";
    next.hosts_junior = data?.hosts_junior ? "true" : "false";
    setForm(next);
    setLogoPreview(data?.logo_url ?? null);
    setStampPreview(data?.stamp_url ?? null);
    setHeadSigPreview(data?.head_signature_url ?? null);
  };

  useEffect(() => {
    api.get("/school")
      .then((res) => applySchool(res.data))
      .catch(() => toast(t("school_profile_page.load_failed"), { type: "error" }))
      .finally(() => setLoading(false));
    // t changes with the language; reloading the profile on a language switch
    // would be a pointless request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/school", form);
      const refreshed = await api.get("/school");
      applySchool(refreshed.data);
      toast(t("school_profile_page.saved"), { type: "success" });
    } catch (err: any) {
      toast(err?.response?.data?.message || t("school_profile_page.save_failed"), { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="card p-6 animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/3"></div>
            <div className="grid grid-cols-2 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-5 bg-gray-100 rounded w-full"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  if (!school) return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="card p-8 text-center">
            <p className="text-body mt-4">{t("school_profile_page.not_found")}</p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-heading mb-2">{t("school_profile_page.title")}</h2>
          <p className="text-caption text-muted mb-6">
            {t("school_profile_page.intro")}
          </p>
          <form onSubmit={handleSave} className="card p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PROFILE_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="label">{t(field.labelKey)}</label>
                  <input
                    className={`input-field ${field.mono ? "font-mono" : ""}`}
                    placeholder={field.placeholder}
                    value={form[field.key] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="label">{t("school_profile_page.motto")}</label>
              <input
                className="input-field italic"
                placeholder={t("school_profile_page.motto_placeholder")}
                value={form.school_motto ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, school_motto: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t("school_profile_page.hosts_junior")}</label>
              <select
                className="input-field"
                value={form.hosts_junior ?? "false"}
                onChange={(e) => setForm((f) => ({ ...f, hosts_junior: e.target.value }))}
              >
                <option value="false">{t("school_profile_page.no")}</option>
                <option value="true">{t("school_profile_page.yes")}</option>
              </select>
            </div>
            <div>
              <label className="label">{t("school_profile_page.default_locale")}</label>
              <input
                className="input-field"
                placeholder="e.g. en-KE"
                value={form.default_locale ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, default_locale: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t("school_profile_page.address")}</label>
              <input
                className="input-field"
                placeholder={t("school_profile_page.address_placeholder")}
                value={form.address ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">{t("school_profile_page.logo")}</label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <img src={logoPreview} alt={t("school_profile_page.logo")} className="w-16 h-16 rounded object-cover border" />
                ) : (
                  <div className="w-16 h-16 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-400">{t("school_profile_page.no_logo")}</div>
                )}
                <input type="file" accept="image/*" className="text-sm" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => setLogoPreview(reader.result as string);
                    reader.readAsDataURL(file);
                  }
                }} />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="label">{t("school_profile_page.head_signature")}</label>
              <div className="flex items-center gap-4">
                {headSigPreview ? (
                  <img src={headSigPreview} alt={t("school_profile_page.head_signature")} className="w-24 h-12 rounded object-cover border" />
                ) : (
                  <div className="w-24 h-12 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-400">{t("school_profile_page.no_signature")}</div>
                )}
                <input type="file" accept="image/*" className="text-sm" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => setHeadSigPreview(reader.result as string);
                    reader.readAsDataURL(file);
                  }
                }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-caption text-muted pt-2">
              <div>
                {t("school_profile_page.subdomain")}: <span className="text-gray-900">{school.subdomain}.skulapp.ke</span>
              </div>
              <div>
                {t("school_profile_page.status")}: <span className="text-gray-900">{school.status ?? "—"}</span>
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button variant="primary" type="submit" loading={saving}>
                {t("school_profile_page.save")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
}
