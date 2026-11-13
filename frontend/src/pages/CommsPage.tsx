import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Template = {
  template_id: string;
  tenant_id: string;
  template_name: string;
  channel: string;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  is_active: boolean;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  message_id: string;
  tenant_id: string;
  template_id: string | null;
  recipient_type: string;
  recipient_id: string;
  channel: string;
  recipient_address: string;
  subject: string | null;
  body_text: string;
  status: string;
  provider_message_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Broadcast = {
  broadcast_id: string;
  tenant_id: string;
  broadcast_name: string;
  channel: string;
  target_audience: string;
  target_grade_ids: string | null;
  subject: string | null;
  body_text: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type OptOut = {
  opt_out_id: string;
  tenant_id: string;
  user_id: string;
  channel: string;
  reason: string | null;
  opted_out_at: string;
  opted_back_in_at: string | null;
  is_active: boolean;
};

const CHANNEL_OPTIONS = ["SMS", "WHATSAPP", "EMAIL"];
const AUDIENCE_OPTIONS = [
  { value: "ALL", label: "All Parents" },
  { value: "GRADE", label: "Specific Grade" },
  { value: "STREAM", label: "Specific Stream" },
  { value: "ARREARS", label: "Fee Defaulters" },
];

export default function CommsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"templates" | "messages" | "broadcasts" | "optouts">("messages");
  const { t } = useTranslation();
  const { toast } = useToast();

  // Template modal
  const [templateModal, setTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateForm = {
    template_name: "",
    channel: "SMS",
    subject: "",
    body_text: "",
    is_default: false,
  };

  // Broadcast modal
  const [broadcastModal, setBroadcastModal] = useState(false);
  const [savingBroadcast, setSavingBroadcast] = useState(false);
  const broadcastForm = {
    broadcast_name: "",
    channel: "SMS",
    subject: "",
    body_text: "",
    template_id: "",
    audience_mode: "ALL",
    grade_ids: [] as string[],
    arrears_over: "",
  };

  // Opt-out modal
  const [optOutModal, setOptOutModal] = useState(false);
  const [savingOptOut, setSavingOptOut] = useState(false);
  const optOutForm = {
    user_id: "",
    channel: "SMS",
    reason: "",
    opt_out: true,
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = () => {
    Promise.all([
      api.get("/comms/templates"),
      api.get("/comms/messages"),
      api.get("/comms/broadcasts"),
      api.get("/comms/opt-outs"),
    ]).then(([tRes, mRes, bRes, oRes]) => {
      setTemplates(Array.isArray(tRes.data) ? tRes.data : []);
      setMessages(Array.isArray(mRes.data) ? mRes.data : []);
      setBroadcasts(Array.isArray(bRes.data) ? bRes.data : []);
      setOptOuts(Array.isArray(oRes.data) ? oRes.data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  // Template CRUD
  const resetTemplateForm = () => {
    setTemplateForm({ template_name: "", channel: "SMS", subject: "", body_text: "", is_default: false });
    setEditingTemplate(null);
  };

  const handleTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTemplate(true);
    try {
      if (editingTemplate) {
        await api.patch(`/comms/templates/${editingTemplate.template_id}`, {
          template_name: templateForm.template_name,
          subject: templateForm.subject || undefined,
          body_text: templateForm.body_text,
          is_active: templateForm.is_default, // using is_default as is_active for update
        });
        toast("Template updated", { type: "success" });
      } else {
        await api.post("/comms/templates", {
          template_name: templateForm.template_name,
          channel: templateForm.channel,
          subject: templateForm.subject || undefined,
          body_text: templateForm.body_text,
          is_default: templateForm.is_default,
        });
        toast("Template created", { type: "success" });
      }
      setTemplateModal(false);
      resetTemplateForm();
      api.get("/comms/templates").then((res) => setTemplates(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save template", { type: "error" });
    } finally {
      setSavingTemplate(false);
    }
  };

  const openCreateTemplate = () => {
    resetTemplateForm();
    setTemplateModal(true);
  };

  const openEditTemplate = (template: Template) => {
    setTemplateForm({
      template_name: template.template_name,
      channel: template.channel,
      subject: template.subject || "",
      body_text: template.body_text,
      is_default: template.is_default,
    });
    setEditingTemplate(template);
    setTemplateModal(true);
  };

  const deleteTemplate = async (templateId: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      await api.delete(`/comms/templates/${templateId}`);
      toast("Template deleted", { type: "success" });
      api.get("/comms/templates").then((res) => setTemplates(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to delete template", { type: "error" });
    }
  };

  // Broadcast CRUD
  const resetBroadcastForm = () => {
    setBroadcastForm({ broadcast_name: "", channel: "SMS", subject: "", body_text: "", template_id: "", audience_mode: "ALL", grade_ids: [], arrears_over: "" });
  };

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBroadcast(true);
    try {
      const audience: any = { target_audience: broadcastForm.audience_mode };
      if (broadcastForm.audience_mode === "GRADE" || broadcastForm.audience_mode === "STREAM") {
        audience.target_grade_ids = broadcastForm.grade_ids;
      }
      if (broadcastForm.audience_mode === "ARREARS") {
        audience.arrears_over = parseFloat(broadcastForm.arrears_over) || 0;
      }

      await api.post("/comms/broadcasts", {
        broadcast_name: broadcastForm.broadcast_name,
        channel: broadcastForm.channel,
        subject: broadcastForm.subject || undefined,
        body_text: broadcastForm.body_text,
        template_id: broadcastForm.template_id || undefined,
        audience,
      });
      toast("Broadcast saved", { type: "success" });
      setBroadcastModal(false);
      resetBroadcastForm();
      api.get("/comms/broadcasts").then((res) => setBroadcasts(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create broadcast", { type: "error" });
    } finally {
      setSavingBroadcast(false);
    }
  };

  const openCreateBroadcast = () => {
    resetBroadcastForm();
    setBroadcastModal(true);
  };

  const sendBroadcast = async (broadcastId: string) => {
    if (!confirm("Send this broadcast now?")) return;
    try {
      await api.post(`/comms/broadcasts/${broadcastId}/send`);
      toast("Broadcast queued for sending", { type: "success" });
      api.get("/comms/broadcasts").then((res) => setBroadcasts(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to send broadcast", { type: "error" });
    }
  };

  // Message retry
  const retryMessage = async (messageId: string) => {
    try {
      await api.post(`/comms/messages/${messageId}/retry`);
      toast("Message re-queued", { type: "success" });
      api.get("/comms/messages").then((res) => setMessages(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to retry message", { type: "error" });
    }
  };

  // Opt-out CRUD
  const resetOptOutForm = () => {
    setOptOutForm({ user_id: "", channel: "SMS", reason: "", opt_out: true });
  };

  const handleOptOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOptOut(true);
    try {
      await api.post("/comms/opt-outs", {
        user_id: optOutForm.user_id,
        channel: optOutForm.channel,
        reason: optOutForm.reason || undefined,
        opt_out: optOutForm.opt_out,
      });
      toast(optOutForm.opt_out ? "Opt-out recorded" : "Opt-out lifted", { type: "success" });
      setOptOutModal(false);
      resetOptOutForm();
      api.get("/comms/opt-outs").then((res) => setOptOuts(Array.isArray(res.data) ? res.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save opt-out", { type: "error" });
    } finally {
      setSavingOptOut(false);
    }
  };

  const openCreateOptOut = () => {
    resetOptOutForm();
    setOptOutModal(true);
  };

  const statusBadge = (status: string) => {
    const cls = status === "SENT" || status === "DELIVERED" ? "bg-green-100 text-green-700"
      : status === "QUEUED" ? "bg-blue-100 text-blue-700"
      : status === "FAILED" ? "bg-red-100 text-red-700"
      : status === "DRAFT" ? "bg-gray-100 text-gray-700"
      : "bg-amber-100 text-amber-700";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
  };

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const grades = templates.map(t => ({ grade_id: t.template_id, grade_label: t.template_name })); // placeholder for grade picker

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Communications</h2>
            <div className="flex gap-2">
              {activeTab === "templates" && <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateTemplate}>Add Template</button>}
              {activeTab === "broadcasts" && <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateBroadcast}>Create Broadcast</button>}
              {activeTab === "optouts" && <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openCreateOptOut}>Add Opt-out</button>}
              <a href="/comms/compose" className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:opacity-90 transition">
                Compose Message
              </a>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex gap-6" aria-label="Communications tabs">
              <button className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === "templates" ? "border-kenyan-red text-kenyan-red" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => setActiveTab("templates")}>Templates</button>
              <button className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === "broadcasts" ? "border-kenyan-red text-kenyan-red" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => setActiveTab("broadcasts")}>Broadcasts</button>
              <button className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === "messages" ? "border-kenyan-red text-kenyan-red" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => setActiveTab("messages")}>Messages</button>
              <button className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === "optouts" ? "border-kenyan-red text-kenyan-red" : "border-transparent text-gray-500 hover:text-gray-700"}`} onClick={() => setActiveTab("optouts")}>Opt-outs</button>
            </nav>
          </div>

          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              {/* Templates Tab */}
              {activeTab === "templates" && (
                <div className="space-y-4">
                  <DataTable
                    data={templates}
                    emptyMessage="No templates found"
                    columns={[
                      { key: "template_name", header: "Name" },
                      { key: "channel", header: "Channel" },
                      { key: "subject", header: "Subject", render: (r) => r.subject || "—" },
                      { key: "is_active", header: "Status", render: (r) => r.is_active ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span> : <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span> },
                      { key: "is_default", header: "Default", render: (r) => r.is_default ? "Yes" : "No" },
                      { key: "actions", header: "Actions", render: (r) => (
                        <div className="flex gap-2">
                          <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditTemplate(r)}>Edit</button>
                          <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => deleteTemplate(r.template_id)}>Delete</button>
                        </div>
                      )},
                    ]}
                  />
                </div>
              )}

              {/* Broadcasts Tab */}
              {activeTab === "broadcasts" && (
                <div className="space-y-4">
                  <DataTable
                    data={broadcasts}
                    emptyMessage="No broadcasts found"
                    columns={[
                      { key: "broadcast_name", header: "Name" },
                      { key: "channel", header: "Channel" },
                      { key: "target_audience", header: "Audience" },
                      { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                      { key: "total_recipients", header: "Recipients" },
                      { key: "sent_count", header: "Sent" },
                      { key: "created_at", header: "Created", render: (r) => fmtDate(r.created_at) },
                      { key: "actions", header: "Actions", render: (r) => (
                        <div className="flex gap-2">
                          {r.status === "DRAFT" && <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => sendBroadcast(r.broadcast_id)}>Send</button>}
                          <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => window.open(`/comms/compose?broadcast=${r.broadcast_id}`, "_blank")}>View</button>
                        </div>
                      )},
                    ]}
                  />
                </div>
              )}

              {/* Messages Tab */}
              {activeTab === "messages" && (
                <div className="space-y-4">
                  <DataTable
                    data={messages}
                    emptyMessage="No messages found"
                    columns={[
                      { key: "channel", header: "Channel" },
                      { key: "recipient_type", header: "Recipient" },
                      { key: "recipient_address", header: "Address" },
                      { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                      { key: "error_message", header: "Error", render: (r) => r.error_message || "—" },
                      { key: "created_at", header: "Created", render: (r) => fmtDate(r.created_at) },
                      { key: "actions", header: "Actions", render: (r) => (
                        r.status === "FAILED" ? (
                          <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => retryMessage(r.message_id)}>Retry</button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )
                      )},
                    ]}
                  />
                </div>
              )}

              {/* Opt-outs Tab */}
              {activeTab === "optouts" && (
                <div className="space-y-4">
                  <DataTable
                    data={optOuts}
                    emptyMessage="No opt-outs recorded"
                    columns={[
                      { key: "user_id", header: "User ID", render: (r) => r.user_id.slice(0, 8) + "…" },
                      { key: "channel", header: "Channel" },
                      { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
                      { key: "opted_out_at", header: "Opted Out", render: (r) => fmtDate(r.opted_out_at) },
                      { key: "is_active", header: "Active", render: (r) => r.is_active ? <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Yes</span> : <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">No</span> },
                      { key: "actions", header: "Actions", render: (r) => (
                        r.is_active ? (
                          <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => {
                            api.post("/comms/opt-outs", { user_id: r.user_id, channel: r.channel, opt_out: false })
                              .then(() => { toast("Opt-out lifted", { type: "success" }); api.get("/comms/opt-outs").then((res) => setOptOuts(Array.isArray(res.data) ? res.data : [])); })
                              .catch((err: any) => toast(err.response?.data?.message || "Failed", { type: "error" }));
                          }}>Lift</button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )
                      )},
                    ]}
                  />
                </div>
              )}
            </>
          )}

          {/* Template Modal */}
          {templateModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setTemplateModal(false); resetTemplateForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "50rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{editingTemplate ? "Edit Template" : "Add Template"}</h3>
                <form onSubmit={handleTemplateSubmit}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Template Name *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Fee Reminder SMS"
                      value={templateForm.template_name}
                      onChange={(e) => setTemplateForm({ ...templateForm, template_name: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Channel *</span>
                    <select
                      required
                      value={templateForm.channel}
                      onChange={(e) => setTemplateForm({ ...templateForm, channel: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      {CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Subject (Email/WhatsApp)</span>
                    <input
                      type="text"
                      placeholder="Email subject line"
                      value={templateForm.subject}
                      onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Body Text *</span>
                    <textarea
                      required
                      rows={6}
                      placeholder="Message body with {{placeholders}}..."
                      value={templateForm.body_text}
                      onChange={(e) => setTemplateForm({ ...templateForm, body_text: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "monospace", fontSize: "0.85rem" }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <input
                      type="checkbox"
                      checked={templateForm.is_default}
                      onChange={(e) => setTemplateForm({ ...templateForm, is_default: e.target.checked })}
                    />
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Set as Default for Channel</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setTemplateModal(false); resetTemplateForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={savingTemplate}>
                      {savingTemplate ? "Saving…" : (editingTemplate ? "Update" : "Create")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Broadcast Modal */}
          {broadcastModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setBroadcastModal(false); resetBroadcastForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "50rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Create Broadcast</h3>
                <form onSubmit={handleBroadcastSubmit}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Broadcast Name *</label>
                      <input
                        className="input-field"
                        required
                        value={broadcastForm.broadcast_name}
                        onChange={(e) => setBroadcastForm({ ...broadcastForm, broadcast_name: e.target.value })}
                        placeholder="e.g. Term 2 Fee Reminder"
                      />
                    </div>
                    <div>
                      <label className="label">Channel *</label>
                      <select className="input-field" value={broadcastForm.channel} onChange={(e) => setBroadcastForm({ ...broadcastForm, channel: e.target.value })}>
                        {CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Template (optional)</label>
                      <select className="input-field" value={broadcastForm.template_id} onChange={(e) => setBroadcastForm({ ...broadcastForm, template_id: e.target.value })}>
                        <option value="">Free-form message</option>
                        {templates.filter(t => t.channel === broadcastForm.channel).map((t) => (
                          <option key={t.template_id} value={t.template_id}>{t.template_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Subject (Email/WhatsApp)</label>
                      <input className="input-field" value={broadcastForm.subject} onChange={(e) => setBroadcastForm({ ...broadcastForm, subject: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <label className="label">Recipients *</label>
                    <select className="input-field" value={broadcastForm.audience_mode} onChange={(e) => setBroadcastForm({ ...broadcastForm, audience_mode: e.target.value })}>
                      {AUDIENCE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                  </div>
                  {(broadcastForm.audience_mode === "GRADE" || broadcastForm.audience_mode === "STREAM") && (
                    <div>
                      <label className="label">Grades/Streams</label>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {grades.map((g) => (
                          <button
                            key={g.grade_id}
                            type="button"
                            onClick={() => setBroadcastForm({ ...broadcastForm, grade_ids: broadcastForm.grade_ids.includes(g.grade_id) ? broadcastForm.grade_ids.filter((id) => id !== g.grade_id) : [...broadcastForm.grade_ids, g.grade_id] })}
                            className={`px-3 py-1.5 text-xs rounded-full border transition ${broadcastForm.grade_ids.includes(g.grade_id) ? "bg-kenyan-red text-white border-kenyan-red" : "bg-white text-gray-700 border-gray-300 hover:border-kenyan-red"}`}
                          >
                            {g.grade_label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {broadcastForm.audience_mode === "ARREARS" && (
                    <div>
                      <label className="label">Outstanding Balance Over (KES)</label>
                      <input className="input-field" type="number" min="0" value={broadcastForm.arrears_over} onChange={(e) => setBroadcastForm({ ...broadcastForm, arrears_over: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="label">Message Body *</label>
                    <textarea
                      className="input-field min-h-[160px] resize-y"
                      required
                      value={broadcastForm.body_text}
                      onChange={(e) => setBroadcastForm({ ...broadcastForm, body_text: e.target.value })}
                      placeholder="Type your message…"
                    />
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setBroadcastModal(false); resetBroadcastForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={savingBroadcast}>
                      {savingBroadcast ? "Saving…" : "Save Broadcast"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Opt-out Modal */}
          {optOutModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => { setOptOutModal(false); resetOptOutForm(); }}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "30rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Record Opt-out</h3>
                <form onSubmit={handleOptOutSubmit}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>User ID *</span>
                    <input
                      type="text"
                      required
                      placeholder="User UUID"
                      value={optOutForm.user_id}
                      onChange={(e) => setOptOutForm({ ...optOutForm, user_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Channel *</span>
                    <select
                      required
                      value={optOutForm.channel}
                      onChange={(e) => setOptOutForm({ ...optOutForm, channel: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      {CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reason</span>
                    <textarea
                      rows={3}
                      placeholder="Reason for opt-out..."
                      value={optOutForm.reason}
                      onChange={(e) => setOptOutForm({ ...optOutForm, reason: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <input
                      type="checkbox"
                      checked={optOutForm.opt_out}
                      onChange={(e) => setOptOutForm({ ...optOutForm, opt_out: e.target.checked })}
                    />
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Opt-out (uncheck to lift opt-out)</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => { setOptOutModal(false); resetOptOutForm(); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={savingOptOut}>
                      {savingOptOut ? "Saving…" : "Save"}
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