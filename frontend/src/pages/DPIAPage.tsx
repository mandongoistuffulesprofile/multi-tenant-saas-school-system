import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type DPIA = {
  dpia_id: string;
  tenant_id: string;
  processing_activity: string;
  description: string;
  risk_level: string;
  mitigation_measures: string | null;
  status: string;
  assessed_by: string | null;
  review_date: string | null;
  created_at: string;
  updated_at: string;
};

const RISK_OPTIONS = ["LOW", "MEDIUM", "HIGH"];

export default function DPIAPage() {
  const [dpias, setDPIAs] = useState<DPIA[]>([]);
  const [loading, setLoading] = useState(true);
  const [dpiaModal, setDPIAModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const [dpiaForm, setDPIAForm] = useState({
    processing_activity: "",
    description: "",
    risk_level: "LOW",
    mitigation_measures: "",
    review_date: "",
  });

  const resetForm = () => {
    setDPIAForm({ processing_activity: "", description: "", risk_level: "LOW", mitigation_measures: "", review_date: "" });
  };

  useEffect(() => {
    loadDPIAs();
  }, []);

  const loadDPIAs = () => {
    // There's no ListDPIA endpoint yet, so we'll handle the error gracefully
    api.get<DPIA[]>("/compliance/dpia")
      .then((res) => setDPIAs(res.data || []))
      .catch(() => setDPIAs([]))
      .finally(() => setLoading(false));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/compliance/dpia", {
        processing_activity: dpiaForm.processing_activity,
        description: dpiaForm.description,
        risk_level: dpiaForm.risk_level,
        mitigation_measures: dpiaForm.mitigation_measures || undefined,
        review_date: dpiaForm.review_date || undefined,
      });
      toast("DPIA created", { type: "success" });
      setDPIAModal(false);
      resetForm();
      loadDPIAs();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create DPIA", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setDPIAModal(true);
  };

  const riskBadge = (risk: string) => {
    const cls = risk === "HIGH" ? "bg-red-100 text-red-700"
      : risk === "MEDIUM" ? "bg-amber-100 text-amber-700"
      : "bg-green-100 text-green-700";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{risk}</span>;
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Data Protection Impact Assessments</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateModal}>
              Add DPIA
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={dpias}
              emptyMessage="No DPIAs recorded"
              columns={[
                { key: "processing_activity", header: "Processing Activity" },
                { key: "risk_level", header: "Risk Level", render: (r) => riskBadge(r.risk_level) },
                { key: "status", header: "Status" },
                { key: "review_date", header: "Review Date", render: (r) => fmtDate(r.review_date) },
                { key: "created_at", header: "Created", render: (r) => fmtDate(r.created_at) },
              ]}
            />
          )}

          {/* Create DPIA Modal */}
          {dpiaModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setDPIAModal(false); resetForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "40rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add DPIA</h3>
                <form onSubmit={handleSubmit}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Processing Activity *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Automated learner profiling for admissions"
                      value={dpiaForm.processing_activity}
                      onChange={(e) => setDPIAForm({ ...dpiaForm, processing_activity: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Description *</span>
                    <textarea
                      required
                      rows={4}
                      placeholder="Describe the processing activity, data involved, and purpose..."
                      value={dpiaForm.description}
                      onChange={(e) => setDPIAForm({ ...dpiaForm, description: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Risk Level *</span>
                    <select
                      required
                      value={dpiaForm.risk_level}
                      onChange={(e) => setDPIAForm({ ...dpiaForm, risk_level: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      {RISK_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Mitigation Measures</span>
                    <textarea
                      rows={3}
                      placeholder="Technical and organizational measures to reduce risk..."
                      value={dpiaForm.mitigation_measures}
                      onChange={(e) => setDPIAForm({ ...dpiaForm, mitigation_measures: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Review Date (optional)</span>
                    <input
                      type="date"
                      value={dpiaForm.review_date}
                      onChange={(e) => setDPIAForm({ ...dpiaForm, review_date: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setDPIAModal(false); resetForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : "Create"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}