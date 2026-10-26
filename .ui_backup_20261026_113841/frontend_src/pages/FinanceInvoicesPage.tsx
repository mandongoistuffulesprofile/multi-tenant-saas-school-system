import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function FinanceInvoicesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [invoiceForm, setInvoiceForm] = useState({ learner_id: "", term_id: "", amount: "", description: "Term Tuition" });
  const [creating, setCreating] = useState(false);

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/finance/invoices", {
        learner_id: invoiceForm.learner_id,
        term_id: invoiceForm.term_id,
        amount: parseFloat(invoiceForm.amount) || 0,
        description: invoiceForm.description,
      });
      toast("Invoice generated successfully!", { type: "success" });
      setModalOpen(false);
      // Refresh list
      api.get("/finance/invoices").then((r) => setInvoices(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create invoice", { type: "error" });
    } finally {
      setCreating(false);
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
      <div className="min-h-screen bg-gray-50 p-4">
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
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Generate Invoice</button>
          </div>
          {modalOpen && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setModalOpen(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Generate Invoice</h3>
                <form onSubmit={handleCreateInvoice}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner</span>
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
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount (KES)</span>
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
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Description</span>
                    <input
                      type="text"
                      value={invoiceForm.description}
                      onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={creating}>
                      {creating ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}