import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function FinanceMpesaPage() {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/finance/mpesa/transactions")
      .then((res) => setTxns(res.data || []))
      .catch(() => setTxns([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">M-Pesa Transactions</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={txns}
              loading={loading}
              columns={[
                { key: "external_trans_id", header: "Trans ID", render: (r) => r.external_trans_id || "—" },
                { key: "msisdn_masked", header: "MSISDN", render: (r) => r.msisdn_masked || "—" },
                { key: "amount", header: "Amount", render: (r) => `KES ${r.amount}` },
                { key: "transaction_type", header: "Type", render: (r) => r.transaction_type || "—" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}