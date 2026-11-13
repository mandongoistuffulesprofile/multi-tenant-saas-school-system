import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type FeeCategory = {
  category_id: string;
  code: string;
  name: string;
};

type InvoiceLine = {
  line_id: string;
  category_id: string;
  category_code?: string;
  description: string;
  quantity: number;
  unit_amount: number;
  line_amount: number;
};

export default function FinanceInvoicesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [linesModalOpen, setLinesModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [categories, setCategories] = useState<FeeCategory[]>([]);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const invoiceFormInit = () => ({ learner_id: "", term_id: "", amount: "", due_date: "" });
  const [invoiceForm, setInvoiceForm] = useState<{ learner_id: string; term_id: string; amount: string; due_date: string }>(invoiceFormInit);
  const [creating, setCreating] = useState(false);
  const [addingLine, setAddingLine] = useState(false);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const amount = parseFloat(invoiceForm.amount);
    if (!invoiceForm.learner_id || !Number.isFinite(amount) || amount <= 0) {
      toast("Select a learner and enter an amount greater than zero", { type: "error" });
      setCreating(false);
      return;
    }
    try {
      await api.post("/finance/invoices", {
        learner_id: invoiceForm.learner_id,
        term_id: invoiceForm.term_id || undefined,
        total_amount: amount,
        amount_outstanding: amount,
        amount_paid: 0,
        status: "OUTSTANDING",
        due_date: invoiceForm.due_date || undefined,
      });
      toast("Invoice generated successfully!", { type: "success" });
      setModalOpen(false);
      setInvoiceForm(invoiceFormInit());
      api.get("/finance/invoices").then((r) => setInvoices(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create invoice", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const openInvoiceLines = async (inv: any) => {
    setSelectedInvoice(inv);
    setLinesLoading(true);
    try {
      const [linesRes, catsRes] = await Promise.all([
        api.get(`/finance/invoices/${inv.invoice_id}/lines`),
        api.get("/finance/fee-categories"),
      ]);
      setInvoiceLines(Array.isArray(linesRes.data) ? linesRes.data : []);
      setCategories(Array.isArray(catsRes.data) ? catsRes.data : []);
    } catch {
      setInvoiceLines([]);
      setCategories([]);
    } finally {
      setLinesLoading(false);
      setLinesModalOpen(true);
    }
  };

  const handleAddLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    const categoryId = (e.target as HTMLFormElement).elements.namedItem("category_id") as HTMLSelectElement;
    const description = (e.target as HTMLFormElement).elements.namedItem("description") as HTMLInputElement;
    const quantity = (e.target as HTMLFormElement).elements.namedItem("quantity") as HTMLInputElement;
    const unitAmount = (e.target as HTMLFormElement).elements.namedItem("unit_amount") as HTMLInputElement;
    if (!categoryId.value || !description.value.trim() || !quantity.value || !unitAmount.value) {
      toast("Fill all fields", { type: "error" });
      return;
    }
    setAddingLine(true);
    try {
      await api.post(`/finance/invoices/${selectedInvoice.invoice_id}/lines`, {
        category_id: categoryId.value,
        description: description.value.trim(),
        quantity: parseInt(quantity.value, 10),
        unit_amount: parseFloat(unitAmount.value),
        academic_year_id: selectedInvoice.academic_year_id,
        term_id: selectedInvoice.term_id,
      });
      toast("Line added", { type: "success" });
      const linesRes = await api.get(`/finance/invoices/${selectedInvoice.invoice_id}/lines`);
      setInvoiceLines(Array.isArray(linesRes.data) ? linesRes.data : []);
      (e.target as HTMLFormElement).reset();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to add line", { type: "error" });
    } finally {
      setAddingLine(false);
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
  const categoryName = (id: string) => categories.find((c) => c.category_id === id)?.name || id || "—";

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Invoices</h2>
          {loading ? (
            <Skeleton rows={5} columns={7} />
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
                { key: "actions", header: "Actions", render: (r) => (
                  <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openInvoiceLines(r)}>View Lines</button>
                )},
              ]}
            />
          )}
          <div style={{ marginTop: "1rem" }}>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Generate Invoice</button>
          </div>

          {/* Generate Invoice Modal */}
          <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title="Generate Invoice" className="max-w-md">
            <form onSubmit={handleCreateInvoice}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner<HelpTip text="Only active learners in this school are listed. The invoice is issued in this tenant's name and currency." /></span>
                <select
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

          {/* Invoice Lines Modal */}
          <Dialog open={linesModalOpen} onClose={() => { setLinesModalOpen(false); setSelectedInvoice(null); setInvoiceLines([]); }} title={selectedInvoice ? `Lines for ${selectedInvoice.invoice_number}` : "Invoice Lines"} className="max-w-3xl">
            {linesLoading ? (
              <Skeleton rows={5} columns={5} />
            ) : (
              <div>
                <DataTable
                  data={invoiceLines}
                  emptyMessage="No lines on this invoice"
                  columns={[
                    { key: "category_id", header: "Category", render: (r) => categoryName(r.category_id) },
                    { key: "description", header: "Description" },
                    { key: "quantity", header: "Qty" },
                    { key: "unit_amount", header: "Unit Amt", render: (r) => `KES ${r.unit_amount}` },
                    { key: "line_amount", header: "Line Amt", render: (r) => `KES ${r.line_amount}` },
                  ]}
                />
                <hr style={{ margin: "1rem 0" }} />
                <h4 className="text-sm font-semibold mb-3">Add Line</h4>
                <form onSubmit={handleAddLine}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <select name="category_id" required style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}>
                      <option value="">Category…</option>
                      {categories.map((c) => (
                        <option key={c.category_id} value={c.category_id}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                    <input name="description" required placeholder="Description" style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }} />
                    <input name="quantity" type="number" min="1" required value="1" style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }} />
                    <input name="unit_amount" type="number" step="0.01" min="0.01" required placeholder="Unit Amount" style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }} />
                  </div>
                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={addingLine}>
                      {addingLine ? "Adding…" : "Add Line"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}