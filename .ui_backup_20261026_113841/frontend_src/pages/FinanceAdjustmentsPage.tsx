import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceAdjustmentsPage() {
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/adjustments")
      .then((res) => setAdjustments(res.data || []))
      .catch(() => setAdjustments([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Adjustments</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={adjustments}
              loading={loading}
              columns={[
                { key: "adjustment_reference", header: "Reference" },
                { key: "invoice_id", header: "Invoice", render: (r) => r.invoice_id || "—" },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "direction", header: "Direction", render: (r) => r.direction || "—" },
                { key: "reason", header: "Reason", render: (r) => r.reason || "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}