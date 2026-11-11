import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import { api } from "../../lib/api";

type Check = { code: string; status: "ok"|"warn"|"block"; message: string };

export default function TenantSetupPage() {
  const { tenantId = "" } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [profile, setProfile] = useState({ school_name: "", county: "", sub_county: "", address: "", nemis_code: "", kemis_code: "", school_type: "", funding_mode: "" });
  const [calendar, setCalendar] = useState({ year_label: `${new Date().getFullYear()}`, start_date: "", end_date: "", set_current: true, terms: [{ term_name: "Term 1", start_date: "", end_date: "" }] });
  const [structure, setStructure] = useState({ streams: "A,B", class_groups: "G1,G2,G3" });
  const [finance, setFinance] = useState({ category_name: "Tuition", category_code: "TUITION", amount: "0", paybill: "", till: "" });
  const [seedStaff, setSeedStaff] = useState("Jane Doe,0712000000,jane@example.com");
  const [seedLearners, setSeedLearners] = useState("John Learner,ADM001");
  const [handoffAck, setHandoffAck] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/platform/tenants/${encodeURIComponent(tenantId)}/setup`);
      setData(res.data);
      const school = res.data?.school || res.data?.onboarding?.draft?.profile || {};
      setProfile((p) => ({ ...p, school_name: school.school_name || p.school_name, county: school.county || p.county, sub_county: school.sub_county || p.sub_county, address: school.address || p.address, nemis_code: school.nemis_code || p.nemis_code, kemis_code: school.kemis_code || p.kemis_code, school_type: school.school_type || p.school_type, funding_mode: school.funding_mode || p.funding_mode }));
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load onboarding state");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const readiness: Check[] = data?.readiness?.checks || [];
  const ready = !!data?.readiness?.ready;

  const run = async (key: string, fn: () => Promise<void>) => {
    setSaving(key); setError(null);
    try { await fn(); await load(); } catch (e: any) { setError(e?.response?.data?.message || e?.response?.data?.error || "Action failed"); }
    finally { setSaving(null); }
  };

  if (loading) return <ViewState state="loading" />;
  if (!tenantId) return <ViewState state="error" message="Missing tenant id" />;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-display font-display">School Setup: {tenantId}</h1>
          <p className="text-sm text-gray-600">Global Super Admin provisioning (platform-only, audited, resumable). School Admin customizes after handoff.</p>
        </div>
        <Link to="/platform/tenants" className="text-sm text-kenyan-red hover:underline">← Tenant Registry</Link>
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg">{error}</div>}

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Status:</span>
          <span className="px-2 py-0.5 rounded bg-gray-100 border">{data?.onboarding?.status || "PENDING_SETUP"}</span>
          <span className="font-medium">Step:</span>
          <span className="px-2 py-0.5 rounded bg-gray-100 border">{data?.onboarding?.current_step || "PROVISIONED"}</span>
        </div>
        <div>
          <h2 className="text-heading mb-2">Readiness checklist</h2>
          <ul className="space-y-1 text-sm">
            {readiness.length === 0 && <li className="text-gray-500">No checks yet.</li>}
            {readiness.map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <span className={c.status === "ok" ? "text-green-700" : c.status === "warn" ? "text-amber-700" : "text-red-700"}>{c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "×"}</span>
                <span><span className="font-medium">{c.code}:</span> {c.message}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <h2 className="text-heading">1. School profile</h2>
          {Object.entries(profile).map(([k, v]) => (
            <div key={k}>
              <label className="label block mb-1 capitalize">{k.replace(/_/g, " ")}</label>
              <Input value={v} onChange={(e: any) => setProfile({ ...profile, [k]: e.target.value })} />
            </div>
          ))}
          <Button variant="primary" loading={saving==="profile"} onClick={() => run("profile", async () => { await api.patch(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/profile`, profile); })}>Save profile</Button>
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="text-heading">2. Academic year & terms</h2>
          <label className="label block">Year label</label>
          <Input value={calendar.year_label} onChange={(e: any) => setCalendar({ ...calendar, year_label: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label block">Year start</label><Input type="date" value={calendar.start_date} onChange={(e: any) => setCalendar({ ...calendar, start_date: e.target.value })} /></div>
            <div><label className="label block">Year end</label><Input type="date" value={calendar.end_date} onChange={(e: any) => setCalendar({ ...calendar, end_date: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={calendar.set_current} onChange={(e) => setCalendar({ ...calendar, set_current: e.target.checked })} /> Set as current year</label>
          <h3 className="font-medium text-sm">Terms</h3>
          {calendar.terms.map((t, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <Input value={t.term_name} onChange={(e: any) => { const terms=[...calendar.terms]; terms[i]={...terms[i], term_name:e.target.value}; setCalendar({...calendar, terms}); }} placeholder="Term name" />
              <Input type="date" value={t.start_date} onChange={(e: any) => { const terms=[...calendar.terms]; terms[i]={...terms[i], start_date:e.target.value}; setCalendar({...calendar, terms}); }} />
              <Input type="date" value={t.end_date} onChange={(e: any) => { const terms=[...calendar.terms]; terms[i]={...terms[i], end_date:e.target.value}; setCalendar({...calendar, terms}); }} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setCalendar({ ...calendar, terms: [...calendar.terms, { term_name: `Term ${calendar.terms.length+1}`, start_date: "", end_date: "" }] })}>+ Term</Button>
            <Button variant="primary" loading={saving==="calendar"} onClick={() => run("calendar", async () => { await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/calendar`, calendar); })}>Save calendar</Button>
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="text-heading">3. Academic structure</h2>
          <label className="label block">Streams (comma separated)</label>
          <Input value={structure.streams} onChange={(e: any) => setStructure({ ...structure, streams: e.target.value })} placeholder="A,B" />
          <label className="label block">Class groups by grade IDs (comma separated)</label>
          <Input value={structure.class_groups} onChange={(e: any) => setStructure({ ...structure, class_groups: e.target.value })} placeholder="G1,G2,G3" />
          <p className="text-xs text-gray-500">Uses current academic year. Grade IDs must exist in system grades (e.g. G1..G9/PP1 as configured).</p>
          <Button variant="primary" loading={saving==="structure"} onClick={() => run("structure", async () => {
            const streams = structure.streams.split(",").map(s=>s.trim()).filter(Boolean);
            const grades = structure.class_groups.split(",").map(s=>s.trim()).filter(Boolean);
            const class_groups = grades.map(g => ({ grade_id: g, stream_name: streams[0] || "" }));
            await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/structure`, { streams, class_groups });
          })}>Save structure</Button>
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="text-heading">4. Finance baseline</h2>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label block">Category name</label><Input value={finance.category_name} onChange={(e:any)=>setFinance({...finance, category_name:e.target.value})} /></div>
            <div><label className="label block">Category code</label><Input value={finance.category_code} onChange={(e:any)=>setFinance({...finance, category_code:e.target.value})} /></div>
          </div>
          <div><label className="label block">Default structure amount (KES)</label><Input value={finance.amount} onChange={(e:any)=>setFinance({...finance, amount:e.target.value})} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label block">Paybill (optional)</label><Input value={finance.paybill} onChange={(e:any)=>setFinance({...finance, paybill:e.target.value})} /></div>
            <div><label className="label block">Till (optional)</label><Input value={finance.till} onChange={(e:any)=>setFinance({...finance, till:e.target.value})} /></div>
          </div>
          <Button variant="primary" loading={saving==="finance"} onClick={() => run("finance", async () => {
            const amount = parseFloat(finance.amount || "0") || 0;
            const channels: any[] = [];
            if (finance.paybill) channels.push({ channel_type: "PAYBILL", shortcode_or_account: finance.paybill, label: "Main Paybill", is_default: true });
            if (finance.till) channels.push({ channel_type: "TILL", shortcode_or_account: finance.till, label: "Main Till", is_default: channels.length===0 });
            await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/finance`, {
              categories: [{ name: finance.category_name, code: finance.category_code, is_mandatory: true }],
              structures: amount > 0 ? [{ grade_id: "G1", amount }] : [],
              channels,
            });
          })}>Save finance baseline</Button>
          <p className="text-xs text-gray-500">Creates baseline records; School Admin can refine categories/structures per grade/term later.</p>
        </Card>

        <Card className="p-4 space-y-3 lg:col-span-2">
          <h2 className="text-heading">5. Optional seeds (staff & learners)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label block mb-1">Staff (one per line: First Last,Phone,Email)</label>
              <textarea className="w-full border rounded-lg p-2 text-sm min-h-[100px]" value={seedStaff} onChange={(e)=>setSeedStaff(e.target.value)} />
            </div>
            <div>
              <label className="label block mb-1">Learners (one per line: First Last,AdmissionNo)</label>
              <textarea className="w-full border rounded-lg p-2 text-sm min-h-[100px]" value={seedLearners} onChange={(e)=>setSeedLearners(e.target.value)} />
            </div>
          </div>
          <Button variant="secondary" loading={saving==="seeds"} onClick={() => run("seeds", async () => {
            const staff = seedStaff.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const [name,phone,email]=l.split(",").map(x=>x?.trim()||""); const parts=name.split(" "); return { first_name: parts[0]||"", last_name: parts.slice(1).join(" ")||"Staff", phone_number: phone, email }; });
            const learners = seedLearners.split("\n").map(l=>l.trim()).filter(Boolean).map(l=>{ const [name,adm]=l.split(",").map(x=>x?.trim()||""); const parts=name.split(" "); return { first_name: parts[0]||"", last_name: parts.slice(1).join(" ")||"Learner", admission_number: adm }; });
            await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/seeds`, { staff, learners });
          })}>Seed optional data</Button>
        </Card>
      </div>

      <Card className="p-4 space-y-3">
        <h2 className="text-heading">6. Readiness & handoff</h2>
        <p className="text-sm text-gray-600">Complete setup when blockers are resolved. After handoff, School Admin signs in and customizes school data.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={saving==="complete"} onClick={() => run("complete", async () => { await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/complete`); })} disabled={!ready && false}>Mark ready for handoff</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handoffAck} onChange={(e)=>setHandoffAck(e.target.checked)} /> Credentials/instructions communicated to School Admin</label>
          <Button variant="secondary" loading={saving==="handoff"} disabled={!handoffAck} onClick={() => run("handoff", async () => { await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/handoff`); })}>Mark handed off</Button>
        </div>
        <p className="text-xs text-amber-700">Super Admin remains platform-only (no tenant membership). Use existing school admin flows or audited impersonation only for verification if needed.</p>
      </Card>
    </div>
  );
}
