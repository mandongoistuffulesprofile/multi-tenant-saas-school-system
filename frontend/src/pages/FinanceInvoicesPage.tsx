import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceInvoicesPage() {
  const [modalOpen, setModalOpen] = useState(false);
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
      alert("Invoice generated successfully!");
      setModalOpen(false);
      // Refresh list
      api.get("/finance/invoices").then((r) => setInvoices(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to create invoice");
    } finally {
      setCreating(false);
    }
  };

  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/invoices").then((res) => {
      setInvoices(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

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
                { key: "learner_id", header: "Learner" },
                { key: "status", header: "Status" },
                { key: "total_amount", header: "Total", render: (r) => r.total_amount != null ? `KES ${r.total_amount}` : "—" },
                { key: "amount_paid", header: "Paid", render: (r) => r.amount_paid != null ? `KES ${r.amount_paid}` : "—" },
                { key: "amount_outstanding", header: "Outstanding", render: (r) => r.amount_outstanding != null ? `KES ${r.amount_outstanding}` : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}