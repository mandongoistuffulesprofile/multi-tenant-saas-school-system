import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type FinanceSettings = {
  tenant_id: string;
  tuition_invoicing: boolean;
  optional_services: boolean;
  capitation_tracking: boolean;
  allowed_fee_categories: string[];
  arrears_reminders: boolean;
  report_withholding: boolean;
  gate_arrears_denial: boolean;
  preset_label: string;
};

type PaymentChannel = {
  channel_id: string;
  channel_type: string;
  shortcode_or_account: string;
  label: string;
  environment: string;
  is_default: boolean;
  status: string;
  reference_format: string;
  routed_fee_categories: string[];
  c2b_registered: boolean;
  created_at: string;
};

export default function IntegrationsPage() {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const [financeSettings, setFinanceSettings] = useState<FinanceSettings | null>(null);
  const [channelModal, setChannelModal] = useState(false);
  const [channelForm, setChannelForm] = useState({
    channel_type: "PAYBILL",
    shortcode_or_account: "",
    label: "",
    environment: "SANDBOX",
    is_default: false,
    status: "ACTIVE",
    reference_format: "{INVOICE}-{LEARNER}-{DATE}",
  });
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingFinance, setSavingFinance] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  const load = () => {
    Promise.all([
      api.get("/school/integrations/channels"),
      api.get("/school/finance-settings"),
    ]).then(([channelsRes, financeRes]) => {
      setChannels(Array.isArray(channelsRes.data) ? channelsRes.data : []);
      setFinanceSettings(financeRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const saveFinanceSettings = async (patch: Partial<FinanceSettings>) => {
    setSavingFinance(true);
    try {
      const updated = { ...financeSettings, ...patch };
      await api.put("/school/finance-settings", updated);
      toast("Finance settings saved", { type: "success" });
      load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save settings", { type: "error" });
    } finally {
      setSavingFinance(false);
    }
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingChannel(true);
    try {
      await api.post("/school/integrations/channels", channelForm);
      toast("Payment channel created", { type: "success" });
      setChannelModal(false);
      setChannelForm({ channel_type: "PAYBILL", shortcode_or_account: "", label: "", environment: "SANDBOX", is_default: false, status: "ACTIVE", reference_format: "{INVOICE}-{LEARNER}-{DATE}" });
      load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create channel", { type: "error" });
    } finally {
      setSavingChannel(false);
    }
  };

  const statusBadge = (status: string) => {
    const s = String(status || "").toLowerCase();
    const cls = s === "healthy" || s === "active"
      ? "bg-green-100 text-green-700"
      : s === "unconfigured" || s === "degraded"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-600";
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
  };

  const presetOptions = [
    { value: "CUSTOM", label: "Custom" },
    { value: "PUBLIC_FREE", label: "Public Free (FPE/FDSE)" },
    { value: "PRIVATE_FEE", label: "Private Fee Paying" },
  ];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Integrations</h2>
          {loading ? (
            <Skeleton rows={6} columns={3} />
          ) : (
            <>
              <div className="card p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-body font-semibold text-gray-900">Payment Channels</h3>
                  <button className="px-3 py-1.5 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setChannelModal(true)}>
                    Add Channel
                  </button>
                </div>
                {channels.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No payment channels configured</div>
                ) : (
                  <div className="space-y-3">
                    {channels.map((ch) => (
                      <div key={ch.channel_id} className="flex justify-between items-center p-4 border border-gray-200 rounded-xl">
                        <div>
                          <div className="font-medium text-gray-900">{ch.label || ch.channel_id}</div>
                          <div className="text-caption">{ch.channel_type} • {ch.shortcode_or_account}</div>
                          <div className="text-caption text-gray-500">Env: {ch.environment} | Ref: {ch.reference_format}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(ch.status)}
                          {ch.is_default && <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Default</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-6 mb-6">
                <h3 className="text-body font-semibold text-gray-900 mb-4">Finance Configuration</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.tuition_invoicing}
                        onChange={(e) => saveFinanceSettings({ tuition_invoicing: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Tuition Invoicing</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.optional_services}
                        onChange={(e) => saveFinanceSettings({ optional_services: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Optional Services</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.capitation_tracking}
                        onChange={(e) => saveFinanceSettings({ capitation_tracking: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Capitation Tracking</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.arrears_reminders}
                        onChange={(e) => saveFinanceSettings({ arrears_reminders: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Arrears Reminders</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.report_withholding}
                        onChange={(e) => saveFinanceSettings({ report_withholding: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Report Withholding</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={financeSettings?.gate_arrears_denial}
                        onChange={(e) => saveFinanceSettings({ gate_arrears_denial: e.target.checked })}
                        disabled={savingFinance}
                        className="w-4 h-4 rounded border-gray-300 text-kenyan-red focus:ring-kenyan-red"
                      />
                      <span className="text-sm text-gray-700">Gate Arrears Denial</span>
                    </label>
                  </div>
                  <div>
                    <label className="label">Preset Label</label>
                    <select
                      value={financeSettings?.preset_label || "CUSTOM"}
                      onChange={(e) => saveFinanceSettings({ preset_label: e.target.value })}
                      disabled={savingFinance}
                      className="input-field max-w-xs"
                    >
                      {presetOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Allowed Fee Categories (comma-separated, empty = all)</label>
                    <input
                      type="text"
                      value={financeSettings?.allowed_fee_categories?.join(", ") || ""}
                      onChange={(e) => saveFinanceSettings({ allowed_fee_categories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      disabled={savingFinance}
                      placeholder="e.g. TUITION, TRANSPORT, UNIFORM"
                      className="input-field max-w-md"
                    />
                  </div>
                </div>
              </div>

              {/* Add Channel Modal */}
              {channelModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setChannelModal(false)}>
                  <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "28rem", maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add Payment Channel</h3>
                    <form onSubmit={createChannel}>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Channel Type *</span>
                        <select
                          required
                          value={channelForm.channel_type}
                          onChange={(e) => setChannelForm({ ...channelForm, channel_type: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          <option value="PAYBILL">Paybill</option>
                          <option value="TILL">Till Number</option>
                          <option value="BANK">Bank</option>
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Shortcode / Account *</span>
                        <input
                          type="text"
                          required
                          placeholder="e.g. 522522"
                          value={channelForm.shortcode_or_account}
                          onChange={(e) => setChannelForm({ ...channelForm, shortcode_or_account: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Label *</span>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Main School Paybill"
                          value={channelForm.label}
                          onChange={(e) => setChannelForm({ ...channelForm, label: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Environment *</span>
                        <select
                          required
                          value={channelForm.environment}
                          onChange={(e) => setChannelForm({ ...channelForm, environment: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          <option value="SANDBOX">Sandbox</option>
                          <option value="PRODUCTION">Production</option>
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reference Format</span>
                        <input
                          type="text"
                          value={channelForm.reference_format}
                          onChange={(e) => setChannelForm({ ...channelForm, reference_format: e.target.value })}
                          placeholder="{INVOICE}-{LEARNER}-{DATE}"
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        />
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Status *</span>
                        <select
                          required
                          value={channelForm.status}
                          onChange={(e) => setChannelForm({ ...channelForm, status: e.target.value })}
                          style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="INACTIVE">Inactive</option>
                          <option value="UNCONFIGURED">Unconfigured</option>
                        </select>
                      </label>
                      <label style={{ display: "block", marginBottom: "0.75rem" }}>
                        <input
                          type="checkbox"
                          checked={channelForm.is_default}
                          onChange={(e) => setChannelForm({ ...channelForm, is_default: e.target.checked })}
                        />
                        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Set as Default</span>
                      </label>
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                        <button type="button" onClick={() => setChannelModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                        <button type="submit" className="btn-primary" disabled={savingChannel}>
                          {savingChannel ? "Creating…" : "Create Channel"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}