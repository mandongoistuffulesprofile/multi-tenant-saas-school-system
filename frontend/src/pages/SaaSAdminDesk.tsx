import { api } from "../lib/api";
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatKES } from '../utils/kenyaFormatters';

type WizardField = 'name' | 'slug' | 'email' | 'phone';
type WizardErrors = Partial<Record<WizardField, string>>;

/** What the platform returns once a school exists; the password is shown once. */
interface CreatedTenant {
  tenantId: string;
  schoolName: string;
  adminEmail: string;
  tempPassword: string;
}

// Mirrors what POST /platform/tenants insists on: the school name, the
// subdomain (which becomes the tenant_id, a varchar(50)), a unique
// administrator email and a phone number for that account.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Same normalisation the API applies, so the previewed host matches what is stored. */
function normalizeSubdomain(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface SchoolTenant {
  id: string;
  name: string;
  slug: string;
  county: string;
  category: 'PUBLIC_COMPREHENSIVE' | 'PRIVATE_ACADEMY';
  residency: 'DAY_AND_BOARDING' | 'DAY_ONLY';
  learner_count: number;
  staff_count?: number;
  license_status: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED';
  term_subscription_fee: number;
  contact_headteacher: string;
  phone_headteacher: string;
}



// Plan pricing must match the platform control plane (server.js PLATFORM_PLANS).
const PLAN_FEE: Record<string, number> = { BASIC: 0, STANDARD: 9900, ENTERPRISE: 24900 };

/** The platform registry row, as the desk renders it. */
function toSchoolTenant(r: any): SchoolTenant {
  return {
    id: r.tenant_id,
    name: r.school_name || r.subdomain,
    slug: r.subdomain || '',
    county: r.county || '',
    category: 'PUBLIC_COMPREHENSIVE',
    residency: 'DAY_ONLY',
    learner_count: Number(r.learners ?? r.student_count ?? 0),
    license_status: (r.status || (r.active ? 'ACTIVE' : 'SUSPENDED')) as SchoolTenant['license_status'],
    term_subscription_fee: PLAN_FEE[r.plan_code] ?? 0,
    contact_headteacher: '',
    phone_headteacher: '',
    staff_count: Number(r.staff_count ?? 0),
  };
}

/**
 * The platform API stores the head teacher's phone as the account's login
 * number and rejects a blank one, so the form has to settle on the canonical
 * 2547XXXXXXXX / 2541XXXXXXXX form before it submits. Accepts the way a school
 * would write it: 0712 345 678, +254 712 345 678 or 254712345678.
 */
export function normalizeKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  let national: string;
  if (/^0[17]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^[17]\d{8}$/.test(digits)) national = digits;
  else if (/^254[17]\d{8}$/.test(digits)) national = digits.slice(3);
  else return null;
  return `254${national}`;
}

