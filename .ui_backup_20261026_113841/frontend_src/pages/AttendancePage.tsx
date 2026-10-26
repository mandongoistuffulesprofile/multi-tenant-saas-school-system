import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

const fmt = (d: any) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

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

  const presentCount = marks.filter((m) => String(m.status).toUpperCase() === "PRESENT").length;
  const absentCount = marks.filter((m) => String(m.status).toUpperCase() === "ABSENT").length;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Attendance</h2>
            <a href="/teacher/attendance" className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition">
              Take / Mark Attendance
            </a>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Registers</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{registers.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Present Marks</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{presentCount}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Absent Marks</h3>
                  <p className="text-3xl font-bold text-gray-900">{absentCount}</p>
                </div>
              </div>
              <div className="space-y-6">
                <DataTable
                  data={registers}
                  emptyMessage="No attendance registers found"
                  columns={[
                    { key: "register_date", header: "Date", render: (r) => fmt(r.register_date) },
                    { key: "class_group_id", header: "Class" },
                    { key: "session_type", header: "Session", render: (r) => String(r.session_type || "").replace(/_/g, " ") },
                    { key: "status", header: "Status" },
                  ]}
                />
                {marks.length > 0 && (
                  <DataTable
                    data={marks.slice(0, 100)}
                    emptyMessage="No marks recorded"
                    columns={[
                      { key: "learner", header: "Learner", render: (r) => r.learner || r.learner_id },
                      { key: "class_name", header: "Class", render: (r) => r.class_name || r.class_group_id || "—" },
                      { key: "session_type", header: "Session", render: (r) => String(r.session_type || "").replace(/_/g, " ") },
                      { key: "status", header: "Status" },
                      { key: "marked_at", header: "Marked", render: (r) => fmt(r.marked_at) },
                    ]}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
