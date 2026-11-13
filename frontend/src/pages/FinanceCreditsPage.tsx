import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function FinanceCreditsPage() {
  const [credits, setCredits] = useState<any[]>([]);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [payments, setPayments] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const creditFormInit = () => ({ learner_id: "", amount: "", reason: "", source_payment_id: "", expires_at: "" });
  const [creditForm, setCreditForm] = useState<{ learner_id: string; amount: string; reason: string; source_payment_id: string; expires_at: string }>(creditFormInit());

  useEffect(() => {
    api.get("/finance/credits").then((res) => {
      setCredits(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
    api.get("/learners").then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setLearners(rows.map((l) => ({
        id: l.learner_id,
        label: `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id,
      })));
    }).catch(() => {});
    api.get("/finance/payments").then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setPayments(rows.map((p) => ({
        id: p.payment_id,
        label: `${p.payment_reference || p.payment_id} · KES ${p.amount} · ${p.learner_id}`,
      })));
    }).catch(() => {});
  }, []);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || id || "—";
  const paymentLabel = (id: string) => payments.find((p) => p.id === id)?.label || id || "—";

  const handleCreateCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(creditForm.amount);
    if (!creditForm.learner_id || !Number.isFinite(amount) || amount <= 0 || !creditForm.reason.trim()) {
      toast("Select a learner, enter an amount greater than zero, and provide a reason", { type: "error" });
      return;
    }
    setCreating(true);
    try {
      await api.post("/finance/credits", {
        learner_id: creditForm.learner_id,
        amount,
        currency: "KES",
        reason: creditForm.reason.trim(),
        source_payment_id: creditForm.source_payment_id || undefined,
        expires_at: creditForm.expires_at || undefined,
      });
      toast("Credit note created", { type: "success" });
      setModalOpen(false);
      setCreditForm(creditFormInit());
      api.get("/finance/credits").then((r) => setCredits(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create credit note", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Credits</h2>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Create Credit Note</button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={credits}
              emptyMessage="No credit notes found"
              columns={[
                { key: "credit_reference", header: "Reference" },
                { key: "learner_id", header: "Learner", render: (r) => learnerName(r.learner_id) },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "currency", header: "Currency" },
                { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
                { key: "source_payment_id", header: "Source Payment", render: (r) => r.source_payment_id ? paymentLabel(r.source_payment_id) : "—" },
                { key: "expires_at", header: "Expires", render: (r) => r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—" },
                { key: "created_at", header: "Created", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
          <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title="Create Credit Note" className="max-w-md">
            <form onSubmit={handleCreateCredit}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner<HelpTip text="Credit applies to this learner's account." /></span>
                <select
                  required
                  value={creditForm.learner_id}
                  onChange={(e) => setCreditForm({ ...creditForm, learner_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select learner…</option>
                  {learners.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)<HelpTip text="Credit amount. This can be allocated to invoices later." /></span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={creditForm.amount}
                  onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reason<HelpTip text="Reason for the credit (e.g., overpayment, discount, waiver)." /></span>
                <input
                  type="text"
                  required
                  value={creditForm.reason}
                  onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })}
                  placeholder="e.g. Overpayment refund, sibling discount"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Source Payment (optional)<HelpTip text="Link to a payment that generated this credit (e.g., overpayment)." /></span>
                <select
                  value={creditForm.source_payment_id}
                  onChange={(e) => setCreditForm({ ...creditForm, source_payment_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">None</option>
                  {payments.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Expires At (optional)<HelpTip text="Credit expiry date. Leave blank for no expiry." /></span>
                <input
                  type="date"
                  value={creditForm.expires_at}
                  onChange={(e) => setCreditForm({ ...creditForm, expires_at: e.target.value })}
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