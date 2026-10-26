import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function BreachRegisterPage() {
  const [breaches, setBreaches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/compliance/breach-register")
      .then((res) => setBreaches(res.data || []))
      .catch(() => setBreaches([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Breach Register</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={breaches}
              columns={[
                { key: "breach_id", header: "Breach ID" },
                { key: "title", header: "Title" },
                { key: "severity", header: "Severity" },
                { key: "status", header: "Status" },
                { key: "occurred_at", header: "Occurred", render: (r) => r.occurred_at ? new Date(r.occurred_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}