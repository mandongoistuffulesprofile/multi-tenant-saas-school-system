import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function CompliancePage() {
  const [notices, setNotices] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [dsr, setDSR] = useState<any[]>([]);
  const [breaches, setBreaches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/compliance/consent-notices"),
      api.get("/compliance/consent-records"),
      api.get("/compliance/access-logs"),
      api.get("/compliance/dsr-requests"),
      api.get("/compliance/breach-register"),
    ]).then(([nRes, rRes, lRes, dRes, bRes]) => {
      setNotices(nRes.data || []);
      setRecords(rRes.data || []);
      setLogs(lRes.data || []);
      setDSR(dRes.data || []);
      setBreaches(bRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Compliance (ODPC)</h2>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Notices</h3>
                  <p className="text-2xl font-bold text-kenyan-red">{notices.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Consent</h3>
                  <p className="text-2xl font-bold text-kenyan-green">{records.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Logs</h3>
                  <p className="text-2xl font-bold text-gray-900">{logs.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">DSR</h3>
                  <p className="text-2xl font-bold text-gray-900">{dsr.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Breaches</h3>
                  <p className="text-2xl font-bold text-gray-900">{breaches.length}</p>
                </div>
              </div>
              <DataTable
                data={logs}
                emptyMessage="No access logs found"
                columns={[
                  { key: "action", header: "Action" },
                  { key: "resource_type", header: "Resource Type" },
                  { key: "resource_id", header: "Resource ID" },
                  { key: "accessed_at", header: "Accessed At" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}