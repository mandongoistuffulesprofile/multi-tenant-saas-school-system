import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function IntegrationsPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [financeSettings, setFinanceSettings] = useState<any>(null);
  const [paybill, setPaybill] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  const load = () => {
    Promise.all([
      api.get("/school/integrations/channels"),
      api.get("/school/finance-settings"),
    ]).then(([channelsRes, financeRes]) => {
      setChannels(channelsRes.data || []);
      const fs = financeRes.data || null;
      setFinanceSettings(fs);
      if (fs?.paybill) setPaybill(String(fs.paybill));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async (patch: Partial<{ paybill: string; stk_enabled: boolean }>) => {
    setSaving(true);
    try {
      await api.patch("/school/finance-settings", patch);
      toast("Finance settings saved", { type: "success" });
      load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save settings", { type: "error" });
    } finally {
      setSaving(false);
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
                <h3 className="text-body font-semibold text-gray-900 mb-4">Payment Channels</h3>
                {channels.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">No payment channels configured</div>
                ) : (
                  <div className="space-y-3">
                    {channels.map((ch: any) => (
                      <div key={ch.id || ch.name} className="flex justify-between items-center p-4 border border-gray-200 rounded-xl">
                        <div>
                          <div className="font-medium text-gray-900">{ch.name}</div>
                          <div className="text-caption">{ch.channel} • {ch.provider}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(ch.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card p-6">
                <h3 className="text-body font-semibold text-gray-900 mb-4">M-Pesa Collection Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="label">Paybill / Till Number</label>
                    <input
                      type="text"
                      value={paybill}
                      onChange={(e) => setPaybill(e.target.value)}
                      placeholder="e.g. 522522"
                      className="input-field max-w-xs"
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-3">
                    <div className="flex items-center justify-between p-3 border border-gray-200 rounded-xl">
                      <div>
                        <div className="text-sm font-medium text-gray-900">STK Push Payments</div>
                        <div className="text-caption text-gray-500">Parents pay invoices via M-Pesa prompt</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!financeSettings?.stk_enabled}
                        disabled={saving}
                        onClick={() => saveSettings({ stk_enabled: !financeSettings?.stk_enabled })}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition ${financeSettings?.stk_enabled ? "bg-kenyan-green" : "bg-gray-300"}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${financeSettings?.stk_enabled ? "translate-x-6" : "translate-x-1"}`}
                          style={{ marginTop: 4, marginLeft: 4 }}
                        />
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveSettings({ paybill })}
                      className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50 self-start"
                    >
                      {saving ? "Saving…" : "Save Settings"}
                    </button>
                  </div>
                </div>
                {financeSettings?.invoice_prefix && (
                  <p className="text-caption text-gray-500 mt-4">Invoice prefix: {financeSettings.invoice_prefix}</p>
                )}
                {financeSettings?.late_fee != null && (
                  <p className="text-caption text-gray-500">Late fee: {financeSettings.late_fee}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
