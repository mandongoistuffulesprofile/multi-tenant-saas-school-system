import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";
import Button from "../components/atoms/Button";

// Institutional identity printed on CBC report cards, leaving certificates and
// M-Pesa receipts. MoE registration and KNEC centre code are what make those
// documents valid outside the school gate.
const PROFILE_FIELDS: { key: string; label: string; placeholder?: string; mono?: boolean }[] = [
  { key: "school_name", label: "School Name" },
  { key: "moe_registration_number", label: "MoE Registration Number", placeholder: "e.g. MOE/PRI/12839/2018", mono: true },
  { key: "knec_code", label: "KNEC Centre Code (KPSEA / KJSEA)", placeholder: "e.g. 20401021", mono: true },
  { key: "nemis_code", label: "NEMIS School Code", placeholder: "e.g. 01012001", mono: true },
  { key: "kemis_code", label: "KEMIS School Code", mono: true },
  { key: "county", label: "County", placeholder: "e.g. Nairobi" },
  { key: "sub_county", label: "Sub-County", placeholder: "e.g. Westlands" },
  { key: "zone_ward", label: "Zone / Ward" },
  { key: "address", label: "Address", placeholder: "Physical address" },
  { key: "default_locale", label: "Default Locale", placeholder: "e.g. en-KE" },
  { key: "hosts_junior", label: "Hosts Junior School", placeholder: "true/false" },
  { key: "kra_pin", label: "KRA PIN (eTIMS receipts)", placeholder: "e.g. P051234567Z", mono: true },
  { key: "mpesa_account_format", label: "M-Pesa Account Format", placeholder: "STUDENT_ADM_NO", mono: true },
];

export default function SchoolProfilePage() {
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
      .catch(() => toast("Failed to load school profile", { type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/school", form);
      const refreshed = await api.get("/school");
      applySchool(refreshed.data);
      toast("Institutional details updated for official MoE / KNEC documents", { type: "success" });
    } catch (err: any) {
      toast(err?.response?.data?.message || "Failed to update school profile", { type: "error" });
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
            <p className="text-body mt-4">School not found</p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-heading mb-2">School Profile</h2>
          <p className="text-caption text-muted mb-6">
            These details appear on official CBC report cards, leaving certificates and M-Pesa receipts.
          </p>
          <form onSubmit={handleSave} className="card p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PROFILE_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="label">{field.label}</label>
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
              <label className="label">School Motto</label>
              <input
                className="input-field italic"
                placeholder="e.g. Strive for Excellence"
                value={form.school_motto ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, school_motto: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Hosts Junior School</label>
              <select
                className="input-field"
                value={form.hosts_junior ?? "false"}
                onChange={(e) => setForm((f) => ({ ...f, hosts_junior: e.target.value }))}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
            <div>
              <label className="label">Default Locale</label>
              <input
                className="input-field"
                placeholder="e.g. en-KE"
                value={form.default_locale ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, default_locale: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Physical Address</label>
              <input
                className="input-field"
                placeholder="P.O. Box / Street address"
                value={form.address ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="label">School Logo</label>
              <div className="flex items-center gap-4">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-16 h-16 rounded object-cover border" />
                ) : (
                  <div className="w-16 h-16 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-400">No logo</div>
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
              <label className="label">Head Signature</label>
              <div className="flex items-center gap-4">
                {headSigPreview ? (
                  <img src={headSigPreview} alt="Signature" className="w-24 h-12 rounded object-cover border" />
                ) : (
                  <div className="w-24 h-12 rounded bg-gray-100 flex items-center justify-center text-xs text-gray-400">No signature</div>
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
                Subdomain: <span className="text-gray-900">{school.subdomain}.skulapp.ke</span>
              </div>
              <div>
                Status: <span className="text-gray-900">{school.status ?? "—"}</span>
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button variant="primary" type="submit" loading={saving}>
                Save Institutional Settings
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
}
