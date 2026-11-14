import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type ConsentNotice = {
  notice_id: string;
  notice_code: string;
  title: string;
  content_text: string;
  version: number;
  is_active: boolean;
  requires_renewal: boolean;
  renewal_period_days: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export default function ConsentNoticesPage() {
  const [notices, setNotices] = useState<ConsentNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [noticeModal, setNoticeModal] = useState(false);
  const [editingNotice, setEditingNotice] = useState<ConsentNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const [noticeForm, setNoticeForm] = useState({
    notice_code: "",
    title: "",
    content_text: "",
    version: 1,
    requires_renewal: false,
    renewal_period_days: "",
    is_active: true,
  });

  const resetForm = () => {
    setNoticeForm({ notice_code: "", title: "", content_text: "", version: 1, requires_renewal: false, renewal_period_days: "", is_active: true });
    setEditingNotice(null);
  };

  useEffect(() => {
    api.get<ConsentNotice[]>("/compliance/consent-notices")
      .then((res) => setNotices(res.data || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  const loadNotices = () => {
    api.get<ConsentNotice[]>("/compliance/consent-notices")
      .then((res) => setNotices(res.data || []));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/compliance/consent-notices", {
        notice_code: noticeForm.notice_code,
        title: noticeForm.title,
        content_text: noticeForm.content_text,
        version: noticeForm.version,
        requires_renewal: noticeForm.requires_renewal,
        renewal_period_days: noticeForm.renewal_period_days ? parseInt(noticeForm.renewal_period_days) : undefined,
      });
      toast("Consent notice created", { type: "success" });
      setNoticeModal(false);
      resetForm();
      loadNotices();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create notice", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNotice) return;
    setSaving(true);
    try {
      await api.patch(`/compliance/consent-notices/${editingNotice.notice_id}`, {
        title: noticeForm.title,
        content_text: noticeForm.content_text,
        is_active: noticeForm.is_active,
      });
      toast("Consent notice updated", { type: "success" });
      setNoticeModal(false);
      resetForm();
      loadNotices();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to update notice", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const openCreateModal = () => {
    resetForm();
    setNoticeModal(true);
  };

  const openEditModal = (notice: ConsentNotice) => {
    setNoticeForm({
      notice_code: notice.notice_code,
      title: notice.title,
      content_text: notice.content_text,
      version: notice.version,
      requires_renewal: notice.requires_renewal,
      renewal_period_days: notice.renewal_period_days?.toString() || "",
      is_active: notice.is_active,
    });
    setEditingNotice(notice);
    setNoticeModal(true);
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
            <h2 className="text-heading">Consent Notices</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateModal}>
              Add Consent Notice
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={notices}
              columns={[
                { key: "notice_code", header: "Code", render: (r) => r.notice_code },
                { key: "title", header: "Title" },
                { key: "version", header: "Version", render: (r) => String(r.version) },
                { key: "requires_renewal", header: "Renewal Required", render: (r) => r.requires_renewal ? "Yes" : "No" },
                { key: "renewal_period_days", header: "Renewal Period (days)", render: (r) => r.renewal_period_days?.toString() || "—" },
                { key: "is_active", header: "Status", render: (r) => statusBadge(r.is_active) },
                { key: "actions", header: "Actions", render: (r) => (
                  <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditModal(r)}>Edit</button>
                )},
              ]}
            />
          )}

          {/* Create/Edit Notice Modal */}
          {noticeModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setNoticeModal(false); resetForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "50rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{editingNotice ? "Edit Consent Notice" : "Add Consent Notice"}</h3>
                <form onSubmit={editingNotice ? handleUpdate : handleCreate}>
                  {!editingNotice && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Notice Code *</span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. PRIVACY_POLICY_V1"
                        value={noticeForm.notice_code}
                        onChange={(e) => setNoticeForm({ ...noticeForm, notice_code: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  )}
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Title *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Privacy Policy"
                      value={noticeForm.title}
                      onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Content Text *</span>
                    <textarea
                      required
                      rows={6}
                      placeholder="Full text of the consent notice..."
                      value={noticeForm.content_text}
                      onChange={(e) => setNoticeForm({ ...noticeForm, content_text: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "monospace", fontSize: "0.85rem" }}
                    />
                  </label>
                  {!editingNotice && (
                    <>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Version *</span>
                        <input
                          type="number"
                          required
                          min="1"
                          value={noticeForm.version}
                          onChange={(e) => setNoticeForm({ ...noticeForm, version: parseInt(e.target.value) || 1 })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                        <label style={{ display: "block" }}>
                          <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Requires Renewal</span>
                          <input
                            type="checkbox"
                            checked={noticeForm.requires_renewal}
                            onChange={(e) => setNoticeForm({ ...noticeForm, requires_renewal: e.target.checked })}
                          />
                        </label>
                        <label style={{ display: "block" }}>
                          <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Renewal Period (days)</span>
                          <input
                            type="number"
                            min="1"
                            value={noticeForm.renewal_period_days}
                            onChange={(e) => setNoticeForm({ ...noticeForm, renewal_period_days: e.target.value })}
                            placeholder="e.g. 365"
                            style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {editingNotice && (
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={noticeForm.is_active}
                        onChange={(e) => setNoticeForm({ ...noticeForm, is_active: e.target.checked })}
                      />
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Active</span>
                    </label>
                  )}
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setNoticeModal(false); resetForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving}>
                      {saving ? "Saving…" : (editingNotice ? "Update" : "Create")}
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