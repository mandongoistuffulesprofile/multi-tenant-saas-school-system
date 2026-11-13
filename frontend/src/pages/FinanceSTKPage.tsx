import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type STKRequest = {
  stk_id: string;
  phone_number: string;
  amount: number;
  currency: string;
  account_reference?: string;
  transaction_desc?: string;
  status: string;
  checkout_request_id?: string;
  created_at: string;
};

export default function FinanceSTKPage() {
  const [stkRequests, setStkRequests] = useState<STKRequest[]>([]);
  const [channels, setChannels] = useState<{ channel_id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const { t } = useTranslation();
  const { toast } = useToast();

  const stkFormInit = () => ({
    channel_id: "",
    phone_number: "",
    amount: "",
    account_reference: "",
    transaction_desc: "",
  });
  const [stkForm, setStkForm] = useState<{
    channel_id: string;
    phone_number: string;
    amount: string;
    account_reference: string;
    transaction_desc: string;
  }>(stkFormInit());

  useEffect(() => {
    api.get("/finance/mpesa/stk-requests").then((res) => {
      setStkRequests(Array.isArray(res.data) ? res.data : []);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.get("/finance/mpesa/channels").then((res) => {
      setChannels(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, []);

  const handleCreateSTK = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(stkForm.amount);
    if (!stkForm.channel_id || !stkForm.phone_number.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast("Select a channel, enter a valid phone number, and amount", { type: "error" });
      return;
    }
    setCreating(true);
    try {
      await api.post("/finance/mpesa/stk-push", {
        channel_id: stkForm.channel_id,
        phone_number: stkForm.phone_number.trim(),
        amount,
        currency: "KES",
        account_reference: stkForm.account_reference.trim() || undefined,
        transaction_desc: stkForm.transaction_desc.trim() || undefined,
      });
      toast("STK push initiated", { type: "success" });
      setModalOpen(false);
      setStkForm(stkFormInit());
      api.get("/finance/mpesa/stk-requests").then((r) => setStkRequests(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to initiate STK push", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const checkStatus = async (stkId: string) => {
    setChecking(stkId);
    try {
      const res = await api.get(`/finance/mpesa/stk-requests/${stkId}/status`);
      toast(`Status: ${res.data?.status || "Unknown"}`, { type: "success" });
      api.get("/finance/mpesa/stk-requests").then((r) => setStkRequests(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to check status", { type: "error" });
    } finally {
      setChecking(null);
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "bg-yellow-100 text-yellow-700",
      SENT: "bg-blue-100 text-blue-700",
      COMPLETED: "bg-green-100 text-green-700",
      FAILED: "bg-red-100 text-red-700",
      EXPIRED: "bg-gray-100 text-gray-700",
      CANCELLED: "bg-gray-100 text-gray-700",
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">M-Pesa STK Push</h2>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Initiate STK Push</button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={stkRequests}
              emptyMessage="No STK requests found"
              columns={[
                { key: "stk_id", header: "STK ID", render: (r) => r.stk_id.slice(0, 8) + "…" },
                { key: "phone_number", header: "Phone" },
                { key: "amount", header: "Amount", render: (r) => `${r.currency || "KES"} ${r.amount?.toLocaleString()}` },
                { key: "account_reference", header: "Account Ref", render: (r) => r.account_reference || "—" },
                { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                { key: "checkout_request_id", header: "Checkout ID", render: (r) => r.checkout_request_id || "—" },
                { key: "created_at", header: "Created", render: (r) => r.created_at ? new Date(r.created_at).toLocaleString() : "—" },
                { key: "actions", header: "Actions", render: (r) => (
                  <button
                    className="px-3 py-1 text-sm text-kenyan-red hover:underline"
                    onClick={() => checkStatus(r.stk_id)}
                    disabled={checking === r.stk_id}
                  >
                    {checking === r.stk_id ? "Checking…" : "Check Status"}
                  </button>
                )},
              ]}
            />
          )}
          <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title="Initiate STK Push" className="max-w-md">
            <form onSubmit={handleCreateSTK}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Channel<HelpTip text="M-Pesa payment channel to use." /></span>
                <select
                  required
                  value={stkForm.channel_id}
                  onChange={(e) => setStkForm({ ...stkForm, channel_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select channel…</option>
                  {channels.map((c) => (
                    <option key={c.channel_id} value={c.channel_id}>{c.name} ({c.channel_id})</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Phone Number<HelpTip text="Customer phone number in format 2547XXXXXXXX." /></span>
                <input
                  type="tel"
                  required
                  pattern="254[0-9]{9}"
                  value={stkForm.phone_number}
                  onChange={(e) => setStkForm({ ...stkForm, phone_number: e.target.value })}
                  placeholder="2547XXXXXXXX"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)<HelpTip text="Amount to request from customer." /></span>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={stkForm.amount}
                  onChange={(e) => setStkForm({ ...stkForm, amount: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Account Reference (optional)<HelpTip text="Reference shown on customer's M-Pesa prompt (e.g., invoice number)." /></span>
                <input
                  type="text"
                  value={stkForm.account_reference}
                  onChange={(e) => setStkForm({ ...stkForm, account_reference: e.target.value })}
                  placeholder="e.g. INV-2024-001"
                  maxLength={12}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Transaction Description (optional)</span>
                <input
                  type="text"
                  value={stkForm.transaction_desc}
                  onChange={(e) => setStkForm({ ...stkForm, transaction_desc: e.target.value })}
                  placeholder="e.g. Term 1 Fees"
                  maxLength={13}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Initiating…" : "Initiate STK Push"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}