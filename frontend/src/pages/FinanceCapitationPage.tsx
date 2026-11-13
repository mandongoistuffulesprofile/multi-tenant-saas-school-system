import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function FinanceCapitationPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const receiptFormInit = () => ({
    receipt_number: "",
    capitation_period: "",
    learner_count: "",
    amount_per_learner: "",
    received_at: "",
    reference: "",
  });
  const [receiptForm, setReceiptForm] = useState<{
    receipt_number: string;
    capitation_period: string;
    learner_count: string;
    amount_per_learner: string;
    received_at: string;
    reference: string;
  }>(receiptFormInit());

  useEffect(() => {
    api.get("/finance/capitation").then((res) => {
      setReceipts(res.data?.receipts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleCreateReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const learnerCount = parseInt(receiptForm.learner_count, 10);
    const amountPerLearner = parseFloat(receiptForm.amount_per_learner);
    if (!receiptForm.receipt_number.trim() || !receiptForm.capitation_period.trim() ||
        !Number.isFinite(learnerCount) || learnerCount <= 0 ||
        !Number.isFinite(amountPerLearner) || amountPerLearner <= 0) {
      toast("Fill all required fields with valid values", { type: "error" });
      return;
    }
    setCreating(true);
    try {
      await api.post("/finance/capitation", {
        receipt_number: receiptForm.receipt_number.trim(),
        capitation_period: receiptForm.capitation_period.trim(),
        learner_count: learnerCount,
        amount_per_learner: amountPerLearner,
        received_at: receiptForm.received_at || undefined,
        reference: receiptForm.reference.trim() || undefined,
      });
      toast("Capitation receipt recorded", { type: "success" });
      setModalOpen(false);
      setReceiptForm(receiptFormInit());
      api.get("/finance/capitation").then((r) => setReceipts(r.data?.receipts || []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to record receipt", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Capitation Receipts</h2>
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Record Receipt</button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={7} />
          ) : (
            <>
              <DataTable
                data={receipts}
                emptyMessage="No capitation receipts found"
                columns={[
                  { key: "receipt_number", header: "Receipt No." },
                  { key: "capitation_period", header: "Period" },
                  { key: "learner_count", header: "Learners", render: (r) => r.learner_count?.toLocaleString() },
                  { key: "amount_per_learner", header: "Per Learner", render: (r) => r.amount_per_learner != null ? `KES ${r.amount_per_learner}` : "—" },
                  { key: "total_amount", header: "Total", render: (r) => r.total_amount != null ? `KES ${r.total_amount}` : "—" },
                  { key: "status", header: "Status" },
                  { key: "received_at", header: "Received", render: (r) => r.received_at ? new Date(r.received_at).toLocaleDateString() : "—" },
                ]}
              />
              <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-sm text-green-800">
                  <strong>Total Received:</strong> KES {receipts.reduce((sum, r) => sum + (Number(r.total_amount) || 0), 0).toLocaleString()}
                </p>
              </div>
            </>
          )}
          <Dialog open={modalOpen} onClose={() => setModalOpen(false)} title="Record Capitation Receipt" className="max-w-md">
            <form onSubmit={handleCreateReceipt}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Receipt Number<HelpTip text="Unique receipt identifier from the Ministry." /></span>
                <input
                  type="text"
                  required
                  value={receiptForm.receipt_number}
                  onChange={(e) => setReceiptForm({ ...receiptForm, receipt_number: e.target.value })}
                  placeholder="e.g. CAP-2024-001"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Capitation Period<HelpTip text="Period this capitation covers (e.g., 2024-Term1, 2024-Term2, 2024-Term3)." /></span>
                <input
                  type="text"
                  required
                  value={receiptForm.capitation_period}
                  onChange={(e) => setReceiptForm({ ...receiptForm, capitation_period: e.target.value })}
                  placeholder="e.g. 2024-Term1"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learner Count<HelpTip text="Number of learners this capitation covers." /></span>
                <input
                  type="number"
                  min="1"
                  required
                  value={receiptForm.learner_count}
                  onChange={(e) => setReceiptForm({ ...receiptForm, learner_count: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Amount Per Learner (KES)<HelpTip text="Capitation amount per learner." /></span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={receiptForm.amount_per_learner}
                  onChange={(e) => setReceiptForm({ ...receiptForm, amount_per_learner: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Received Date (optional)</span>
                <input
                  type="date"
                  value={receiptForm.received_at}
                  onChange={(e) => setReceiptForm({ ...receiptForm, received_at: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Reference (optional)<HelpTip text="Bank reference or document number." /></span>
                <input
                  type="text"
                  value={receiptForm.reference}
                  onChange={(e) => setReceiptForm({ ...receiptForm, reference: e.target.value })}
                  placeholder="e.g. bank slip number"
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? "Recording…" : "Record"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}