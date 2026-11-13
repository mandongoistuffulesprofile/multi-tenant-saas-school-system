import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type RetentionPolicy = {
  policy_id: string;
  tenant_id: string;
  resource_type: string;
  retention_days: number;
  action_after_retention: string;
  is_active: boolean;
};

const ACTION_OPTIONS = ["DELETE", "ARCHIVE", "ANONYMIZE"];

export default function RetentionPoliciesPage() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [policyModal, setPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const policyForm = {
    resource_type: "",
    retention_days: 365,
    action_after_retention: "ARCHIVE",
    is_active: true,
  };

  const resetForm = () => {
    setPolicyForm({ resource_type: "", retention_days: 365, action_after_retention: "ARCHIVE", is_active: true });
    setEditingPolicy(null);
  };

  useEffect(() => {
    loadPolicies();
  }, []);

  const loadPolicies = () => {
    api.get<RetentionPolicy[]>("/compliance/retention-policies")
      .then((res) => setPolicies(res.data || []))
      .catch(() => setPolicies([]))
      .finally(() => setLoading(false));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/compliance/retention-policies", {
        resource_type: policyForm.resource_type,
        retention_days: policyForm.retention_days,
        action_after_retention: policyForm.action_after_retention,
        is_active: policyForm.is_active,
      });
      toast(editingPolicy ? "Retention policy updated" : "Retention policy created", { type: "success" });
      setPolicyModal(false);
      resetForm();
      loadPolicies();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save policy", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setPolicyModal(true);
  };

  const openEditModal = (policy: RetentionPolicy) => {
    setPolicyForm({
      resource_type: policy.resource_type,
      retention_days: policy.retention_days,
      action_after_retention: policy.action_after_retention,
      is_active: policy.is_active,
    });
    setEditingPolicy(policy);
    setPolicyModal(true);
  };

  const statusBadge = (isActive: boolean) => {
    return isActive
      ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
      : <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>;
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Retention Policies</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateModal}>
              Add Retention Policy
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <DataTable
              data={policies}
              emptyMessage="No retention policies configured"
              columns={[
                { key: "resource_type", header: "Resource Type" },
                { key: "retention_days", header: "Retention (days)" },
                { key: "action_after_retention", header: "Action After Retention" },
                { key: "is_active", header: "Status", render: (r) => statusBadge(r.is_active) },
                { key: "actions", header: "Actions", render: (r) => (
                  <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditModal(r)}>Edit</button>
                )},
              ]}
            />
          )}

          {/* Create/Edit Policy Modal */}
          {policyModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setPolicyModal(false); resetForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "30rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{editingPolicy ? "Edit Retention Policy" : "Add Retention Policy"}</h3>
                <form onSubmit={handleSubmit}>
                  {!editingPolicy && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Resource Type *</span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. LEARNER_RECORDS, CONSENT_RECORDS, ATTENDANCE_LOGS"
                        value={policyForm.resource_type}
                        onChange={(e) => setPolicyForm({ ...policyForm, resource_type: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  )}
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Retention Days *</span>
                    <input
                      type="number"
                      required
                      min="1"
                      value={policyForm.retention_days}
                      onChange={(e) => setPolicyForm({ ...policyForm, retention_days: parseInt(e.target.value) || 365 })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Action After Retention *</span>
                    <select
                      required
                      value={policyForm.action_after_retention}
                      onChange={(e) => setPolicyForm({ ...policyForm, action_after_retention: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <input
                      type="checkbox"
                      checked={policyForm.is_active}
                      onChange={(e) => setPolicyForm({ ...policyForm, is_active: e.target.checked })}
                    />
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Active</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setPolicyModal(false); resetForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : (editingPolicy ? "Update" : "Create")}
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