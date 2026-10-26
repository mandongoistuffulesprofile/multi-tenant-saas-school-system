import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function ConsentNoticesPage() {
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    api.get("/compliance/consent-notices")
      .then((res) => setNotices(res.data || []))
      .catch(() => setNotices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-heading mb-6">Consent Notices</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={notices}
              columns={[
                { key: "title", header: "Title" },
                { key: "version", header: "Version", render: (r) => r.version || "—" },
                { key: "channel", header: "Channel", render: (r) => r.channel || "—" },
                { key: "is_required", header: "Required", render: (r) => r.is_required ? "Yes" : "No" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}