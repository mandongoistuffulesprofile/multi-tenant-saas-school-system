import { useState, useEffect, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceCreditsPage() {
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/credits")
      .then((res) => setCredits(res.data || []))
      .catch(() => setCredits([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Credits</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={credits}
              loading={loading}
              columns={[
                { key: "credit_reference", header: "Reference" },
                { key: "learner_id", header: "Learner", render: (r) => r.learner_id || "—" },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
                { key: "created_at", header: "Date", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}