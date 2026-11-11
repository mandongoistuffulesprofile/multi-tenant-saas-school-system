import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import { api } from "../../lib/api";
import { KenyaValidators } from "../../utils/kenyaValidators";

const KENYA_COUNTIES = [
  "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta",
  "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru",
  "Tharaka-Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua",
  "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot",
  "Samburu", "Trans Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi",
  "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho",
  "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya",
  "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi"
];

const PLANS = [
  {
    code: "BASIC",
    title: "Basic",
    target: "Public schools",
    priceMonthly: 0,
    maxLearners: 500,
    maxStaff: 20,
    features: [
      "Up to 500 learners",
      "Up to 20 staff members",
      "Core attendance & grading",
      "M-Pesa payment integration",
      "Email support",
    ],
    color: "border-gray-300 hover:border-kenyan-green",
    badge: null,
  },
  {
    code: "STANDARD",
    title: "Standard",
    target: "Comprehensive schools",
    priceMonthly: 15000,
    maxLearners: 2000,
    maxStaff: 100,
    features: [
      "Up to 2,000 learners",
      "Up to 100 staff members",
      "Full CBC assessment tools",
      "Advanced fee management",
      "Board Pack & audit logs",
      "Priority email & chat support",
    ],
    color: "border-kenyan-green bg-green-50",
    badge: "Recommended",
  },
  {
    code: "ENTERPRISE",
    title: "Enterprise",
    target: "Large schools & BOM",
    priceMonthly: 45000,
    maxLearners: 10000,
    maxStaff: 500,
    features: [
      "Up to 10,000 learners",
      "Up to 500 staff members",
      "Multi-campus management",
      "Custom integrations & API",
      "Dedicated account manager",
      "SLA-backed phone support",
    ],
    color: "border-slate-300 hover:border-slate-500",
    badge: null,
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function TenantOnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTenant, setCreatedTenant] = useState<any>(null);
  const [form, setForm] = useState({
    school_name: "",
    subdomain: "",
    county: "",
    admin_full_name: "",
    admin_email: "",
    admin_phone: "",
    plan: "STANDARD",
  });
  const [subdomainTouched, setSubdomainTouched] = useState(false);
  const [filteredCounties, setFilteredCounties] = useState<string[]>(KENYA_COUNTIES);
  const [countyDropdownOpen, setCountyDropdownOpen] = useState(false);

  useEffect(() => {
    if (form.school_name && !subdomainTouched) {
      setForm((prev) => ({ ...prev, subdomain: slugify(prev.school_name) }));
    }
  }, [form.school_name, subdomainTouched]);

  const handleCountySearch = (value: string) => {
    const filtered = KENYA_COUNTIES.filter((c) =>
      c.toLowerCase().includes(value.toLowerCase())
    );
    setFilteredCounties(filtered);
    setCountyDropdownOpen(true);
  };

  const handleCountySelect = (county: string) => {
    setForm((prev) => ({ ...prev, county }));
    setCountyDropdownOpen(false);
  };

  const handlePhoneChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "");
    setForm((prev) => ({ ...prev, admin_phone: cleaned }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setError(null);
    try {
      const res = await api.post("/platform/tenants", {
        school_name: form.school_name.trim(),
        subdomain: form.subdomain.toLowerCase().trim(),
        county: form.county.trim(),
        admin_full_name: form.admin_full_name.trim(),
        admin_email: form.admin_email.trim().toLowerCase(),
        admin_phone: KenyaValidators.normalizePhone(form.admin_phone),
        plan: form.plan,
      });
      setCreatedTenant(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || t("errors.failed_to_create_tenant", { defaultMessage: "Failed to create tenant" }));
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = () => {
    navigate("/platform/tenants");
  };

  const handleReset = () => {
    setForm({
      school_name: "",
      subdomain: "",
      county: "",
      admin_full_name: "",
      admin_email: "",
      admin_phone: "",
      plan: "STANDARD",
    });
    setSubdomainTouched(false);
    setError(null);
    setCreatedTenant(null);
  };

  if (createdTenant) {
    return (
      <div className="p-4 space-y-4">
        <ViewState state="content" message={t("saas.tenant_created", { defaultMessage: "Tenant created successfully!" })} />
        <Card className="p-6 max-w-lg mx-auto text-center space-y-3">
          <p className="font-semibold text-lg text-kenyan-green">School Provisioned</p>
          <p className="text-sm text-gray-600">Tenant: <code className="bg-gray-100 px-2 py-1 rounded">{createdTenant?.tenant_id || form.subdomain}</code></p>
          <p className="text-sm text-gray-600">Plan: <span className="font-medium">{createdTenant?.plan_code || form.plan}</span></p>
          <p className="text-sm text-gray-600">Admin: <span className="font-medium">{form.admin_email}</span></p>
          {createdTenant?.temp_password && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <p className="text-amber-800 font-semibold mb-1">School Admin Temporary Password (show once)</p>
              <code className="bg-white px-3 py-1 rounded border border-amber-300 font-mono text-base select-all">{createdTenant.temp_password}</code>
              <p className="text-[11px] text-amber-700 mt-2">Share privately. Super Admin remains platform-only; School Admin will customize after handoff.</p>
            </div>
          )}
          <div className="flex gap-2 justify-center flex-wrap">
            <Button variant="primary" onClick={() => navigate(`/platform/tenants/${encodeURIComponent(createdTenant?.tenant_id || form.subdomain)}/setup`)}>Continue setup</Button>
            <Button variant="secondary" onClick={handleReset}>
              {t("saas.onboard_another")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <nav className="flex items-center gap-2 text-sm text-gray-500" aria-label="Breadcrumb">
        <a href="/platform/tenants" className="hover:text-kenyan-red transition">{t("saas.tenants", { defaultMessage: "Tenants" })}</a>
        <span aria-hidden="true">/</span>
        <span className="text-gray-900 font-medium">{t("saas.onboard", { defaultMessage: "New School" })}</span>
      </nav>

      <h1 className="text-display font-display">{t("saas.onboard", { defaultMessage: "Onboard New School" })}</h1>

      {error && (
        <div className="p-3 bg-slate-100 text-slate-900 font-semibold text-sm rounded-lg border border-red-200" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-kenyan-red/10 flex items-center justify-center text-kenyan-red font-semibold text-sm">1</span>
            <h2 className="text-heading font-display">{t("saas.school_details", { defaultMessage: "School Identity" })}</h2>
          </div>
          <div className="border-t border-gray-100 pt-6 space-y-4">
            <div>
              <label className="label block mb-1" htmlFor="school_name">{t("common.school_name", { defaultMessage: "School Name" })}</label>
              <Input
                id="school_name"
                value={form.school_name}
                onChange={(e) => setForm({ ...form, school_name: e.target.value })}
                placeholder={t("saas.school_name_placeholder", { defaultMessage: "e.g., St. Mary's Primary School" })}
                required
                fullWidth
              />
            </div>

            <div>
              <label className="label block mb-1" htmlFor="subdomain">{t("common.subdomain", { defaultMessage: "Subdomain" })}</label>
              <div className="relative flex items-center gap-2">
                <Input
                  id="subdomain"
                  value={form.subdomain}
                  onChange={(e) => {
                    setForm({ ...form, subdomain: e.target.value.toLowerCase() });
                    setSubdomainTouched(true);
                  }}
                  onBlur={() => setSubdomainTouched(true)}
                  placeholder={t("saas.subdomain_placeholder", { defaultMessage: "school-name" })}
                  required
                  fullWidth
                  className="pr-32"
                />
                <span className="absolute right-3 text-gray-400 text-sm font-medium pointer-events-none">
                  .skulapp.co.ke
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {t("saas.subdomain_hint", { defaultMessage: "Auto-generated from School Name. Must be unique." })}
              </p>
            </div>

            <div>
              <label className="label block mb-1" htmlFor="county">{t("common.county", { defaultMessage: "County" })}</label>
              <div className="relative">
                <Input
                  id="county"
                  value={form.county}
                  onChange={(e) => {
                    setForm({ ...form, county: e.target.value });
                    handleCountySearch(e.target.value);
                  }}
                  onFocus={() => handleCountySearch(form.county)}
                  onBlur={() => setTimeout(() => setCountyDropdownOpen(false), 200)}
                  placeholder={t("saas.county_placeholder", { defaultMessage: "Select or type county" })}
                  required
                  fullWidth
                />
                {countyDropdownOpen && filteredCounties.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {filteredCounties.map((county) => (
                      <li
                        key={county}
                        className="px-4 py-2 hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleCountySelect(county)}
                      >
                        {county}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-kenyan-red/10 flex items-center justify-center text-kenyan-red font-semibold text-sm">2</span>
            <h2 className="text-heading font-display">{t("saas.admin_user", { defaultMessage: "Primary School Admin" })}</h2>
          </div>
          <div className="border-t border-gray-100 pt-6 space-y-4">
            <div>
              <label className="label block mb-1" htmlFor="admin_full_name">{t("saas.admin_full_name", { defaultMessage: "Full Name" })}</label>
              <Input
                id="admin_full_name"
                value={form.admin_full_name}
                onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })}
                placeholder={t("saas.admin_full_name_placeholder", { defaultMessage: "e.g., Jane Wanjiku" })}
                required
                fullWidth
              />
              <p className="text-xs text-gray-500 mt-1">
                {t("saas.admin_full_name_hint", { defaultMessage: "Required for audit logs and personalized greetings." })}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label block mb-1" htmlFor="admin_email">{t("common.email", { defaultMessage: "Email Address" })}</label>
                <Input
                  id="admin_email"
                  type="email"
                  value={form.admin_email}
                  onChange={(e) => setForm({ ...form, admin_email: e.target.value })}
                  placeholder={t("auth.email_placeholder", { defaultMessage: "you@school.ke" })}
                  required
                  fullWidth
                />
              </div>

              <div>
                <label className="label block mb-1" htmlFor="admin_phone">{t("common.phone", { defaultMessage: "Phone Number" })}</label>
                <div className="relative flex items-center">
                  <span className="absolute left-3 text-gray-500 font-medium pointer-events-none">+254</span>
                  <Input
                    id="admin_phone"
                    type="tel"
                    value={form.admin_phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder={t("auth.phone_placeholder", { defaultMessage: "7XXXXXXXX" })}
                    required
                    fullWidth
                    className="pl-12"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {t("saas.admin_phone_hint", { defaultMessage: "Kenyan mobile number. Country code (+254) is added automatically." })}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-kenyan-red/10 flex items-center justify-center text-kenyan-red font-semibold text-sm">3</span>
            <h2 className="text-heading font-display">{t("saas.plan", { defaultMessage: "Subscription Plan" })}</h2>
          </div>
          <div className="border-t border-gray-100 pt-6">
            <p className="text-sm text-gray-600 mb-4">
              {t("saas.plan_hint", { defaultMessage: "Choose a plan that fits the school's size and needs. All plans include core features." })}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="radiogroup" aria-label="Subscription plans">
              {PLANS.map((plan) => (
                <label
                  key={plan.code}
                  className={`relative cursor-pointer p-4 rounded-xl border-2 transition-all ${
                    form.plan === plan.code
                      ? "border-kenyan-green bg-green-50 ring-2 ring-kenyan-green/20"
                      : plan.color
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={plan.code}
                    checked={form.plan === plan.code}
                    onChange={() => setForm({ ...form, plan: plan.code })}
                    className="sr-only"
                  />
                  {plan.badge && (
                    <span className="absolute -top-2 left-4 bg-kenyan-green text-white text-xs px-2 py-0.5 rounded-full font-medium">
                      {plan.badge}
                    </span>
                  )}
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-lg text-gray-900">{plan.title}</h3>
                      <p className="text-sm text-gray-500">{plan.target}</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900">
                      {plan.priceMonthly === 0 ? (
                        <span className="text-kenyan-green">Free</span>
                      ) : (
                        <>
                          KES {plan.priceMonthly.toLocaleString()}
                          <span className="text-base font-normal text-gray-500">/month</span>
                        </>
                      )}
                    </p>
                    <ul className="space-y-2 text-sm text-gray-600">
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <svg className="w-5 h-5 text-kenyan-green flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <Button variant="ghost" onClick={handleCancel}>
            {t("common.cancel", { defaultMessage: "Cancel" })}
          </Button>
          <Button variant="primary" type="submit" loading={processing} size="lg">
            {t("saas.create_and_invite", { defaultMessage: "Create School & Send Invite" })}
          </Button>
        </div>
      </form>
    </div>
  );
}