import { api } from "../lib/api";
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
    // The registry reports school_type ('PUBLIC' / 'PRIVATE'); the row used to
    // claim "comprehensive" for every school regardless of what was stored.
    category:
      String(r.school_type ?? '').toUpperCase() === 'PUBLIC'
        ? 'PUBLIC_COMPREHENSIVE'
        : 'PRIVATE_ACADEMY',
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

/**
 * How old the registry copy on screen is. A clerk deciding on a licence change
 * needs to know whether they are looking at the last second or the last minute —
 * the 409 panel can only explain a stale read after the fact.
 */
export function describeRegistryAge(ms: number, t: (key: string, options?: any) => string): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return t('saas_desk.read_now');
  if (seconds < 60) return t('saas_desk.read_seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? t('saas_desk.read_minute') : t('saas_desk.read_minutes', { count: minutes });
}

export const SaaSAdminDesk: React.FC = () => {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<SchoolTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createdTenant, setCreatedTenant] = useState<CreatedTenant | null>(null);
  // The school an operator wants to inspect, and the audit reason they are typing.
  const [impTarget, setImpTarget] = useState<SchoolTenant | null>(null);
  const [impReason, setImpReason] = useState('');
  const [impError, setImpError] = useState<string | null>(null);
  const [impBusy, setImpBusy] = useState(false);
  // A licence change the platform refused because the school moved first. The
  // clerk's intent is kept so it can be applied to the state the platform shows.
  const [licenseConflict, setLicenseConflict] = useState<{
    id: string;
    name: string;
    desired: 'ACTIVE' | 'SUSPENDED';
    message: string;
  } | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const navigate = useNavigate();

  // The registry is read in four places — first paint, the poll, after a create
  // and after a status change — so there is one loader and one row mapping.
  const loadTenants = useCallback(async () => {
    const res = await api.get("/platform/tenants");
    const rows = Array.isArray(res.data) ? res.data : [];
    setTenants(rows.map(toSchoolTenant));
    setLastLoadedAt(Date.now());
  }, []);

  // Keep the age label moving between reads; the registry itself refreshes every
  // 30 seconds, so this only renders the number.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
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
    admin_email: '',
    headteacher_name: '',
    headteacher_phone: '',
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
    if (!schoolName) nextErrors.name = t('saas_desk.err_name');
    if (!subdomain) nextErrors.slug = t('saas_desk.err_slug');
    else if (subdomain.length > 50) {
      nextErrors.slug = t('saas_desk.err_slug_long');
    }
    if (!adminEmail) nextErrors.email = t('saas_desk.err_email');
    else if (!EMAIL_PATTERN.test(adminEmail)) nextErrors.email = t('saas_desk.err_email_invalid');
    if (!adminPhone) nextErrors.phone = t('saas_desk.err_phone');

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
      setWizardData({ name: '', slug: '', county: 'Kitui', category: 'PUBLIC_COMPREHENSIVE', admin_email: '', headteacher_name: '', headteacher_phone: '' });
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
        showToast(t('saas_desk.registered', { name: created.school_name || schoolName }));
      }
    } catch (err: any) {
      showToast(err.response?.data?.message || t('saas_desk.register_failed'));
    }
  };

  const applyLicenseStatus = async (
    id: string,
    next: 'ACTIVE' | 'SUSPENDED',
    expected: string,
  ) => {
    const t0 = tenants.find((t) => t.id === id);
    if (!t0) return;
    try {
      await api.put(`/platform/tenants/${id}/status`, {
        status: next,
        // The state this clerk was looking at. If the school has moved since, the
        // platform refuses instead of quietly overwriting the other operator's
        // decision, and the reasons it gives are specific enough to show as-is.
        expected_status: expected,
      });
      setLicenseConflict(null);
      // Show the clerk's own change at once, then re-read the registry. Another
      // operator may have changed the same school in the meantime, and their
      // write — committed after ours or not — is what the server will serve; our
      // local copy must not overwrite it.
      setTenants((prev) =>
        prev.map((t) => (t.id === id ? { ...t, license_status: next } : t)),
      );
      showToast(next === 'ACTIVE' ? t('saas_desk.activated', { name: t0.name }) : t('saas_desk.suspended', { name: t0.name }));
      await loadTenants().catch(() => { /* keep the local value if the reload fails */ });
    } catch (err: any) {
      const status = err?.response?.status;
      const reason = err?.response?.data?.message;
      if (status === 409 && reason) {
        // Another operator got there first. The platform's copy is now the only
        // true one, so read it and keep the intent: the clerk can apply it to what
        // the school actually is instead of hunting for the row again.
        await loadTenants().catch(() => { /* the panel still carries the reason */ });
        setLicenseConflict({ id, name: t0.name, desired: next, message: reason });
        return;
      }
      showToast(t('saas_desk.licence_failed'));
    }
  };

  const toggleLicenseStatus = (id: string) => {
    const t0 = tenants.find((t) => t.id === id);
    if (!t0) return;
    // Backend control plane only accepts ACTIVE | SUSPENDED.
    const next = t0.license_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setLicenseConflict(null);
    return applyLicenseStatus(id, next, t0.license_status);
  };

  /* Retry the refused change against the state the platform now holds. */
  const retryLicenseChange = async () => {
    if (!licenseConflict) return;
    const fresh = tenants.find((t) => t.id === licenseConflict.id);
    if (!fresh) {
      setLicenseConflict(null);
      return;
    }
    if (fresh.license_status === licenseConflict.desired) {
      // The change the clerk wanted is already in force; nothing left to send.
      showToast(t('saas_desk.already', { name: fresh.name, status: licenseConflict.desired }));
      setLicenseConflict(null);
      return;
    }
    await applyLicenseStatus(fresh.id, licenseConflict.desired, fresh.license_status);
  };

  /* Time-boxed impersonation: records a support session server-side.
   * The platform session cookie remains valid; impersonation is scoped by
   * the server-side impersonation_sessions table. The reason is a written form
   * field, not a browser prompt: it goes into Platform Audit, so it is checked
   * and its problems are shown next to the field that has to change. */
  const openImpersonation = (t0: SchoolTenant) => {
    setImpTarget(t0);
    setImpReason('');
    setImpError(null);
  };

  const closeImpersonation = () => {
    if (impBusy) return;
    setImpTarget(null);
    setImpReason('');
    setImpError(null);
  };

  const handleLoginAs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!impTarget) return;
    const reason = impReason.trim();
    if (reason.length < 10) {
      setImpError(
        reason ? t('saas_desk.reason_too_short') : t('saas_desk.reason_required'),
      );
      return;
    }
    setImpError(null);
    setImpBusy(true);
    const t0 = impTarget;
    try {
      const res = await api.post("/platform/impersonations", { tenant_id: t0.id, reason });
      sessionStorage.setItem("imp_school", res.data.school_name || t0.name);
      sessionStorage.setItem("imp_session_id", res.data.session_id);
      sessionStorage.setItem("imp_expires_at", res.data.expires_at);
      showToast(t('saas_desk.session_toast', { name: res.data.school_name || t0.name, expires: res.data.expires_at || '60 min' }));
      window.location.href = "/dashboard";
    } catch (err: any) {
      // The form stays open with the reason intact, so it can be corrected or
      // retried without typing the audit note again.
      setImpError(err.response?.data?.message || t('saas_desk.impersonation_failed'));
      setImpBusy(false);
    }
  };

  const totalLearners = tenants.reduce((acc, t) => acc + t.learner_count, 0);  const totalProjectedRevenue = tenants.reduce((acc, t) => acc + t.term_subscription_fee, 0);
  const totalStaff = tenants.reduce((acc, t) => acc + Number(t.staff_count || 0), 0);

  const filteredTenants = tenants.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <nav className="text-xs text-slate-500">{t('saas_desk.breadcrumb')}</nav>
      {/* SaaS Executive Metrics Bar */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-md border border-slate-800">
        <div className="flex flex-wrap justify-between items-center gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-xs font-black uppercase tracking-widest">
                EduKe Multi-Tenant SaaS
              </span>
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                {t('saas_desk.owner_console')}
              </span>
            </div>
            <h1 className="text-xl font-black tracking-tight text-white mt-1">
              {t('saas_desk.title')}
            </h1>
          </div>

          <button
            onClick={() => setIsOnboardingOpen(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>+ {t('saas_desk.onboard')}</span>
          </button>
        </div>

        {/* Global SaaS Platform Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 text-xs">
          <div>
            <span className="text-slate-400">{t('saas_desk.metric_schools')}</span>
            <div className="text-2xl font-black text-white font-mono mt-0.5">{t('saas_desk.metric_schools_value', { count: tenants.length })}</div>
            <p className="text-[10px] text-emerald-400">{t('saas_desk.rls_note')}</p>
          </div>
          <div>
            <span className="text-slate-400">{t('saas_desk.metric_learners')}</span>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">{totalLearners.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">{t('saas_desk.learners_note')}</p>
          </div>
          <div>
            <span className="text-slate-400">{t('saas_desk.metric_mrr')}</span>
            <div className="text-2xl font-black text-blue-400 font-mono mt-0.5">{formatKES(totalProjectedRevenue)}</div>
            <p className="text-[10px] text-slate-400">{t('saas_desk.mrr_note')}</p>
          </div>
          <div>
            <span className="text-slate-400">{t('saas_desk.metric_staff')}</span>
            <div className="text-2xl font-black text-blue-400 font-mono mt-0.5">{totalStaff.toLocaleString()}</div>
            <p className="text-[10px] text-slate-400">{t('saas_desk.staff_note')}</p>
          </div>
        </div>
      </div>

      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs rounded-xl font-bold animate-in fade-in">
          {toast}
        </div>
      )}

      {licenseConflict && (
        <div
          role="status"
          className="p-3 bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-xl flex flex-wrap items-center justify-between gap-2"
        >
          <p>
            <span className="font-black">{licenseConflict.name}</span> — {licenseConflict.message}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={retryLicenseChange}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
            >
              {licenseConflict.desired === 'SUSPENDED'
                ? t('saas_desk.retry_suspend')
                : t('saas_desk.retry_reinstate')}
            </button>
            <button
              onClick={() => setLicenseConflict(null)}
              className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 hover:border-amber-400 text-amber-900 font-bold cursor-pointer"
            >
              {t('saas_desk.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs">
          <span className="font-bold text-slate-800 uppercase tracking-wide">
            {t('saas_desk.registry_title')}
          </span>
          <div className="flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('saas_desk.search_placeholder')} className="px-2 py-1 border border-slate-300 rounded-lg text-xs" />
            <span className="text-slate-500">{t('saas_desk.showing', { count: filteredTenants.length })}</span>
            {lastLoadedAt !== null && (
              <span
                title={t('saas_desk.read_at', { time: new Date(lastLoadedAt).toLocaleTimeString() })}
                className={`text-[11px] font-bold ${
                  now - lastLoadedAt > 60_000 ? 'text-amber-700' : 'text-slate-500'
                }`}
              >
                {t('saas_desk.read_prefix')} {describeRegistryAge(now - lastLoadedAt, t)}
                {now - lastLoadedAt > 60_000 && ` ${t('saas_desk.stale')}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                loadTenants().catch(() => showToast(t('saas_desk.refresh_failed')));
              }}
              className="px-2 py-1 border border-slate-300 rounded-lg text-[11px] font-bold bg-white hover:border-slate-400 cursor-pointer"
            >
              {t('saas_desk.refresh')}
            </button>
          </div>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-200 text-[11px]">
            <tr>
              <th className="p-3.5">{t('saas_desk.col_school')}</th>
              <th className="p-3.5">{t('saas_desk.col_county')}</th>
              <th className="p-3.5">{t('saas_desk.col_type')}</th>
              <th className="p-3.5">{t('saas_desk.col_learners')}</th>
              <th className="p-3.5">{t('saas_desk.col_licence')}</th>
              <th className="p-3.5 text-center">{t('saas_desk.col_actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredTenants.map(tenant => (
              <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-3.5">
                  <div className="font-bold text-slate-900">{tenant.name}</div>
                  <div className="text-[11px] font-mono text-emerald-600">{tenant.slug}.eduke.co.ke</div>
                </td>
                <td className="p-3.5 font-mono text-slate-700">{tenant.county || '—'}</td>
                <td className="p-3.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                    {tenant.category === 'PUBLIC_COMPREHENSIVE' ? t('saas_desk.type_public') : t('saas_desk.type_private')}
                  </span>
                </td>
                <td className="p-3.5 font-mono font-semibold">{tenant.learner_count}</td>
                <td className="p-3.5">
                  <button
                    onClick={() => toggleLicenseStatus(tenant.id)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold cursor-pointer border ${
                      tenant.license_status === 'ACTIVE'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : tenant.license_status === 'GRACE_PERIOD'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-rose-50 text-rose-800 border-rose-300'
                    }`}
                  >
                    {tenant.license_status === 'ACTIVE' ? t('saas_desk.licence_active') : tenant.license_status === 'GRACE_PERIOD' ? t('saas_desk.licence_grace') : t('saas_desk.licence_suspended')}
                  </button>
                </td>
                <td className="p-3.5 text-center whitespace-nowrap space-x-1">
                  <Link
                    to={`/platform/tenants/${encodeURIComponent(tenant.id)}/setup`}
                    className="inline-block px-2.5 py-1 text-[11px] font-bold bg-white border border-slate-300 hover:border-slate-400 text-slate-800 rounded-lg"
                  >
                    {t('saas_desk.setup')}
                  </Link>
                  <button
                    onClick={() => openImpersonation(tenant)}
                    className="px-2.5 py-1 text-[11px] font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                  >
                    {t('saas_desk.login_as')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Audit-session reason. A browser prompt could not show what was wrong with
          the note, and the note is the record of why the school was opened. */}
      {impTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5">
              <h3 className="text-base font-black uppercase tracking-wide">
                {t('saas_desk.impersonation_title')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('saas_desk.impersonation_scope', { name: impTarget.name })}
              </p>
            </div>

            <form onSubmit={handleLoginAs} className="p-5 space-y-3 text-xs">
              <label htmlFor="imp-reason" className="block font-bold text-slate-700">
                {t('saas_desk.reason_label')}
              </label>
              <textarea
                id="imp-reason"
                autoFocus
                rows={3}
                value={impReason}
                onChange={(e) => {
                  setImpReason(e.target.value);
                  if (impError) setImpError(null);
                }}
                aria-invalid={impError ? true : undefined}
                aria-describedby="imp-reason-help"
                disabled={impBusy}
                placeholder={t('saas_desk.reason_placeholder')}
                className={`w-full p-2 border rounded-lg resize-y ${
                  impError ? 'border-red-400 bg-red-50' : 'border-slate-300'
                }`}
              />
              <p id="imp-reason-help" className="text-[10px] text-slate-500">
                {t('saas_desk.reason_help')}
              </p>
              {impError && (
                <p role="alert" className="text-[11px] font-bold text-red-600">
                  {impError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={closeImpersonation}
                  disabled={impBusy}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold disabled:opacity-60"
                >
                  {t('saas_desk.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={impBusy}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black shadow-md cursor-pointer disabled:opacity-60"
                >
                  {impBusy ? t('saas_desk.starting') : t('saas_desk.start_session')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4-Step Onboarding Wizard Modal */}
      {isOnboardingOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div>
                <h3 className="text-base font-black uppercase tracking-wide">
                  {t('saas_desk.wizard_title')}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t('saas_desk.wizard_subtitle')}
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
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_name')}</label>
                  <input
                    required
                    aria-invalid={errors.name ? true : undefined}
                    value={wizardData.name}
                    onChange={(e) => setWizardData({ ...wizardData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') })}
                    placeholder={t('saas_desk.name_placeholder')}
                    className={`w-full p-2 border rounded-lg uppercase font-semibold ${errors.name ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                  />
                  {errors.name && <p className="text-[11px] text-red-600 mt-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_slug')}</label>
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
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_county')}</label>
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
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_type')}</label>
                  <select
                    value={wizardData.category}
                    onChange={(e) => setWizardData({ ...wizardData, category: e.target.value as any })}
                    className="w-full p-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="PUBLIC_COMPREHENSIVE">{t('saas_desk.type_option_public')}</option>
                    <option value="PRIVATE_ACADEMY">{t('saas_desk.type_option_private')}</option>
                  </select>
                </div>

                <div className="col-span-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-1">
                  <p>{t('saas_desk.setup_note_1')}</p>
                  <p>{t('saas_desk.setup_note_2')}</p>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_headteacher')}</label>
                  <input
                    required
                    value={wizardData.headteacher_name}
                    onChange={(e) => setWizardData({ ...wizardData, headteacher_name: e.target.value })}
                    placeholder={t('saas_desk.headteacher_placeholder')}
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{t('saas_desk.field_phone')}</label>
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
                {t('saas_desk.field_email')}
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
                {t('saas_desk.email_help')}
              </p>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsOnboardingOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  {t('saas_desk.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black shadow-md cursor-pointer"
                >
                  {t('saas_desk.provision')}
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
                {t('saas_desk.created_title')}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">{createdTenant.schoolName}</p>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <span className="block font-bold text-slate-700 mb-1">{t('saas_desk.administrator')}</span>
                <div className="font-mono text-slate-800">{createdTenant.adminEmail}</div>
              </div>
              <div>
                <span className="block font-bold text-slate-700 mb-1">
                  {t('saas_desk.temp_password_label')}
                </span>
                <div className="font-mono text-base font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 select-all">
                  {createdTenant.tempPassword || '—'}
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  {t('saas_desk.temp_password_help')}
                </p>
              </div>
              <p className="text-[11px] text-slate-600">
                {t('saas_desk.next_step')}
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setCreatedTenant(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                >
                  {t('saas_desk.later')}
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
                  {t('saas_desk.go_to_setup')} →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
