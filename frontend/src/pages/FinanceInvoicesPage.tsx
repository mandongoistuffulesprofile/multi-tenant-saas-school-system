import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useApiDeduper } from "../lib/mutationDeduper";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function FinanceInvoicesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const invoiceFormInit = () => ({ learner_id: "", term_id: "", amount: "", due_date: "" });
  const [invoiceForm, setInvoiceForm] = useState<{ learner_id: string; term_id: string; amount: string; due_date: string }>(invoiceFormInit);
  const [creating, setCreating] = useState(false);
  const invoiceModalTriggerRef = useRef<HTMLButtonElement>(null);
  const invoiceFormFirstRef = useRef<HTMLSelectElement>(null);
  const createInvoice = useApiDeduper();

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createInvoice()) return;
    setCreating(true);
    const amount = parseFloat(invoiceForm.amount);
    if (!invoiceForm.learner_id || !Number.isFinite(amount) || amount <= 0) {
      toast("Select a learner and enter an amount greater than zero", { type: "error" });
      setCreating(false);
      return;
    }
    try {
      // invoice_number and academic_year_id are defaulted server-side when
      // omitted (finance service auto-generates INV-<year>-<id> and resolves
      // the current academic year).
      const created = await api.post("/finance/invoices", {
        learner_id: invoiceForm.learner_id,
        term_id: invoiceForm.term_id || undefined,
        total_amount: amount,
        amount_outstanding: amount,
        amount_paid: 0,
        status: "OUTSTANDING",
        due_date: invoiceForm.due_date || undefined,
      });
      const createdInvoiceId = created.data?.id ?? created.data?.invoice_number ?? "";
      toast("Invoice generated successfully!", { type: "success", action: { label: "Undo", onClick: () => {
        api.delete(`/finance/invoices/${encodeURIComponent(createdInvoiceId)}`).catch(() => {});
        toast("Invoice removed.", { type: "info" });
        api.get("/finance/invoices").then((r) => setInvoices(Array.isArray(r.data) ? r.data : []));
      }}});
      setInvoiceForm(invoiceFormInit());
      setModalOpen(false);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create invoice", { type: "error" });
    } finally {
      setCreating(false);
      createInvoice.reset();
    }
  };

  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    api.get("/finance/invoices").then((res) => {
      setInvoices(res.data || []);
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

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || id || "—";

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Invoices</h2>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={invoices}
              emptyMessage="No invoices found"
              columns={[
                { key: "invoice_number", header: "Invoice No." },
                { key: "learner_id", header: "Learner", render: (r) => learnerName(r.learner_id) },
                { key: "status", header: "Status" },
                { key: "total_amount", header: "Total", render: (r) => r.total_amount != null ? `KES ${r.total_amount}` : "—" },
                { key: "amount_paid", header: "Paid", render: (r) => r.amount_paid != null ? `KES ${r.amount_paid}` : "—" },
                { key: "amount_outstanding", header: "Outstanding", render: (r) => r.amount_outstanding != null ? `KES ${r.amount_outstanding}` : "—" },
              ]}
            />
          )}
          <div style={{ marginTop: "1rem" }}>
            <button
            ref={invoiceModalTriggerRef}
            className="btn-primary"
            onClick={() => setModalOpen(true)}
          >Generate Invoice</button>
          </div>
          <Dialog
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Generate Invoice"
            className="max-w-md"
            initialFocusRef={invoiceFormFirstRef}
            returnFocusRef={invoiceModalTriggerRef}
          >
                <form onSubmit={handleCreateInvoice}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner<HelpTip text="Only active learners in this school are listed. The invoice is issued in this tenant's name and currency." /></span>
                    <select
                      ref={invoiceFormFirstRef}
                      required
                      value={invoiceForm.learner_id}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, learner_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select learner…</option>
                      {learners.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)<HelpTip text="This becomes the invoice total and the opening outstanding balance. Payments allocate against it oldest-invoice first." /></span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      required
                      value={invoiceForm.amount}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Due Date (optional)<HelpTip text="Used for reminders and for ordering unpaid invoices. Leave blank if the school does not bill to a fixed date." /></span>
                    <input
                      type="date"
                      value={invoiceForm.due_date}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                    <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={creating}>
                      {creating ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}