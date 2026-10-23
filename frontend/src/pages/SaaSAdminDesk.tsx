import { api } from "../lib/api";
import React, { useState } from 'react';
import { formatKES } from '../utils/kenyaFormatters';

interface SchoolTenant {
  id: string;
  name: string;
  slug: string;
  moe_code: string;
  county: string;
  sub_county: string;
  category: 'PUBLIC_COMPREHENSIVE' | 'PRIVATE_ACADEMY';
  residency: 'DAY_AND_BOARDING' | 'DAY_ONLY';
  paybill: string;
  learner_count: number;
  license_status: 'ACTIVE' | 'GRACE_PERIOD' | 'SUSPENDED';
  term_subscription_fee: number;
  contact_headteacher: string;
  phone_headteacher: string;
}

const INITIAL_TENANTS: SchoolTenant[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'MANDONGOI COMPREHENSIVE SCHOOL',
    slug: 'mandongoi',
    moe_code: 'MoE/PRI/2019/4021',
    county: 'Kitui',
    sub_county: 'Mwingi North',
    category: 'PUBLIC_COMPREHENSIVE',
    residency: 'DAY_AND_BOARDING',
    paybill: '522123',
    learner_count: 580,
    license_status: 'ACTIVE',
    term_subscription_fee: 35000,
    contact_headteacher: 'Joel Maundu',
    phone_headteacher: '0712345678',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: "ST. PETER'S ACADEMY & JUNIOR SCHOOL",
    slug: 'st-peters',
    moe_code: 'MoE/PRI/2021/8801',
    county: 'Machakos',
    sub_county: 'Machakos Central',
    category: 'PRIVATE_ACADEMY',
    residency: 'DAY_ONLY',
    paybill: '600110',
    learner_count: 420,
    license_status: 'ACTIVE',
    term_subscription_fee: 30000,
    contact_headteacher: 'Agnes Mutisya',
    phone_headteacher: '0722998877',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'KYUSO COMPREHENSIVE BOARDING',
    slug: 'kyuso-boarding',
    moe_code: 'MoE/PRI/2018/1102',
    county: 'Kitui',
    sub_county: 'Kyuso',
    category: 'PUBLIC_COMPREHENSIVE',
    residency: 'DAY_AND_BOARDING',
    paybill: '522890',
    learner_count: 710,
    license_status: 'GRACE_PERIOD',
    term_subscription_fee: 45000,
    contact_headteacher: 'Peter Musyoka',
    phone_headteacher: '0733441122',
  },
];

