import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceReconciliationPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/reconciliation/runs")
      .then((res) => setRuns(res.data || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Reconciliation Runs</h2>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <DataTable
              data={runs}
              loading={loading}
              columns={[
                { key: "run_id", header: "Run ID" },
                { key: "period", header: "Period", render: (r) => r.period || "—" },
                { key: "status", header: "Status" },
                { key: "total_expected", header: "Total", render: (r) => r.total_expected != null ? `KES ${r.total_expected}` : "—" },
                { key: "total_matched", header: "Matched", render: (r) => r.total_matched != null ? `KES ${r.total_matched}` : "—" },
                { key: "variance", header: "Variance", render: (r) => r.variance != null ? `KES ${r.variance}` : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}