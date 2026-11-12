import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function FinancePaymentsPage() {
  const [payModal, setPayModal] = useState(false);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [payForm, setPayForm] = useState({ learner_id: "", amount: "", payment_method: "CASH", reference: "" });
  const [recording, setRecording] = useState(false);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || null;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(payForm.amount);
    if (!payForm.learner_id || !Number.isFinite(amount) || amount <= 0) {
      toast("Select a learner and enter an amount greater than zero", { type: "error" });
      return;
    }
    setRecording(true);
    try {
      await api.post("/finance/payments", {
        learner_id: payForm.learner_id,
        amount,
        // The payments table column is `source` (CASH/BANK/CHEQUE/MPESA) and
        // the human receipt reference is `payment_reference`.
        source: payForm.payment_method,
        payment_reference: payForm.reference || undefined,
      });
      toast("Payment recorded", { type: "success" });
      setPayModal(false);
      setPayForm({ learner_id: "", amount: "", payment_method: "CASH", reference: "" });
      api.get("/finance/payments").then((r) => setPayments(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      const fe = err.response?.data?.field_errors;
      toast(fe?.[0]?.message || err.response?.data?.message || "Failed to record payment", { type: "error" });
    } finally {
      setRecording(false);
    }
  };

  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    api.get("/finance/payments").then((res) => {
      setPayments(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.get("/learners").then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setLearners(rows.map((l) => ({
        id: l.learner_id,
        label: `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id,
      })));
    }).catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Payments</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setPayModal(true)}>
              Record Payment
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={payments}
              emptyMessage="No payments found"
              columns={[
                { key: "payment_reference", header: "Reference" },
                { key: "learner_id", header: "Learner", render: (r) => r.learner_label || learnerName(r.learner_id) || r.learner_id || "—" },
                { key: "source", header: "Method" },
                { key: "amount", header: "Amount", render: (r) => r.amount != null ? `KES ${r.amount}` : "—" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
          <Dialog open={payModal} onClose={() => setPayModal(false)} title="Record Payment" className="max-w-md">
                <form onSubmit={handleRecordPayment}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner</span>
                    <select
                      required
                      value={payForm.learner_id}
                      onChange={(e) => setPayForm({ ...payForm, learner_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select learner…</option>
                      {learners.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)</span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      required
                      value={payForm.amount}
                      onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Method</span>
                    <select
                      value={payForm.payment_method}
                      onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="CASH">Cash</option>
                      <option value="BANK">Bank transfer</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="MPESA">M-Pesa</option>
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reference (optional)</span>
                    <input
                      type="text"
                      value={payForm.reference}
                      onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                      placeholder="e.g. receipt no. or M-Pesa code"
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                    <button type="button" onClick={() => setPayModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={recording}>
                      {recording ? "Recording…" : "Record"}
                    </button>
                  </div>
                </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}