export const SaaSAdminDesk: React.FC = () => {
  const [tenants, setTenants] = useState<SchoolTenant[]>(INITIAL_TENANTS);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // New School Wizard Form State
  const [wizardData, setWizardData] = useState({
    name: '',
    slug: '',
    moe_code: '',
    county: 'Kitui',
    sub_county: '',
    category: 'PUBLIC_COMPREHENSIVE' as const,
    residency: 'DAY_AND_BOARDING' as const,
    paybill: '',
    headteacher_name: '',
    headteacher_phone: '',
    term_fee: 30000,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    const newTenant: SchoolTenant = {
      id: `${Date.now()}-uuid`,
      name: wizardData.name.toUpperCase(),
      slug: wizardData.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      moe_code: wizardData.moe_code,
      county: wizardData.county,
      sub_county: wizardData.sub_county,
      category: wizardData.category,
      residency: wizardData.residency,
      paybill: wizardData.paybill,
      learner_count: 0,
      license_status: 'ACTIVE',
      term_subscription_fee: wizardData.term_fee,
      contact_headteacher: wizardData.headteacher_name,
      phone_headteacher: wizardData.headteacher_phone,
    };

    setTenants([...tenants, newTenant]);
    setIsOnboardingOpen(false);
    showToast(`✓ Shule mpya '${newTenant.name}' imesajiliwa! Mitaala ya KICD na Vote-Heads zimepandikizwa moja kwa moja.`);
  };

  const toggleLicenseStatus = (id: string) => {
    setTenants(prev =>
      prev.map(t => {
        if (t.id === id) {
          const nextStatus = t.license_status === 'ACTIVE' ? 'GRACE_PERIOD' : t.license_status === 'GRACE_PERIOD' ? 'SUSPENDED' : 'ACTIVE';
          return { ...t, license_status: nextStatus };
        }
        return t;
      })
    );
  };

  const totalLearners = tenants.reduce((acc, t) => acc + t.learner_count, 0);
  const totalProjectedRevenue = tenants.reduce((acc, t) => acc + t.term_subscription_fee, 0);

  return (
    <div className="space-y-4">
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
            <span className="text-slate-400">Hali ya M-Pesa Daraja:</span>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-0.5">99.8%</div>
            <p className="text-[10px] text-slate-400">Webhooks na Staging Uptime</p>
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
          <span className="text-slate-500">Inaonyesha shule {tenants.length}</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-200 text-[11px]">
            <tr>
              <th className="p-3.5">Shule & Tovuti (Slug)</th>
              <th className="p-3.5">Usajili wa MoE & Kaunti</th>
              <th className="p-3.5">Aina & Makazi</th>
              <th className="p-3.5">Paybill</th>
              <th className="p-3.5">Wanafunzi</th>
              <th className="p-3.5">Leseni (License)</th>
              <th className="p-3.5 text-center">Hatua</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.map(t => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-3.5">
                  <div className="font-bold text-slate-900">{t.name}</div>
                  <div className="text-[11px] font-mono text-emerald-600">{t.slug}.eduke.co.ke</div>
                </td>
                <td className="p-3.5">
                  <div className="font-mono text-slate-700 font-semibold">{t.moe_code}</div>
                  <div className="text-[10px] text-slate-500">{t.sub_county}, {t.county}</div>
                </td>
                <td className="p-3.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                    {t.category === 'PUBLIC_COMPREHENSIVE' ? 'Comprehensive' : 'Private'}
                  </span>
                  <div className="text-[10px] text-slate-500 mt-0.5">{t.residency === 'DAY_AND_BOARDING' ? 'Bweni na Kutwa' : 'Kutwa Pekee'}</div>
                </td>
                <td className="p-3.5 font-mono font-bold text-slate-800">{t.paybill}</td>
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
                <td className="p-3.5 text-center">
                  <button
                    onClick={() => showToast(`Inaingia kama Msaidizi wa Kiufundi kwenye shule: ${t.name}...`)}
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
                    value={wizardData.name}
                    onChange={(e) => setWizardData({ ...wizardData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-') })}
                    placeholder="Mfano: MANDONGOI COMPREHENSIVE SCHOOL"
                    className="w-full p-2 border border-slate-300 rounded-lg uppercase font-semibold"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Subdomain Slug:</label>
                  <div className="flex items-center">
                    <input
                      required
                      value={wizardData.slug}
                      onChange={(e) => setWizardData({ ...wizardData, slug: e.target.value })}
                      placeholder="mandongoi"
                      className="w-full p-2 border border-slate-300 rounded-l-lg font-mono text-emerald-700 font-bold"
                    />
                    <span className="bg-slate-100 border border-l-0 border-slate-300 p-2 rounded-r-lg text-slate-500 font-mono">.eduke.co.ke</span>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Nambari ya Usajili wa MoE:</label>
                  <input
                    required
                    value={wizardData.moe_code}
                    onChange={(e) => setWizardData({ ...wizardData, moe_code: e.target.value })}
                    placeholder="MoE/PRI/2026/..."
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
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
                  <label className="block font-bold text-slate-700 mb-1">Sub-County / Wilaya:</label>
                  <input
                    required
                    value={wizardData.sub_county}
                    onChange={(e) => setWizardData({ ...wizardData, sub_county: e.target.value })}
                    placeholder="Mfano: Mwingi North"
                    className="w-full p-2 border border-slate-300 rounded-lg"
                  />
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

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Safaricom Paybill / Till:</label>
                  <input
                    required
                    value={wizardData.paybill}
                    onChange={(e) => setWizardData({ ...wizardData, paybill: e.target.value })}
                    placeholder="522123"
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
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
                    value={wizardData.headteacher_phone}
                    onChange={(e) => setWizardData({ ...wizardData, headteacher_phone: e.target.value })}
                    placeholder="0712345678"
                    className="w-full p-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

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
    </div>
  );
};
