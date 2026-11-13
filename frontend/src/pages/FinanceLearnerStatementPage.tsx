import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Learner = {
  learner_id: string;
  admission_number?: string;
  first_name?: string;
  last_name?: string;
};

export default function FinanceLearnerStatementPage() {
  const [learners, setLearners] = useState<Learner[]>([]);
  const [selectedLearner, setSelectedLearner] = useState<string>("");
  const [statement, setStatement] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    api.get("/learners").then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setLearners(rows.map((l) => ({
        learner_id: l.learner_id,
        admission_number: l.admission_number,
        first_name: l.first_name,
        last_name: l.last_name,
      })));
    }).catch(() => {});
  }, []);

  const loadStatement = async (learnerId: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/statement/${learnerId}`);
      setStatement(res.data);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to load statement", { type: "error" });
      setStatement(null);
    } finally {
      setLoading(false);
    }
  };

  const learnerLabel = (l: Learner) => `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id;

  const formatAmount = (amt: number | undefined) => amt != null ? `KES ${amt.toLocaleString()}` : "—";

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Learner Statement</h2>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Learner</label>
            <select
              value={selectedLearner}
              onChange={(e) => { setSelectedLearner(e.target.value); if (e.target.value) loadStatement(e.target.value); }}
              className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-kenyan-red focus:border-transparent"
            >
              <option value="">Select a learner…</option>
              {learners.map((l) => (
                <option key={l.learner_id} value={l.learner_id}>{learnerLabel(l)}</option>
              ))}
            </select>
          </div>

          {selectedLearner && !statement && !loading && (
            <p className="text-gray-500">Select a learner to view their statement.</p>
          )}

          {loading && <Skeleton rows={10} columns={4} />}

          {statement && (
            <div className="space-y-8">
              {/* Header */}
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Learner</p>
                    <p className="font-semibold text-lg">{statement.learner_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Admission No.</p>
                    <p className="font-semibold">{statement.admission_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Outstanding</p>
                    <p className="font-semibold text-lg text-red-600">{formatAmount(statement.total_outstanding)}</p>
                  </div>
                </div>
              </div>

              {/* Invoices */}
              <section>
                <h3 className="text-lg font-semibold mb-3">Invoices</h3>
                {statement.invoices && statement.invoices.length > 0 ? (
                  <DataTable
                    data={statement.invoices}
                    emptyMessage="No invoices"
                    columns={[
                      { key: "invoice_number", header: "Invoice No." },
                      { key: "status", header: "Status" },
                      { key: "total_amount", header: "Total", render: (r) => formatAmount(r.total_amount) },
                      { key: "amount_paid", header: "Paid", render: (r) => formatAmount(r.amount_paid) },
                      { key: "amount_outstanding", header: "Outstanding", render: (r) => formatAmount(r.amount_outstanding) },
                      { key: "due_date", header: "Due Date", render: (r) => r.due_date ? new Date(r.due_date).toLocaleDateString() : "—" },
                    ]}
                  />
                ) : (
                  <p className="text-gray-500">No invoices found.</p>
                )}
              </section>

              {/* Payments */}
              <section>
                <h3 className="text-lg font-semibold mb-3">Payments</h3>
                {statement.payments && statement.payments.length > 0 ? (
                  <DataTable
                    data={statement.payments}
                    emptyMessage="No payments"
                    columns={[
                      { key: "payment_reference", header: "Reference" },
                      { key: "source", header: "Method" },
                      { key: "amount", header: "Amount", render: (r) => formatAmount(r.amount) },
                      { key: "status", header: "Status" },
                      { key: "received_at", header: "Received", render: (r) => r.received_at ? new Date(r.received_at).toLocaleDateString() : "—" },
                    ]}
                  />
                ) : (
                  <p className="text-gray-500">No payments found.</p>
                )}
              </section>

              {/* Adjustments */}
              <section>
                <h3 className="text-lg font-semibold mb-3">Adjustments</h3>
                {statement.adjustments && statement.adjustments.length > 0 ? (
                  <DataTable
                    data={statement.adjustments}
                    emptyMessage="No adjustments"
                    columns={[
                      { key: "adjustment_type", header: "Type" },
                      { key: "amount", header: "Amount", render: (r) => formatAmount(r.amount) },
                      { key: "reason", header: "Reason" },
                      { key: "created_at", header: "Date", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
                    ]}
                  />
                ) : (
                  <p className="text-gray-500">No adjustments found.</p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}