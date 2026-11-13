import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type DSRRequest = {
  request_id: string;
  tenant_id: string;
  user_id: string;
  request_type: string;
  status: string;
  description: string | null;
  response_data: Record<string, any> | null;
  responded_by: string | null;
  responded_at: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = ["PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"];
const TYPE_OPTIONS = ["ACCESS", "RECTIFICATION", "ERASURE", "RESTRICTION", "PORTABILITY", "OBJECTION", "OTHER"];

export default function DsrRequestsPage() {
  const [requests, setRequests] = useState<DSRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestModal, setRequestModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<DSRRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const requestForm = {
    user_id: "",
    request_type: "ACCESS",
    description: "",
    due_date: "",
    status: "PENDING",
    response_data: "",
  };

  const resetForm = () => {
    setRequestForm({ user_id: "", request_type: "ACCESS", description: "", due_date: "", status: "PENDING", response_data: "" });
    setEditingRequest(null);
  };

  useEffect(() => {
    api.get<DSRRequest[]>("/compliance/dsr-requests")
      .then((res) => setRequests(res.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  const loadRequests = () => {
    api.get<DSRRequest[]>("/compliance/dsr-requests")
      .then((res) => setRequests(res.data || []));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/compliance/dsr-requests", {
        user_id: requestForm.user_id,
        request_type: requestForm.request_type,
        description: requestForm.description || undefined,
        due_date: requestForm.due_date || undefined,
      });
      toast("DSR request created", { type: "success" });
      setRequestModal(false);
      resetForm();
      loadRequests();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create request", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;
    setSaving(true);
    try {
      let responseData: Record<string, any> = {};
      if (requestForm.response_data) {
        try {
          responseData = JSON.parse(requestForm.response_data);
        } catch {
          toast("Invalid JSON in response data", { type: "error" });
          setSaving(false);
          return;
        }
      }
      await api.patch(`/compliance/dsr-requests/${editingRequest.request_id}`, {
        status: requestForm.status,
        response_data: responseData,
      });
      toast("DSR request updated", { type: "success" });
      setRequestModal(false);
      resetForm();
      loadRequests();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to update request", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setRequestModal(true);
  };

  const openEditModal = (request: DSRRequest) => {
    setRequestForm({
      user_id: request.user_id,
      request_type: request.request_type,
      description: request.description || "",
      due_date: request.due_date || "",
      status: request.status,
      response_data: request.response_data ? JSON.stringify(request.response_data, null, 2) : "",
    });
    setEditingRequest(request);
    setRequestModal(true);
  };

  const statusBadge = (status: string) => {
    const cls = status === "COMPLETED" ? "bg-green-100 text-green-700"
      : status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700"
      : status === "REJECTED" ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
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
            <h2 className="text-heading">Data Subject Requests</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateModal}>
              Add DSR Request
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={requests}
              columns={[
                { key: "request_id", header: "Request ID", render: (r) => r.request_id.slice(0, 8) + "…" },
                { key: "user_id", header: "User ID", render: (r) => r.user_id.slice(0, 8) + "…" },
                { key: "request_type", header: "Type" },
                { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                { key: "created_at", header: "Created", render: (r) => fmtDate(r.created_at) },
                { key: "due_date", header: "Due Date", render: (r) => fmtDate(r.due_date) },
                { key: "responded_at", header: "Responded", render: (r) => fmtDate(r.responded_at) },
                { key: "actions", header: "Actions", render: (r) => (
                  <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditModal(r)}>Edit</button>
                )},
              ]}
            />
          )}

          {/* Create/Edit Request Modal */}
          {requestModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setRequestModal(false); resetForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "40rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{editingRequest ? "Edit DSR Request" : "Add DSR Request"}</h3>
                <form onSubmit={editingRequest ? handleUpdate : handleCreate}>
                  {!editingRequest && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>User ID *</span>
                      <input
                        type="text"
                        required
                        placeholder="User UUID"
                        value={requestForm.user_id}
                        onChange={(e) => setRequestForm({ ...requestForm, user_id: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  )}
                  {!editingRequest && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Request Type *</span>
                      <select
                        required
                        value={requestForm.request_type}
                        onChange={(e) => setRequestForm({ ...requestForm, request_type: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      >
                        {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  )}
                  {!editingRequest && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Description</span>
                      <textarea
                        rows={3}
                        placeholder="Details of the request..."
                        value={requestForm.description}
                        onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  )}
                  {!editingRequest && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Due Date (optional)</span>
                      <input
                        type="date"
                        value={requestForm.due_date}
                        onChange={(e) => setRequestForm({ ...requestForm, due_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  )}
                  {editingRequest && (
                    <>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Status *</span>
                        <select
                          required
                          value={requestForm.status}
                          onChange={(e) => setRequestForm({ ...requestForm, status: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Response Data (JSON)</span>
                        <textarea
                          rows={6}
                          placeholder='{"key": "value"}'
                          value={requestForm.response_data}
                          onChange={(e) => setRequestForm({ ...requestForm, response_data: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "monospace", fontSize: "0.85rem" }}
                        />
                      </label>
                    </>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setRequestModal(false); resetForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : (editingRequest ? "Update" : "Create")}
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