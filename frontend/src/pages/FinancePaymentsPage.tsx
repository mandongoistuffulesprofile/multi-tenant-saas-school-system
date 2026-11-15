import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

// Shown when another clerk is mid-settlement on the same invoice. Kept next to
// the form rather than taken from the 409 body, which is English.
export default function FinancePaymentsPage() {
  const [payModal, setPayModal] = useState(false);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [payForm, setPayForm] = useState({ learner_id: "", amount: "", payment_method: "CASH", reference: "" });
  const [recording, setRecording] = useState(false);
  // A 409 INVOICE_BUSY is not a failure: another clerk was mid-settlement on the
  // same invoice. Keep the form as typed and offer the same request again.
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || null;

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    await recordPayment();
  };

  const recordPayment = async () => {
    const amount = parseFloat(payForm.amount);
    if (!payForm.learner_id || !Number.isFinite(amount) || amount <= 0) {
      toast(t("finance.payments.pick_amount", { defaultValue: "Select a learner and enter an amount greater than zero" }), { type: "error" });
      return;
    }
    setRecording(true);
    setInvoiceBusy(null);
    try {
      await api.post("/finance/payments", {
        learner_id: payForm.learner_id,
        amount,
        // The payments table column is `source` (CASH/BANK/CHEQUE/MPESA) and
        // the human receipt reference is `payment_reference`.
        source: payForm.payment_method,
        payment_reference: payForm.reference || undefined,
      });
      toast(t("finance.payments.recorded", { defaultValue: "Payment recorded" }), { type: "success" });
      setPayModal(false);
      setPayForm({ learner_id: "", amount: "", payment_method: "CASH", reference: "" });
      api.get("/finance/payments").then((r) => setPayments(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      const status = err.response?.status;
      const code = err.response?.data?.code;
      if (status === 409 && code === "INVOICE_BUSY") {
        // The payment was refused, not lost: nothing was committed, so repeating
        // the same form cannot double-count. Say so and keep the dialog open.
        // The backend's message is English; the desk speaks Swahili, so the text
        // the clerk reads is ours. The code is what we react to.
        setInvoiceBusy(
          t("finance.payments.invoice_busy", {
            defaultValue:
              "Another payment is being applied to this invoice right now. Try again in a moment.",
          }),
        );
        return;
      }
      const fe = err.response?.data?.field_errors;
      toast(
        fe?.[0]?.message ||
          err.response?.data?.message ||
          t("finance.payments.failed", { defaultValue: "Failed to record payment" }),
        { type: "error" },
      );
    } finally {
      setRecording(false);
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
            <h2 className="text-heading">{t("finance.payments.title", { defaultValue: "Payments" })}</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setPayModal(true)}>
              {t("finance.payments.record", { defaultValue: "Record Payment" })}
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={payments}
              emptyMessage={t("finance.payments.none", { defaultValue: "No payments found" })}
              columns={[
                { key: "payment_reference", header: "Reference" },
                { key: "learner_id", header: "Learner", render: (r) => r.learner_label || learnerName(r.learner_id) || r.learner_id || "—" },
                { key: "source", header: "Method" },
                { key: "amount", header: "Amount", render: (r) => r.amount != null ? `KES ${r.amount}` : "—" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
          <Dialog
            open={payModal}
            onClose={() => setPayModal(false)}
            title={t("finance.payments.record", { defaultValue: "Record Payment" })}
            className="max-w-md"
          >
                <form onSubmit={handleRecordPayment}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>      {t("finance.payments.learner", { defaultValue: "Learner" })}
      <HelpTip
        text={t("finance.payments.learner_help", {
          defaultValue:
            "Only active learners in this school are listed. The receipt is posted against this learner's account.",
        })}
      /></span>
                    <select
                      required
                      value={payForm.learner_id}
                      onChange={(e) => setPayForm({ ...payForm, learner_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">{t("finance.payments.select_learner", { defaultValue: "Select learner…" })}</option>
                      {learners.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>      {t("finance.payments.amount", { defaultValue: "Amount (KES)" })}
      <HelpTip
        text={t("finance.payments.amount_help", {
          defaultValue:
            "The payment is allocated to this learner's oldest unpaid invoice. Any remainder stays as an unallocated payment on account.",
        })}
      /></span>
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
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("finance.payments.method", { defaultValue: "Method" })}</span>
                    <select
                      value={payForm.payment_method}
                      onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="CASH">{t("finance.payments.cash", { defaultValue: "Cash" })}</option>
                      <option value="BANK">{t("finance.payments.bank", { defaultValue: "Bank transfer" })}</option>
                      <option value="CHEQUE">{t("finance.payments.cheque", { defaultValue: "Cheque" })}</option>
                      <option value="MPESA">{t("finance.payments.mpesa", { defaultValue: "M-Pesa" })}</option>
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>      {t("finance.payments.reference", { defaultValue: "Reference (optional)" })}
      <HelpTip
        text={t("finance.payments.reference_help", {
          defaultValue:
            "Use the M-Pesa code, bank slip or receipt number. Unique M-Pesa transaction IDs are protected against duplicate posting.",
        })}
      /></span>
                    <input
                      type="text"
                      value={payForm.reference}
                      onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                      placeholder={t("finance.payments.reference_placeholder", { defaultValue: "e.g. receipt no. or M-Pesa code" })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  {invoiceBusy && (
                    <div
                      role="status"
                      className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2"
                    >
                      <p className="font-medium">{invoiceBusy}</p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => recordPayment()}
                          disabled={recording}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-white hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                        >
                          {recording
                            ? t("finance.payments.sending", { defaultValue: "Sending…" })
                            : t("finance.payments.retry", { defaultValue: "Try again" })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvoiceBusy(null)}
                          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-bold text-amber-900 hover:border-amber-400 cursor-pointer"
                        >
                          {t("finance.payments.dismiss", { defaultValue: "Dismiss" })}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                    <button type="button" onClick={() => setPayModal(false)} style={{ padding: "0.5rem 1rem" }}>
                      {t("finance.payments.cancel", { defaultValue: "Cancel" })}
                    </button>
                    <button type="submit" className="btn-primary" disabled={recording}>
                      {recording
                        ? t("finance.payments.recording", { defaultValue: "Recording…" })
                        : t("finance.payments.submit", { defaultValue: "Record" })}
                    </button>
                  </div>
                </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}
