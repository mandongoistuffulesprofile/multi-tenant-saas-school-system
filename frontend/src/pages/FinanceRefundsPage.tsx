import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceRefundsPage() {
  const [refunds, setRefunds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/refunds")
      .then((res) => setRefunds(res.data || []))
      .catch(() => setRefunds([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Refunds</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={refunds}
              loading={loading}
              columns={[
                { key: "refund_reference", header: "Reference" },
                { key: "payment_id", header: "Payment", render: (r) => r.payment_id || "—" },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "status", header: "Status" },
                { key: "created_at", header: "Date", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}