import { useState, useEffect } from "react";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

/**
 * Prepayment credits: money the school is holding on a learner's account.
 *
 * The figure that matters to a bursar is not the credit's original amount but
 * the part still unapplied; a credit with everything applied is history and a
 * VOID one is a reversed receipt.
 */
export default function FinanceCreditsPage() {
  const [credits, setCredits] = useState<any[]>([]);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get("/finance/credits"), api.get("/learners")])
      .then(([creditRes, learnerRes]) => {
        setCredits(Array.isArray(creditRes.data) ? creditRes.data : []);
        const rows: any[] = Array.isArray(learnerRes.data) ? learnerRes.data : [];
        setLearners(
          rows.map((l) => ({
            id: l.learner_id,
            label:
              `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() ||
              l.learner_id,
          })),
        );
      })
      .catch(() => setCredits([]))
      .finally(() => setLoading(false));
  }, []);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || id || "—";

  const unappliedTotal = credits
    .filter((c) => c.status !== "VOID")
    .reduce((sum, c) => sum + (Number(c.amount || 0) - Number(c.applied_amount || 0)), 0);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-heading">Credits</h2>
            {!loading && (
              <span className="text-sm text-gray-600">
                Held on account: <strong>KES {unappliedTotal.toFixed(2)}</strong>
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Prepayment received beyond a learner's fees. It is applied automatically to the
            oldest unpaid lines when new fee lines are billed.
          </p>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={credits}
              loading={loading}
              emptyMessage="No prepayment credits"
              columns={[
                {
                  key: "credit_id",
                  header: "Reference",
                  render: (r) => (r.credit_id ? String(r.credit_id).slice(0, 8).toUpperCase() : "—"),
                },
                { key: "learner_id", header: "Learner", render: (r) => learnerName(r.learner_id) },
                { key: "amount", header: "Amount", render: (r) => `KES ${Number(r.amount || 0).toFixed(2)}` },
                {
                  key: "applied_amount",
                  header: "Applied",
                  render: (r) => `KES ${Number(r.applied_amount || 0).toFixed(2)}`,
                },
                {
                  key: "remaining",
                  header: "Unapplied",
                  render: (r) => {
                    const remaining = Number(r.amount || 0) - Number(r.applied_amount || 0);
                    return (
                      <span className={remaining > 0 ? "font-medium text-kenyan-green" : "text-gray-500"}>
                        KES {remaining.toFixed(2)}
                      </span>
                    );
                  },
                },
                {
                  key: "status",
                  header: "Status",
                  render: (r) => r.status || "—",
                },
                { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
                {
                  key: "created_at",
                  header: "Date",
                  render: (r) => (r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"),
                },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
