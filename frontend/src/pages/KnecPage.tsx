import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function KnecPage() {
  const [tools, setTools] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [exports, setExports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/knec/tools"),
      api.get("/knec/submissions"),
      api.get("/knec/exports"),
    ]).then(([tRes, sRes, eRes]) => {
      setTools(tRes.data || []);
      setSubmissions(sRes.data || []);
      setExports(eRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">KNEC</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Tools</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{tools.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Submissions</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{submissions.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Exports</h3>
                  <p className="text-3xl font-bold text-gray-900">{exports.length}</p>
                </div>
              </div>
              <DataTable
                data={tools}
                columns={[
                  { key: "tool_code", header: "Tool Code" },
                  { key: "name", header: "Name" },
                  { key: "category", header: "Category", render: (r) => r.category || "—" },
                  { key: "status", header: "Status" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}