import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useApiDeduper } from "../lib/mutationDeduper";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";
import { MpesaIcon, BankSlipIcon, GovShieldIcon, CashIcon } from "../components/icons/PaymentIcons";

export default function FinancePaymentsPage() {
  const [payModal, setPayModal] = useState(false);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [payForm, setPayForm] = useState({ learner_id: "", amount: "", payment_method: "CASH", reference: "" });
  const [recording, setRecording] = useState(false);
  const payModalTriggerRef = useRef<HTMLButtonElement>(null);
  const payFormFirstRef = useRef<HTMLSelectElement>(null);
  const recordPayment = useApiDeduper();
  // Reversing a receipt is a money-visible action, so it needs an explicit
  // target and a written reason rather than a one-click undo.
  const [reverseTarget, setReverseTarget] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || null;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordPayment()) return;
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
      recordPayment.reset();
    }
  };

  const reloadPayments = () =>
    api.get("/finance/payments").then((r) => setPayments(Array.isArray(r.data) ? r.data : [])).catch(() => {});

  const handleReverse = async () => {
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (reason.length < 5) {
      toast("Give a reason for the reversal", { type: "error" });
      return;
    }
    setReversing(true);
    try {
      await api.post(`/finance/payments/${reverseTarget.payment_id}/reverse`, { reason });
      toast("Receipt reversed", { type: "success" });
      setReverseTarget(null);
      setReverseReason("");
      await reloadPayments();
    } catch (err: any) {
      // The API refuses while the receipt's prepayment has been spent; show
      // that sentence rather than a generic failure.
      toast(err.response?.data?.message || "Failed to reverse receipt", { type: "error" });
    } finally {
      setReversing(false);
    }
  };

  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep links (PWA shortcut, /finance/record alias) open the record dialog,
  // then strip the action so closing it does not reopen on the next render.
  useEffect(() => {
    if (searchParams.get("action") !== "record") return;
    setPayModal(true);
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

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
            <button
              ref={payModalTriggerRef}
              className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition"
              onClick={() => setPayModal(true)}
            >
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
                {
                  key: "actions",
                  header: "",
                  render: (r) =>
                    r.status === "COMPLETED" ? (
                      <button
                        type="button"
                        className="text-sm font-medium text-kenyan-red hover:underline"
                        onClick={() => {
                          setReverseTarget(r);
                          setReverseReason("");
                        }}
                      >
                        Reverse
                      </button>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          )}
          <Dialog
            open={payModal}
            onClose={() => setPayModal(false)}
            title="Record Payment"
            className="max-w-md"
            initialFocusRef={payFormFirstRef}
            returnFocusRef={payModalTriggerRef}
          >
                <form onSubmit={handleRecordPayment}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner<HelpTip text="Only active learners in this school are listed. The receipt is posted against this learner's account." /></span>
                    <select
                      ref={payFormFirstRef}
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
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)<HelpTip text="The payment is allocated to this learner's oldest unpaid invoice. Any remainder stays as an unallocated payment on account." /></span>
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
                      <div role="radiogroup" aria-label="Payment method" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        {(
                          [
                            { value: 'MPESA', label: 'M-Pesa Paybill/STK', icon: MpesaIcon, active: 'border-kenyan-green bg-kenyan-green/10', inactive: 'border-gray-200 bg-white hover:border-gray-300' },
                            { value: 'BANK', label: 'Bank slip / EFT', icon: BankSlipIcon, active: 'border-kenyan-green bg-kenyan-green/10', inactive: 'border-gray-200 bg-white hover:border-gray-300' },
                            { value: 'CHEQUE', label: 'Bursary / CDF cheque', icon: GovShieldIcon, active: 'border-amber-500 bg-amber-50/30', inactive: 'border-gray-200 bg-white hover:border-gray-300' },
                            { value: 'CASH', label: 'Cash office slip', icon: CashIcon, active: 'border-kenyan-green bg-kenyan-green/10', inactive: 'border-gray-200 bg-white hover:border-gray-300' },
                          ] as const
                        ).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={payForm.payment_method === option.value}
                            onClick={() => setPayForm({ ...payForm, payment_method: option.value })}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.5rem 0.75rem',
                              border: '1px solid',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              background: payForm.payment_method === option.value ? undefined : '#ffffff',
                              borderColor: payForm.payment_method === option.value ? 'var(--color-kenyan-green)' : '#d1d5db',
                              color: payForm.payment_method === option.value ? 'var(--color-kenyan-green)' : '#111827',
                            }}
                          >
                            {option.icon === MpesaIcon ? (
                              <MpesaIcon size={18} />
                            ) : option.icon === BankSlipIcon ? (
                              <BankSlipIcon size={16} />
                            ) : option.icon === GovShieldIcon ? (
                              <GovShieldIcon size={16} />
                            ) : (
                              <CashIcon size={16} />
                            )}
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reference (optional)<HelpTip text="Use the M-Pesa code, bank slip or receipt number. Unique M-Pesa transaction IDs are protected against duplicate posting." /></span>
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

          <Dialog
            open={reverseTarget !== null}
            onClose={() => setReverseTarget(null)}
            title="Reverse receipt"
            className="max-w-md"
          >
            <p style={{ fontSize: "0.9rem", color: "#374151", marginBottom: "0.75rem" }}>
              This voids the receipt
              {reverseTarget?.payment_reference ? ` ${reverseTarget.payment_reference}` : ""} and
              restores the fee lines it settled. Nothing is deleted: a reversing entry is posted
              against each allocation, and the learner's arrears reappear.
            </p>
            <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.75rem" }}>
              If part of this receipt was held as prepayment and has since been spent on other
              lines, the reversal is refused — reverse those applications first.
            </p>
            <label style={{ display: "block", marginBottom: "0.75rem" }}>
              <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reason</span>
              <textarea
                required
                rows={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="e.g. cheque returned unpaid"
                style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
              <button type="button" onClick={() => setReverseTarget(null)} style={{ padding: "0.5rem 1rem" }}>
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium disabled:opacity-60"
                onClick={handleReverse}
                disabled={reversing}
              >
                {reversing ? "Reversing…" : "Reverse receipt"}
              </button>
            </div>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}
