import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function IntegrationsPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [financeSettings, setFinanceSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/school/integrations/channels"),
      api.get("/school/finance-settings"),
    ]).then(([channelsRes, financeRes]) => {
      setChannels(channelsRes.data || []);
      setFinanceSettings(financeRes.data || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <Skeleton rows={6} columns={3} />
        </div>
      </div>
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Integrations</h2>
          <div className="card p-6 mb-6">
            <h3 className="text-body font-semibold text-gray-900 mb-4">Payment Channels</h3>
            {channels.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No payment channels configured</div>
            ) : (
              <div className="space-y-3">
                {channels.map((ch) => (
                  <div key={ch.channel_id} className="flex justify-between items-center p-4 border border-gray-200 rounded-xl">
                    <div>
                      <div className="font-medium text-gray-900">{ch.label}</div>
                      <div className="text-caption">{ch.channel_type} • {ch.shortcode_or_account}</div>
                      <div className="text-muted mt-1">Environment: {ch.environment}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        ch.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {ch.status}
                      </span>
                      {ch.is_default && (
                        <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">Default</span>
                      )}
                      {ch.c2b_registered && (
                        <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">C2B</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-6">
            <h3 className="text-body font-semibold text-gray-900 mb-4">Finance Settings</h3>
            {financeSettings ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  ["Tuition Invoicing", financeSettings.tuition_invoicing],
                  ["Optional Services", financeSettings.optional_services],
                  ["Capitation Tracking", financeSettings.capitation_tracking],
                  ["Arrears Reminders", financeSettings.arrears_reminders],
                  ["Report Withholding", financeSettings.report_withholding],
                  ["Gate Arrears Denial", financeSettings.gate_arrears_denial],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-body">{label}</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      value ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {value ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                ))}
                {financeSettings.allowed_fee_categories && (
                  <div className="md:col-span-2">
                    <span className="text-caption uppercase tracking-wide">Allowed Fee Categories</span>
                    <p className="text-gray-900 mt-1">{financeSettings.allowed_fee_categories.join(", ")}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">No finance settings</div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}