export const SaaSAdminDesk: React.FC = () => {
  const [tenants, setTenants] = useState<SchoolTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createdTenant, setCreatedTenant] = useState<CreatedTenant | null>(null);
  const navigate = useNavigate();

  // The registry is read in four places — first paint, the poll, after a create
  // and after a status change — so there is one loader and one row mapping.
  const loadTenants = useCallback(async () => {
    const res = await api.get("/platform/tenants");
    const rows = Array.isArray(res.data) ? res.data : [];
    setTenants(rows.map(toSchoolTenant));
  }, []);

  useEffect(() => {
    let alive = true;
    loadTenants()
      .catch(() => { /* console handled by axios interceptor */ })
      .finally(() => alive && setLoading(false));
    const iv = setInterval(() => {
      if (alive) loadTenants().catch(() => {});
    }, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [loadTenants]);

  // New School Wizard Form State
  const [wizardData, setWizardData] = useState({
    name: '',
    slug: '',
    county: 'Kitui',
    category: 'PUBLIC_COMPREHENSIVE' as const,
    residency: 'DAY_AND_BOARDING' as const,
    admin_email: '',
    headteacher_name: '',
    headteacher_phone: '',
    term_fee: 30000,
  });

  const [errors, setErrors] = useState<WizardErrors>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    // Check everything the API requires before sending it, so a missing field
    // reports next to its input instead of coming back as a server error.
    const schoolName = wizardData.name.trim();
    const subdomain = normalizeSubdomain(wizardData.slug);
    const adminEmail = wizardData.admin_email.trim().toLowerCase();
    const adminPhone = normalizeKenyanPhone(wizardData.headteacher_phone);

    const nextErrors: WizardErrors = {};
    if (!schoolName) nextErrors.name = 'Jina la shule ni lazima.';
    if (!subdomain) nextErrors.slug = 'Subdomain ni lazima.';
    else if (subdomain.length > 50) {
      nextErrors.slug = 'Subdomain lazima iwe herufi 50 au chini — inatumika kama kitambulisho cha shule.';
    }
    if (!adminEmail) nextErrors.email = 'Barua pepe ya msimamizi ni lazima.';
    else if (!EMAIL_PATTERN.test(adminEmail)) nextErrors.email = 'Barua pepe si sahihi, mfano admin@shule.ac.ke.';
    if (!adminPhone) nextErrors.phone = 'Weka nambari ya simu halali ya Mwalimu Mkuu, mfano 0712345678.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    try {
      const res = await api.post('/platform/tenants', {
        school_name: schoolName,
        subdomain,
        admin_email: adminEmail,
        admin_phone: adminPhone,
        // The form's "school type" choice decides both fields the API stores;
        // sending neither would have registered every school as PRIVATE/CUSTOM.
        school_type: wizardData.category === 'PUBLIC_COMPREHENSIVE' ? 'PUBLIC' : 'PRIVATE',
        funding_mode: wizardData.category === 'PUBLIC_COMPREHENSIVE' ? 'CAPITATION' : 'CUSTOM',
        admin_full_name: wizardData.headteacher_name.trim(),
        plan_code: 'STANDARD',
        county: wizardData.county || '',
      });
      const created = res.data || {};
      await loadTenants();
      setIsOnboardingOpen(false);
      setWizardData({ name: '', slug: '', county: 'Kitui', category: 'PUBLIC_COMPREHENSIVE', residency: 'DAY_AND_BOARDING', admin_email: '', headteacher_name: '', headteacher_phone: '', term_fee: 30000 });
      setErrors({});
      // The temporary password is only ever returned here, so it is handed over on
      // screen with the way into setup — a toast would vanish with the navigation.
      if (created.tenant_id) {
        setCreatedTenant({
          tenantId: created.tenant_id,
          schoolName: created.school_name || schoolName,
          adminEmail: created.admin_email || adminEmail,
          tempPassword: created.temp_password || '',
        });
      } else {
        showToast(`✓ '${created.school_name || schoolName}' imesajiliwa.`);
      }
    } catch (err: any) {
      showToast(err.response?.data?.message || 'Usajili umeshindikana.');
    }
  };

  const toggleLicenseStatus = async (id: string) => {
    const t0 = tenants.find((t) => t.id === id);
    if (!t0) return;
    // Backend control plane only accepts ACTIVE | SUSPENDED.
    const next = t0.license_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await api.put(`/platform/tenants/${id}/status`, { status: next });
      // Show the clerk's own change at once, then re-read the registry. Another
      // operator may have changed the same school in the meantime, and their
      // write — committed after ours or not — is what the server will serve; our
      // local copy must not overwrite it.
      setTenants((prev) =>
        prev.map((t) => (t.id === id ? { ...t, license_status: next } : t)),
      );
      showToast(next === 'ACTIVE' ? `✓ '${t0.name}' imehudumiwa tena (ACTIVE).` : `⚠ '${t0.name}' imesimamishwa (SUSPENDED). Watumiaji hawawezi kuingia.`);
      await loadTenants().catch(() => { /* keep the local value if the reload fails */ });
    } catch {
      showToast('Imeshindikana kubadilisha hali ya shule. Jaribu tena.');
    }
  };

  /* Time-boxed impersonation: records a support session server-side.
   * The platform session cookie remains valid; impersonation is scoped by
   * the server-side impersonation_sessions table. */
  const handleLoginAs = async (t0: SchoolTenant) => {
    const reason = window.prompt(`Sababu ya kuingia kama ${t0.name} (huingia kwenye Platform Audit):`);
    if (!reason) return;
    try {
      const res = await api.post("/platform/impersonations", { tenant_id: t0.id, reason });
      sessionStorage.setItem("imp_school", res.data.school_name || t0.name);
      sessionStorage.setItem("imp_session_id", res.data.session_id);
      sessionStorage.setItem("imp_expires_at", res.data.expires_at);
      showToast(`⚠ Session ya ukaguzi: ${res.data.school_name || t0.name} (hadi ${res.data.expires_at || "60 min"}).`);
      window.location.href = "/dashboard";
    } catch (err: any) {
      showToast(err.response?.data?.message || "Impersonation imeshindikana.");
    }
  };

  const totalLearners = tenants.reduce((acc, t) => acc + t.learner_count, 0);  const totalProjectedRevenue = tenants.reduce((acc, t) => acc + t.term_subscription_fee, 0);
  const totalStaff = tenants.reduce((acc, t) => acc + Number(t.staff_count || 0), 0);

  const filteredTenants = tenants.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <nav className="text-xs text-slate-500">Platform / SaaS Admin Desk</nav>
      {/* SaaS Executive Metrics Bar */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-md border border-slate-800">
        <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-xs font-black uppercase tracking-widest">
                EduKe Multi-Tenant SaaS
              </span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                Platform Owner Console
              </span>
            </div>
            <h1 className="text-xl font-black tracking-tight text-white mt-1">
              Usimamizi wa Shule Zote (SaaS Multi-School Directory)
            </h1>
          </div>

          <button
            onClick={() => setIsOnboardingOpen(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>+ Sajili Shule Mpya (Onboard School)</span>
          </button>
        </div>

        {/* Global SaaS Platform Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 text-xs">
          <div>
            <span className="text-slate-400">Shule Zinazotumia Mfumo:</span>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{tenants.length} Shule</div>
            <p className="text-[10px] text-emerald-400">100% PostgreSQL RLS Isolated</p>
          </div>
          <div>
            <span className="text-slate-400">Jumla ya Wanafunzi (Active):</span>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">{totalLearners.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">Wenye NEMIS UPI na KPSEA</p>
          </div>
          <div>
            <span className="text-slate-400">Ada ya Mfumo (Termly MRR):</span>
            <div className="text-2xl font-black text-blue-400 font-mono mt-0.5">{formatKES(totalProjectedRevenue)}</div>
            <p className="text-[10px] text-slate-400">Makadirio ya Mapato ya SaaS</p>
          </div>
          <div>
            <span className="text-slate-400">Jumla ya Walimu na Wafanyakazi:</span>
            <div className="text-2xl font-black text-blue-400 font-mono mt-0.5">{totalStaff.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">Across all tenant schools</p>
          </div>
        </div>
      </div>

      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs rounded-xl font-bold animate-in fade-in">
          {toast}
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-800 uppercase tracking-wide">
            Orodha ya Shule Zilizosajiliwa (Tenant Registry)
          </span>
          <div className="flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tafuta shule..." className="px-2 py-1 border border-slate-300 rounded-lg text-xs" />
            <span className="text-slate-500">Inaonyesha shule {filteredTenants.length}</span>
          </div>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-200 text-[11px]">
            <tr>
              <th className="p-3.5">Shule & Tovuti (Slug)</th>
              <th className="p-3.5">Kaunti (County)</th>
              <th className="p-3.5">Aina & Makazi</th>
              <th className="p-3.5">Wanafunzi</th>
              <th className="p-3.5">Leseni (License)</th>
              <th className="p-3.5 text-center">Hatua</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTenants.map(t => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-3.5">
                  <div className="font-bold text-slate-900">{t.name}</div>
                  <div className="text-[11px] font-mono text-emerald-600">{t.slug}.eduke.co.ke</div>
                </td>
                <td className="p-3.5 font-mono text-slate-700">{t.county || '—'}</td>
                <td className="p-3.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                    {t.category === 'PUBLIC_COMPREHENSIVE' ? 'Comprehensive' : 'Private'}
                  </span>
                  <div className="text-[10px] text-slate-500 mt-0.5">{t.residency === 'DAY_AND_BOARDING' ? 'Bweni na Kutwa' : 'Kutwa Pekee'}</div>
                </td>
                <td className="p-3.5 font-mono font-semibold">{t.learner_count}</td>
                <td className="p-3.5">
                  <button
                    onClick={() => toggleLicenseStatus(t.id)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer border ${
                      t.license_status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : t.license_status === 'GRACE_PERIOD'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-rose-50 text-rose-800 border-rose-300'
                    }`}
                  >
                    {t.license_status === 'ACTIVE' ? '● Leseni Hai' : t.license_status === 'GRACE_PERIOD' ? '◐ Grace Period' : '✕ Imesimamishwa'}
                  </button>
                </td>
                <td className="p-3.5 text-center whitespace-nowrap space-x-1">
                  <Link
                    to={`/platform/tenants/${encodeURIComponent(t.id)}/setup`}
                    className="inline-block px-2.5 py-1 text-[11px] font-bold bg-white border border-slate-300 hover:border-slate-400 text-slate-800 rounded-lg"
                  >
                    Setup
                  </Link>
                  <button
                    onClick={() => handleLoginAs(t)}
                    className="px-2.5 py-1 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                  >
                    Fungua Shule (Login As)
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4-Step Onboarding Wizard Modal */}
      {isOnboardingOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <h3 className="text-base font-black uppercase tracking-wide">
                  Sajili Shule Mpya (New Tenant Onboarding)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Itapandikiza kiotomatiki Mitaala ya KICD, Akaunti 1 & 2, na M-Pesa Paybill.
                </p>
              </div>
              <button
                onClick={() => setIsOnboardingOpen(false)}
                className="text-slate-400 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTenant} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Jina Kamili la Shule (Official School Name):</label>
                  <input
                    required
                    aria-invalid={errors.name ? true : undefined}
                    value={wizardData.name}
                    onChange={(e) => setWizardData({ ...wizardData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') })}
                    placeholder="Mfano: MANDONGOI COMPREHENSIVE SCHOOL"
                    className={`w-full p-2 border rounded-lg uppercase font-semibold ${errors.name ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                  />
                  {errors.name && <p className="text-[11px] text-red-600 mt-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Subdomain Slug:</label>
                  <div className="flex items-center">
                    <input
                      required
                      aria-invalid={errors.slug ? true : undefined}
                      value={wizardData.slug}
                      onChange={(e) => {
                        setWizardData({ ...wizardData, slug: e.target.value });
                        if (errors.slug) setErrors({ ...errors, slug: undefined });
                      }}
                      placeholder="mandongoi"
                      className={`w-full p-2 border rounded-l-lg font-mono text-emerald-700 font-bold ${errors.slug ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                    />
                    <span className="bg-slate-100 border border-l-0 border-slate-300 p-2 rounded-r-lg text-slate-500 font-mono">.eduke.co.ke</span>
                  </div>
                  {errors.slug && <p className="text-[11px] text-red-600 mt-1">{errors.slug}</p>}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Kaunti (County):</label>
                  <select
                    value={wizardData.county}
                    onChange={(e) => setWizardData({ ...wizardData, county: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Kitui">Kitui County</option>
                    <option value="Machakos">Machakos County</option>
                    <option value="Makueni">Makueni County</option>
                    <option value="Nairobi">Nairobi County</option>
                    <option value="Kiambu">Kiambu County</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Aina ya Shule:</label>
                  <select
                    value={wizardData.category}
                    onChange={(e) => setWizardData({ ...wizardData, category: e.target.value as any })}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="PUBLIC_COMPREHENSIVE">Public Comprehensive (Primary + Junior)</option>
                    <option value="PRIVATE_ACADEMY">Private Academy</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Makazi ya Wanafunzi:</label>
                  <select
                    value={wizardData.residency}
                    onChange={(e) => setWizardData({ ...wizardData, residency: e.target.value as any })}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="DAY_AND_BOARDING">Bweni na Kutwa (Day & Boarding)</option>
                    <option value="DAY_ONLY">Kutwa Pekee (Day Only)</option>
                  </select>
                </div>

                <div className="col-span-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600">
                  Nambari za MoE/NEMIS, wilaya na M-Pesa Paybill hurekodiwa kwenye{' '}
                  <span className="font-bold">Setup ya shule</span> baada ya kusajiliwa, si hapa.
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Ada ya SaaS kwa Muhula (KES):</label>
                  <input
                    type="number"
                    value={wizardData.term_fee}
                    onChange={(e) => setWizardData({ ...wizardData, term_fee: Number(e.target.value) })}
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Jina la Mwalimu Mkuu:</label>
                  <input
                    required
                    value={wizardData.headteacher_name}
                    onChange={(e) => setWizardData({ ...wizardData, headteacher_name: e.target.value })}
                    placeholder="Mfano: Joel Maundu"
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nambari ya Simu ya Mwalimu Mkuu:</label>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    aria-invalid={errors.phone ? true : undefined}
                    value={wizardData.headteacher_phone}
                    onChange={(e) => {
                      setWizardData({ ...wizardData, headteacher_phone: e.target.value });
                      if (errors.phone) setErrors({ ...errors, phone: undefined });
                    }}
                    placeholder="0712345678"
                    className={`w-full p-2 border rounded-lg font-mono ${errors.phone ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                  />
                  {errors.phone && (
                    <p className="text-[11px] text-red-600 mt-1">{errors.phone}</p>
                  )}
                </div>
              </div>

              <label className="block text-xs font-black text-slate-600 uppercase tracking-wider mb-1">
                Admin Email (School Administrator Login) *
              </label>
              <input
                type="email"
                required
                aria-invalid={errors.email ? true : undefined}
                value={wizardData.admin_email}
                onChange={(e) => {
                  setWizardData({ ...wizardData, admin_email: e.target.value });
                  if (errors.email) setErrors({ ...errors, email: undefined });
                }}
                placeholder="admin@newschool.ac.ke"
                className={`w-full p-2 border rounded-lg font-mono ${errors.email ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
              />
              {errors.email && <p className="text-[11px] text-red-600 mt-1 mb-3">{errors.email}</p>}
              <p className="text-[10px] text-slate-400 mb-3">
                A temporary password is generated server-side and shown exactly once after onboarding.
              </p>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsOnboardingOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Ghairi
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-md cursor-pointer"
                >
                  Tekeleza Usajili (Provision Tenant)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hand-over after onboarding. The temporary password is returned exactly
          once, so it is shown here — where it survives — rather than in a toast
          that the move into setup would wipe out. */}
      {createdTenant && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5">
              <h3 className="text-base font-black uppercase tracking-wide">
                Shule imesajiliwa (Tenant provisioned)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">{createdTenant.schoolName}</p>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <span className="block font-bold text-slate-700 mb-1">Msimamizi (Administrator):</span>
                <div className="font-mono text-slate-800">{createdTenant.adminEmail}</div>
              </div>
              <div>
                <span className="block font-bold text-slate-700 mb-1">
                  Password ya muda — inaonyeshwa mara moja:
                </span>
                <div className="font-mono text-base font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 select-all">
                  {createdTenant.tempPassword || '—'}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Mpe msimamizi sasa; haitaonyeshwa tena na ataombwa kuibadilisha.
                </p>
              </div>
              <p className="text-[11px] text-slate-600">
                Hatua inayofuata ni Setup: mitaala, kalenda, madarasa na njia za malipo.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setCreatedTenant(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  Baadaye
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tenantId = createdTenant.tenantId;
                    setCreatedTenant(null);
                    navigate(`/platform/tenants/${encodeURIComponent(tenantId)}/setup`);
                  }}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-md cursor-pointer"
                >
                  Nenda kwenye Setup →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
