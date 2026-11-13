import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Breach = {
  breach_id: string;
  tenant_id: string;
  breach_title: string;
  description: string;
  discovered_at: string;
  reported_to_authority: boolean;
  severity: string;
  status: string;
  affected_count: number;
  resolution_notes: string | null;
  reported_by: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = ["OPEN", "INVESTIGATING", "CONTAINED", "CLOSED"];
const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function BreachRegisterPage() {
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [loading, setLoading] = useState(true);
  const [breachModal, setBreachModal] = useState(false);
  const [editingBreach, setEditingBreach] = useState<Breach | null>(null);
  const [saving, setSaving] = useState(false);
  const [breachForm, setBreachForm] = useState({
    breach_title: "",
    description: "",
    discovered_at: "",
    severity: "LOW",
    affected_count: 0,
    status: "OPEN",
    resolution_notes: "",
    reported_to_authority: false,
  });
  const { t } = useTranslation();
  const { toast } = useToast();

  const resetForm = () => {
    setBreachForm({ breach_title: "", description: "", discovered_at: "", severity: "LOW", affected_count: 0, status: "OPEN", resolution_notes: "", reported_to_authority: false });
    setEditingBreach(null);
  };

  useEffect(() => {
    api.get<Breach[]>("/compliance/breach-register")
      .then((res) => setBreaches(res.data || []))
      .catch(() => setBreaches([]))
      .finally(() => setLoading(false));
  }, []);

  const loadBreaches = () => {
    api.get<Breach[]>("/compliance/breach-register")
      .then((res) => setBreaches(res.data || []));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/compliance/breach-register", {
        breach_title: breachForm.breach_title,
        description: breachForm.description,
        discovered_at: breachForm.discovered_at,
        severity: breachForm.severity,
        affected_data_subjects: breachForm.affected_count,
      });
      toast("Breach recorded", { type: "success" });
      setBreachModal(false);
      resetForm();
      loadBreaches();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create breach", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBreach) return;
    setSaving(true);
    try {
      await api.patch(`/compliance/breach-register/${editingBreach.breach_id}`, {
        status: breachForm.status,
        severity: breachForm.severity,
        resolution_notes: breachForm.resolution_notes || undefined,
        reported_to_authority: breachForm.reported_to_authority,
      });
      toast("Breach updated", { type: "success" });
      setBreachModal(false);
      resetForm();
      loadBreaches();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to update breach", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setBreachModal(true);
  };

  const openEditModal = (breach: Breach) => {
    setBreachForm({
      breach_title: breach.breach_title,
      description: breach.description,
      discovered_at: breach.discovered_at.slice(0, 10),
      severity: breach.severity,
      affected_count: breach.affected_count,
      status: breach.status,
      resolution_notes: breach.resolution_notes || "",
      reported_to_authority: breach.reported_to_authority,
    });
    setEditingBreach(breach);
    setBreachModal(true);
  };

  const severityBadge = (severity: string) => {
    const cls = severity === "CRITICAL" ? "bg-red-100 text-red-700"
      : severity === "HIGH" ? "bg-orange-100 text-orange-700"
      : severity === "MEDIUM" ? "bg-amber-100 text-amber-700"
      : "bg-green-100 text-green-700";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{severity}</span>;
  };

  const statusBadge = (status: string) => {
    const cls = status === "CLOSED" ? "bg-green-100 text-green-700"
      : status === "CONTAINED" ? "bg-blue-100 text-blue-700"
      : status === "INVESTIGATING" ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
  };

  const fmtDate = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Breach Register</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateModal}>
              Record Breach
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={breaches}
              columns={[
                { key: "breach_id", header: "Breach ID", render: (r) => r.breach_id.slice(0, 8) + "…" },
                { key: "breach_title", header: "Title" },
                { key: "severity", header: "Severity", render: (r) => severityBadge(r.severity) },
                { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                { key: "discovered_at", header: "Discovered", render: (r) => fmtDate(r.discovered_at) },
                { key: "affected_count", header: "Affected" },
                { key: "reported_to_authority", header: "Reported", render: (r) => r.reported_to_authority ? "Yes" : "No" },
                { key: "actions", header: "Actions", render: (r) => (
                  <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditModal(r)}>Edit</button>
                )},
              ]}
            />
          )}

          {/* Create/Edit Breach Modal */}
          {breachModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setBreachModal(false); resetForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "40rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{editingBreach ? "Edit Breach" : "Record Breach"}</h3>
                <form onSubmit={editingBreach ? handleUpdate : handleCreate}>
                  {!editingBreach && (
                    <>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Breach Title *</span>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Unauthorized access to learner records"
                          value={breachForm.breach_title}
                          onChange={(e) => setBreachForm({ ...breachForm, breach_title: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Description *</span>
                        <textarea
                          required
                          rows={3}
                          placeholder="Details of the breach..."
                          value={breachForm.description}
                          onChange={(e) => setBreachForm({ ...breachForm, description: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Discovered At *</span>
                        <input
                          type="date"
                          required
                          value={breachForm.discovered_at}
                          onChange={(e) => setBreachForm({ ...breachForm, discovered_at: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                        <label style={{ display: "block" }}>
                          <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Severity *</span>
                          <select
                            required
                            value={breachForm.severity}
                            onChange={(e) => setBreachForm({ ...breachForm, severity: e.target.value })}
                            style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                          >
                            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        <label style={{ display: "block" }}>
                          <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Affected Data Subjects</span>
                          <input
                            type="number"
                            min="0"
                            value={breachForm.affected_count}
                            onChange={(e) => setBreachForm({ ...breachForm, affected_count: parseInt(e.target.value) || 0 })}
                            style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {editingBreach && (
                    <>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Status *</span>
                        <select
                          required
                          value={breachForm.status}
                          onChange={(e) => setBreachForm({ ...breachForm, status: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Severity *</span>
                        <select
                          required
                          value={breachForm.severity}
                          onChange={(e) => setBreachForm({ ...breachForm, severity: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Resolution Notes</span>
                        <textarea
                          rows={3}
                          placeholder="Resolution details..."
                          value={breachForm.resolution_notes}
                          onChange={(e) => setBreachForm({ ...breachForm, resolution_notes: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <input
                          type="checkbox"
                          checked={breachForm.reported_to_authority}
                          onChange={(e) => setBreachForm({ ...breachForm, reported_to_authority: e.target.checked })}
                        />
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reported to Authority</span>
                      </label>
                    </>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setBreachModal(false); resetForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : (editingBreach ? "Update" : "Create")}
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