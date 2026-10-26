import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function AcademicCalendarPage() {
  const [years, setYears] = useState<any[]>([]);
  const [terms, setTerms] = useState<any[]>([]);
  const [windows, setWindows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/calendar/years"),
      api.get("/calendar/terms"),
      api.get("/calendar/exam-windows"),
    ]).then(([yRes, tRes, wRes]) => {
      setYears(yRes.data || []);
      setTerms(tRes.data || []);
      setWindows(wRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Academic Calendar</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <div className="space-y-6">
              <DataTable
                data={years}
                emptyMessage="No academic years found"
                columns={[
                  { key: "year_label", header: "Year" },
                  { key: "status", header: "Status" },
                  { key: "starts_at", header: "Starts", render: (r) => r.starts_at ? new Date(r.starts_at).toLocaleDateString() : "—" },
                  { key: "ends_at", header: "Ends", render: (r) => r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—" },
                ]}
              />
              <DataTable
                data={terms}
                emptyMessage="No terms found"
                columns={[
                  { key: "term_label", header: "Term" },
                  { key: "term_number", header: "No." },
                  { key: "starts_at", header: "Starts", render: (r) => r.starts_at ? new Date(r.starts_at).toLocaleDateString() : "—" },
                  { key: "ends_at", header: "Ends", render: (r) => r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—" },
                ]}
              />
              <DataTable
                data={windows}
                emptyMessage="No exam windows found"
                columns={[
                  { key: "window_label", header: "Window" },
                  { key: "starts_at", header: "Starts", render: (r) => r.starts_at ? new Date(r.starts_at).toLocaleDateString() : "—" },
                  { key: "ends_at", header: "Ends", render: (r) => r.ends_at ? new Date(r.ends_at).toLocaleDateString() : "—" },
                  { key: "status", header: "Status" },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}