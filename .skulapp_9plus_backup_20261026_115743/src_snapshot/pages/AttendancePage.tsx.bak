import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function AttendancePage() {
  const [registers, setRegisters] = useState<any[]>([]);
  const [marks, setMarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/attendance/registers"),
      api.get("/attendance/marks"),
    ]).then(([rRes, mRes]) => {
      setRegisters(rRes.data || []);
      setMarks(mRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Attendance</h2>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="card p-6">
                <h3 className="text-caption uppercase tracking-wide mb-2">Registers</h3>
                <p className="text-3xl font-bold text-kenyan-red">{registers.length}</p>
              </div>
              <div className="card p-6">
                <h3 className="text-caption uppercase tracking-wide mb-2">Marks</h3>
                <p className="text-3xl font-bold text-kenyan-green">{marks.length}</p>
              </div>
            </div>
          )}
          {!loading && (
            <DataTable
              data={registers}
              emptyMessage="No attendance registers found"
              columns={[
                { key: "register_date", header: "Date" },
                { key: "class_group_id", header: "Class" },
                { key: "session_type", header: "Session" },
                { key: "status", header: "Status" },
              ]}
            />
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}