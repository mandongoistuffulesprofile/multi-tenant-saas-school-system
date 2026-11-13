import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type ClassGroup = {
  class_group_id: string;
  year_id: string;
  year_label: string;
  grade_id: string;
  grade_label: string;
  stream_id: string;
  stream_name: string;
  learner_count: number;
};
type Year = { year_id: string; year_label: string; is_current: boolean };
type Term = { term_id: string; term_number: number; term_label: string; start_date: string; end_date: string; is_current: boolean };

export default function AttendancePage() {
  const [registers, setRegisters] = useState<any[]>([]);
  const [marks, setMarks] = useState<any[]>([]);
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [editingRegister, setEditingRegister] = useState<any>(null);
  const [registerForm, setRegisterForm] = useState({
    class_group_id: "",
    academic_year_id: "",
    term_id: "",
    register_date: "",
    session_type: "MORNING",
  });
  const [savingRegister, setSavingRegister] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const fmt = (d: any) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [rRes, mRes, cgRes, yRes] = await Promise.all([
        api.get("/attendance/registers"),
        api.get("/attendance/marks"),
        api.get("/structure/class-groups"),
        api.get("/calendar/years"),
      ]);
      setRegisters(Array.isArray(rRes.data) ? rRes.data : []);
      setMarks(Array.isArray(mRes.data) ? mRes.data : []);
      setClassGroups(Array.isArray(cgRes.data) ? cgRes.data : []);
      setYears(Array.isArray(yRes.data) ? yRes.data : []);
      const currentYear = years.find(y => y.is_current) || years[0];
      if (currentYear) {
        const tRes = await api.get(`/calendar/terms?year_id=${currentYear.year_id}`);
        setTerms(Array.isArray(tRes.data) ? tRes.data : []);
      }
    } catch {
      toast("Failed to load data", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const openCreateRegister = () => {
    setEditingRegister(null);
    const today = new Date().toISOString().split("T")[0];
    setRegisterForm({ class_group_id: "", academic_year_id: "", term_id: "", register_date: today, session_type: "MORNING" });
    setRegisterModalOpen(true);
  };

  const openEditRegister = (reg: any) => {
    setEditingRegister(reg);
    setRegisterForm({
      class_group_id: reg.class_group_id,
      academic_year_id: reg.academic_year_id,
      term_id: reg.term_id,
      register_date: reg.register_date,
      session_type: reg.session_type,
    });
    setRegisterModalOpen(true);
  };

  const handleSaveRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerForm.class_group_id || !registerForm.academic_year_id || !registerForm.term_id || !registerForm.register_date) {
      toast("Fill all required fields", { type: "error" });
      return;
    }
    setSavingRegister(true);
    try {
      if (editingRegister) {
        await api.put(`/attendance/registers/${editingRegister.register_id}`, { status: registerForm.session_type });
        toast("Register updated", { type: "success" });
      } else {
        await api.post("/attendance/registers", {
          class_group_id: registerForm.class_group_id,
          academic_year_id: registerForm.academic_year_id,
          term_id: registerForm.term_id,
          register_date: registerForm.register_date,
          session_type: registerForm.session_type,
        });
        toast("Register created", { type: "success" });
      }
      setRegisterModalOpen(false);
      setEditingRegister(null);
      const rRes = await api.get("/attendance/registers");
      setRegisters(Array.isArray(rRes.data) ? rRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save", { type: "error" });
    } finally {
      setSavingRegister(false);
    }
  };

  const handleDeleteRegister = async (id: string) => {
    if (!confirm("Delete this attendance register? All marks will be removed.")) return;
    try {
      await api.delete(`/attendance/registers/${id}`);
      toast("Register deleted", { type: "success" });
      const rRes = await api.get("/attendance/registers");
      setRegisters(Array.isArray(rRes.data) ? rRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to delete", { type: "error" });
    }
  };

  const handleCloseRegister = async (id: string) => {
    try {
      await api.put(`/attendance/registers/${id}`, { status: "CLOSED" });
      toast("Register closed", { type: "success" });
      const rRes = await api.get("/attendance/registers");
      setRegisters(Array.isArray(rRes.data) ? rRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to close", { type: "error" });
    }
  };

  const classGroupLabel = (cg: ClassGroup) => `${cg.year_label} — ${cg.grade_label} ${cg.stream_name}`;
  const termLabel = (termId: string) => terms.find(t => t.term_id === termId)?.term_label || termId;
  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      OPEN: "bg-green-100 text-green-700",
      CLOSED: "bg-gray-100 text-gray-700",
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-700"}`}>{status}</span>;
  };

  const presentCount = marks.filter((m) => String(m.status).toUpperCase() === "PRESENT").length;
  const absentCount = marks.filter((m) => String(m.status).toUpperCase() === "ABSENT").length;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Attendance Registers</h2>
            <button className="btn-primary" onClick={openCreateRegister}>Open Register</button>
          </div>
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
          {loading ? <Skeleton rows={5} columns={5} /> : (
            <DataTable
              data={registers}
              emptyMessage="No attendance registers found"
              columns={[
                { key: "register_date", header: "Date", render: (r) => fmt(r.register_date) },
                { key: "class_group_id", header: "Class", render: (r) => classGroups.find(cg => cg.class_group_id === r.class_group_id) ? classGroupLabel(classGroups.find(cg => cg.class_group_id === r.class_group_id)!) : r.class_group_id },
                { key: "session_type", header: "Session", render: (r) => String(r.session_type || "").replace(/_/g, " ") },
                { key: "term_id", header: "Term", render: (r) => termLabel(r.term_id) },
                { key: "status", header: "Status", render: (r) => statusBadge(r.status) },
                { key: "actions", header: "Actions", render: (r) => (
                  <div className="flex gap-2">
                    {r.status === "OPEN" && (
                      <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => handleCloseRegister(r.register_id)}>Close</button>
                    )}
                    <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditRegister(r)}>Edit</button>
                    <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDeleteRegister(r.register_id)}>Delete</button>
                  </div>
                )},
              ]}
            />
          )}
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-3">Recent Marks</h3>
            {marks.length > 0 ? (
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
            ) : (
              <p className="text-gray-500">No marks recorded yet. Use the teacher attendance page to mark attendance.</p>
            )}
          </div>

          {/* Register Modal */}
          <Dialog open={registerModalOpen} onClose={() => { setRegisterModalOpen(false); setEditingRegister(null); }} title={editingRegister ? "Edit Register" : "Open Attendance Register"} className="max-w-md">
            <form onSubmit={handleSaveRegister}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Class Group *</span>
                <select
                  required
                  value={registerForm.class_group_id}
                  onChange={(e) => setRegisterForm({ ...registerForm, class_group_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select class group…</option>
                  {classGroups.map(cg => <option key={cg.class_group_id} value={cg.class_group_id}>{classGroupLabel(cg)}</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year *</span>
                <select
                  required
                  value={registerForm.academic_year_id}
                  onChange={(e) => setRegisterForm({ ...registerForm, academic_year_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select year…</option>
                  {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label} {y.is_current ? "(current)" : ""}</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Term *</span>
                <select
                  required
                  value={registerForm.term_id}
                  onChange={(e) => setRegisterForm({ ...registerForm, term_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select term…</option>
                  {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_label} ({t.start_date} to {t.end_date})</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Register Date *</span>
                <input
                  type="date"
                  required
                  value={registerForm.register_date}
                  onChange={(e) => setRegisterForm({ ...registerForm, register_date: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Session Type</span>
                <select
                  value={registerForm.session_type}
                  onChange={(e) => setRegisterForm({ ...registerForm, session_type: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="MORNING">Morning</option>
                  <option value="AFTERNOON">Afternoon</option>
                  <option value="EVENING">Evening</option>
                </select>
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setRegisterModalOpen(false); setEditingRegister(null); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingRegister}>
                  {savingRegister ? "Saving…" : editingRegister ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}