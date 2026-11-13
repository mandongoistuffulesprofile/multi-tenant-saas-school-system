import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Payment = {
  payment_id: string;
  payment_reference?: string;
  learner_id?: string;
  amount?: number;
  status?: string;
};

export default function FinanceRefundsPage() {
  const [refunds, setRefunds] = useState<any[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const refundFormInit = () => ({ payment_id: "", amount: "", reason: "" });
  const [refundForm, setRefundForm] = useState<{ payment_id: string; amount: string; reason: string }>(refundFormInit());

  useEffect(() => {
    api.get("/finance/refunds").then((res) => {
      setRefunds(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.get("/finance/payments", { params: { limit: 500, offset: 0 } }).then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setPayments(rows.filter((p) => String(p.status || "").toUpperCase() === "COMPLETED"));
    }).catch(() => {});
  }, []);

  const paymentLabel = (id: string) => {
    const p = payments.find((pmt) => pmt.payment_id === id);
    return p ? `${p.payment_reference || p.payment_id} · KES ${p.amount?.toLocaleString()} · {p.learner_id}` : id;
  };

  const handleCreateRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(refundForm.amount);
    if (!refundForm.payment_id || !Number.isFinite(amount) || amount <= 0 || !refundForm.reason.trim()) {
      toast("Select a payment, enter an amount greater than zero, and provide a reason", { type: "error" });
      return;
    }
    setCreating(true);
    try {
      await api.post("/finance/refunds", {
        payment_id: refundForm.payment_id,
        amount,
        currency: "KES",
        reason: refundForm.reason.trim(),
        status: "PENDING",
      });
      toast("Refund created", { type: "success" });
      setModalOpen(false);
      setRefundForm(refundFormInit());
      api.get("/finance/refunds").then((r) => setRefunds(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create refund", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Refunds</h2>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Create Refund</button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={refunds}
              emptyMessage="No refunds found"
              columns={[
                { key: "refund_reference", header: "Reference" },
                { key: "payment_id", header: "Payment", render: (r) => r.payment_id ? paymentLabel(r.payment_id) : "—" },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "currency", header: "Currency" },
                { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
                { key: "status", header: "Status" },
                { key: "created_at", header: "Created", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
          <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title="Create Refund" className="max-w-md">
            <form onSubmit={handleCreateRefund}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Payment<HelpTip text="Select a completed payment to refund." /></span>
                <select
                  required
                  value={refundForm.payment_id}
                  onChange={(e) => setRefundForm({ ...refundForm, payment_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select payment…</option>
                  {payments.map((p) => (
                    <option key={p.payment_id} value={p.payment_id}>
                      {p.payment_reference || p.payment_id} · KES {Number(p.amount || 0).toLocaleString()} · {p.learner_id}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)<HelpTip text="Refund amount (cannot exceed original payment)." /></span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={refundForm.amount}
                  onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reason<HelpTip text="Reason for the refund." /></span>
                <input
                  type="text"
                  required
                  value={refundForm.reason}
                  onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })}
                  placeholder="e.g. Duplicate payment, service not rendered"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}