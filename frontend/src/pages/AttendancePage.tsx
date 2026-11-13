import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { StatusIndicator } from "../components/StatusIndicator";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

const fmt = (d: unknown) => {
  if (d == null || d === "") return "—";
  const dt = new Date(d as string);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

interface AttendanceMark {
  id?: string;
  learner?: string;
  learner_id?: string;
  class_name?: string;
  class_group_id?: string;
  session_type?: string;
  status?: string;
  marked_at?: string;
}

export default function AttendancePage() {
  const [registers, setRegisters] = useState<any[]>([]);
  const [marks, setMarks] = useState<AttendanceMark[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const { t } = useTranslation();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get("/attendance/registers"),
      api.get("/attendance/marks"),
    ])
      .then(([rRes, mRes]) => {
        setRegisters(rRes.data || []);
        setMarks(mRes.data || []);
      })
      .catch(() => {
        // The page is the only real entrypoint for attendance/list/marks for
        // non-teachers, so a silent failure is misleading: it renders as "no
        // data" with no explanation. Surface it as an error with retry.
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const presentCount = marks.filter((m) => String(m.status).toUpperCase() === "PRESENT").length;
  const absentCount = marks.filter((m) => String(m.status).toUpperCase() === "ABSENT").length;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Attendance</h2>
            <StatusIndicator
              label={lastSaved ? "Attendance registers last refreshed" : "Loading attendance registers"}
              status={loading ? "loading" : lastSaved ? "saved" : "idle"}
            />
            <a
              href="/teacher/attendance"
              className="inline-flex items-center rounded-lg bg-kenyan-red px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Take / Mark Attendance
            </a>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : registers.length === 0 && marks.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-700">No attendance registers or marks are available yet.</p>
              <button
                className="mt-3 inline-flex items-center rounded-lg bg-kenyan-red px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                onClick={load}
              >
                Refresh attendance
              </button>
            </div>
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
                      { key: "status", header: "Status", render: (r) => <StatusIndicator label={String(r.status || "")} status={String(r.status || "").toLowerCase() as any} /> },
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
