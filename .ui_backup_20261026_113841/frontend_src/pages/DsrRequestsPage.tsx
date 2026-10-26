import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function DsrRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/compliance/dsr-requests")
      .then((res) => setRequests(res.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Data Subject Requests</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={requests}
              columns={[
                { key: "request_id", header: "Request ID" },
                { key: "request_type", header: "Type", render: (r) => r.request_type || "—" },
                { key: "status", header: "Status" },
                { key: "requested_at", header: "Requested", render: (r) => r.requested_at ? new Date(r.requested_at).toLocaleDateString() : "—" },
                { key: "completed_at", header: "Completed", render: (r) => r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "—" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}