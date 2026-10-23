import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinancePaymentsPage() {
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm] = useState({ invoice_id: "", amount: "", payment_method: "MPESA", reference: "" });
  const [recording, setRecording] = useState(false);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecording(true);
    try {
      await api.post("/finance/payments", {
        invoice_id: payForm.invoice_id,
        amount: parseFloat(payForm.amount) || 0,
        payment_method: payForm.payment_method,
        reference: payForm.reference.trim(),
      });
      alert("Payment recorded and allocated successfully!");
      setPayModal(false);
      api.get("/finance/payments").then((r) => setPayments(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to record payment");
    } finally {
      setRecording(false);
    }
  };

  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/payments").then((res) => {
      setPayments(res.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Payments</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={payments}
              emptyMessage="No payments found"
              columns={[
                { key: "payment_reference", header: "Reference" },
                { key: "learner_id", header: "Learner" },
                { key: "source", header: "Source" },
                { key: "amount", header: "Amount", render: (r) => r.amount != null ? `KES ${r.amount}` : "—" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}