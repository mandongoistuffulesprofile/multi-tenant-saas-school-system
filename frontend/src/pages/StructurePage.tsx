import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Stream = { stream_id: string; stream_name: string; created_at: string };
type Grade = { grade_id: string; grade_label: string; level_band: string; lessons_per_week: number };
type Year = { year_id: string; year_label: string; is_current: boolean };
type ClassGroup = {
  class_group_id: string;
  year_id: string;
  year_label: string;
  grade_id: string;
  grade_label: string;
  stream_id: string;
  stream_name: string;
  class_teacher_id: string;
  class_teacher_name: string;
  learner_count: number;
  created_at: string;
};
type Staff = { membership_id: string; email: string; phone_number: string; role: string };
type Subject = { area_id: string; code: string; name: string };
type TeachingAssignment = {
  assignment_id: string;
  staff_membership_id: string;
  teacher_name: string;
  class_group_id: string;
  class_label: string;
  subject_id: string;
  subject_name: string;
  academic_year_id: string;
  created_at: string;
};

export default function StructurePage() {
  const [activeTab, setActiveTab] = useState<"streams" | "classgroups" | "assignments" | "rollover">("streams");
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  // Streams
  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamModalOpen, setStreamModalOpen] = useState(false);
  const [editingStream, setEditingStream] = useState<Stream | null>(null);
  const [streamForm, setStreamForm] = useState({ stream_name: "" });
  const [savingStream, setSavingStream] = useState(false);

  // Class Groups
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [cgModalOpen, setCgModalOpen] = useState(false);
  const [editingCG, setEditingCG] = useState<ClassGroup | null>(null);
  const [cgForm, setCgForm] = useState({ year_id: "", grade_id: "", stream_id: "", class_teacher_id: "" });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [savingCG, setSavingCG] = useState(false);

  // Teaching Assignments
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [taModalOpen, setTaModalOpen] = useState(false);
  const [editingTA, setEditingTA] = useState<TeachingAssignment | null>(null);
  const [taForm, setTaForm] = useState({ staff_membership_id: "", class_group_id: "", subject_id: "", academic_year_id: "" });
  const [savingTA, setSavingTA] = useState(false);

  // Rollover
  const [rolloverFromYear, setRolloverFromYear] = useState("");
  const [rolloverToYear, setRolloverToYear] = useState("");
  const [rolloverGrades, setRolloverGrades] = useState<string[]>([]);
  const [rollingOver, setRollingOver] = useState(false);

  useEffect(() => {
    loadAll();
  }, [activeTab]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sRes, yRes, gRes, stRes, cgRes, taRes, subRes] = await Promise.all([
        api.get("/structure/streams"),
        api.get("/calendar/years"),
        api.get("/structure/grades"),
        api.get("/staff"),
        api.get("/structure/class-groups"),
        api.get("/structure/teaching-assignments"),
        api.get("/curriculum/areas"),
      ]);
      setStreams(Array.isArray(sRes.data) ? sRes.data : []);
      setYears(Array.isArray(yRes.data) ? yRes.data : []);
      setGrades(Array.isArray(gRes.data) ? gRes.data : []);
      setStaff(Array.isArray(stRes.data) ? stRes.data : []);
      setClassGroups(Array.isArray(cgRes.data) ? cgRes.data : []);
      setAssignments(Array.isArray(taRes.data) ? taRes.data : []);
      setSubjects(Array.isArray(subRes.data) ? subRes.data.map((a: any) => ({ area_id: a.area_id, code: a.code, name: a.name })) : []);
    } catch {
      toast("Failed to load data", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // ---- Streams ----
  const openCreateStream = () => { setEditingStream(null); setStreamForm({ stream_name: "" }); setStreamModalOpen(true); };
  const openEditStream = (s: Stream) => { setEditingStream(s); setStreamForm({ stream_name: s.stream_name }); setStreamModalOpen(true); };

  const handleSaveStream = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streamForm.stream_name.trim()) { toast("Enter stream name", { type: "error" }); return; }
    setSavingStream(true);
    try {
      if (editingStream) {
        await api.put(`/structure/streams/${editingStream.stream_id}`, { stream_name: streamForm.stream_name.trim() });
        toast("Stream updated", { type: "success" });
      } else {
        await api.post("/structure/streams", { stream_name: streamForm.stream_name.trim() });
        toast("Stream created", { type: "success" });
      }
      setStreamModalOpen(false);
      setEditingStream(null);
      setStreamForm({ stream_name: "" });
      const sRes = await api.get("/structure/streams");
      setStreams(Array.isArray(sRes.data) ? sRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save", { type: "error" });
    } finally {
      setSavingStream(false);
    }
  };

  const handleDeleteStream = async (id: string) => {
    if (!confirm("Delete this stream? Class groups using it will block deletion.")) return;
    try {
      await api.delete(`/structure/streams/${id}`);
      toast("Stream deleted", { type: "success" });
      const sRes = await api.get("/structure/streams");
      setStreams(Array.isArray(sRes.data) ? sRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to delete", { type: "error" });
    }
  };

  // ---- Class Groups ----
  const openCreateCG = () => { setEditingCG(null); setCgForm({ year_id: "", grade_id: "", stream_id: "", class_teacher_id: "" }); setCgModalOpen(true); };
  const openEditCG = (cg: ClassGroup) => { setEditingCG(cg); setCgForm({ year_id: cg.year_id, grade_id: cg.grade_id, stream_id: cg.stream_id, class_teacher_id: cg.class_teacher_id }); setCgModalOpen(true); };

  const handleSaveCG = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cgForm.year_id || !cgForm.grade_id || !cgForm.stream_id) { toast("Select year, grade and stream", { type: "error" }); return; }
    setSavingCG(true);
    try {
      if (editingCG) {
        await api.put(`/structure/class-groups/${editingCG.class_group_id}`, { class_teacher_id: cgForm.class_teacher_id || undefined });
        toast("Class group updated", { type: "success" });
      } else {
        await api.post("/structure/class-groups", {
          year_id: cgForm.year_id,
          grade_id: cgForm.grade_id,
          stream_id: cgForm.stream_id,
          class_teacher_id: cgForm.class_teacher_id || undefined,
        });
        toast("Class group created", { type: "success" });
      }
      setCgModalOpen(false);
      setEditingCG(null);
      setCgForm({ year_id: "", grade_id: "", stream_id: "", class_teacher_id: "" });
      const cgRes = await api.get("/structure/class-groups");
      setClassGroups(Array.isArray(cgRes.data) ? cgRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save", { type: "error" });
    } finally {
      setSavingCG(false);
    }
  };

  const handleDeleteCG = async (id: string) => {
    if (!confirm("Delete this class group? Enrolments or assignments will block deletion.")) return;
    try {
      await api.delete(`/structure/class-groups/${id}`);
      toast("Class group deleted", { type: "success" });
      const cgRes = await api.get("/structure/class-groups");
      setClassGroups(Array.isArray(cgRes.data) ? cgRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to delete", { type: "error" });
    }
  };

  // ---- Teaching Assignments ----
  const openCreateTA = () => { setEditingTA(null); setTaForm({ staff_membership_id: "", class_group_id: "", subject_id: "", academic_year_id: "" }); setTaModalOpen(true); };

  const handleSaveTA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taForm.staff_membership_id || !taForm.class_group_id || !taForm.subject_id || !taForm.academic_year_id) {
      toast("Fill all required fields", { type: "error" });
      return;
    }
    setSavingTA(true);
    try {
      await api.post("/structure/teaching-assignments", {
        staff_membership_id: taForm.staff_membership_id,
        class_group_id: taForm.class_group_id,
        subject_id: taForm.subject_id,
        academic_year_id: taForm.academic_year_id,
      });
      toast("Teaching assignment created", { type: "success" });
      setTaModalOpen(false);
      setEditingTA(null);
      setTaForm({ staff_membership_id: "", class_group_id: "", subject_id: "", academic_year_id: "" });
      const taRes = await api.get("/structure/teaching-assignments");
      setAssignments(Array.isArray(taRes.data) ? taRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create", { type: "error" });
    } finally {
      setSavingTA(false);
    }
  };

  const handleDeleteTA = async (id: string) => {
    if (!confirm("Delete this teaching assignment?")) return;
    try {
      await api.delete(`/structure/teaching-assignments/${id}`);
      toast("Assignment deleted", { type: "success" });
      const taRes = await api.get("/structure/teaching-assignments");
      setAssignments(Array.isArray(taRes.data) ? taRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to delete", { type: "error" });
    }
  };

  // ---- Rollover ----
  const handleRollover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rolloverFromYear || !rolloverToYear) { toast("Select both years", { type: "error" }); return; }
    if (rolloverFromYear === rolloverToYear) { toast("Years must differ", { type: "error" }); return; }
    setRollingOver(true);
    try {
      const res = await api.post("/structure/class-groups/rollover", {
        from_year_id: rolloverFromYear,
        to_year_id: rolloverToYear,
        grade_ids: rolloverGrades.length ? rolloverGrades : undefined,
      });
      toast(`Rolled over ${res.data.copied} class group(s)`, { type: "success" });
      setRolloverFromYear("");
      setRolloverToYear("");
      setRolloverGrades([]);
      const cgRes = await api.get("/structure/class-groups");
      setClassGroups(Array.isArray(cgRes.data) ? cgRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Rollover failed", { type: "error" });
    } finally {
      setRollingOver(false);
    }
  };

  const handleDryRun = async () => {
    if (!rolloverFromYear || !rolloverToYear) { toast("Select both years", { type: "error" }); return; }
    try {
      const res = await api.post("/structure/class-groups/rollover?dry_run=true", {
        from_year_id: rolloverFromYear,
        to_year_id: rolloverToYear,
        grade_ids: rolloverGrades.length ? rolloverGrades : undefined,
      });
      toast(`Dry run: ${res.data.count} class group(s) would be copied`, { type: "info" });
    } catch (err: any) {
      toast(err.response?.data?.message || "Dry run failed", { type: "error" });
    }
  };

  const currentYear = years.find(y => y.is_current) || years[0];

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">School Structure</h2>

          <div className="flex gap-2 mb-6 border-b border-gray-200" role="tablist">
            {[
              { id: "streams", label: "Streams" },
              { id: "classgroups", label: "Class Groups" },
              { id: "assignments", label: "Teaching Assignments" },
              { id: "rollover", label: "Year Rollover" },
            ].map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                  activeTab === tab.id
                    ? "border-kenyan-red text-kenyan-red"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "streams" && (
            <section>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Streams</h3>
                <button className="btn-primary" onClick={openCreateStream}>Add Stream</button>
              </div>
              {loading ? <Skeleton rows={5} columns={3} /> : (
                <DataTable
                  data={streams}
                  emptyMessage="No streams configured"
                  columns={[
                    { key: "stream_name", header: "Name" },
                    { key: "created_at", header: "Created", render: (r) => r.created_at ? new Date(r.created_at).toLocaleDateString() : "—" },
                    { key: "actions", header: "Actions", render: (r) => (
                      <div className="flex gap-2">
                        <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditStream(r)}>Edit</button>
                        <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDeleteStream(r.stream_id)}>Delete</button>
                      </div>
                    )},
                  ]}
                />
              )}
            </section>
          )}

          {activeTab === "classgroups" && (
            <section>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Class Groups</h3>
                <button className="btn-primary" onClick={openCreateCG}>Add Class Group</button>
              </div>
              {loading ? <Skeleton rows={5} columns={6} /> : (
                <DataTable
                  data={classGroups}
                  emptyMessage="No class groups configured"
                  columns={[
                    { key: "year_label", header: "Year" },
                    { key: "grade_label", header: "Grade" },
                    { key: "stream_name", header: "Stream" },
                    { key: "class_teacher_name", header: "Class Teacher", render: (r) => r.class_teacher_name || "—" },
                    { key: "learner_count", header: "Learners" },
                    { key: "actions", header: "Actions", render: (r) => (
                      <div className="flex gap-2">
                        <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditCG(r)}>Edit Teacher</button>
                        <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDeleteCG(r.class_group_id)}>Delete</button>
                      </div>
                    )},
                  ]}
                />
              )}
            </section>
          )}

          {activeTab === "assignments" && (
            <section>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Teaching Assignments</h3>
                <button className="btn-primary" onClick={openCreateTA}>Add Assignment</button>
              </div>
              {loading ? <Skeleton rows={5} columns={6} /> : (
                <DataTable
                  data={assignments}
                  emptyMessage="No teaching assignments"
                  columns={[
                    { key: "teacher_name", header: "Teacher" },
                    { key: "class_label", header: "Class" },
                    { key: "subject_name", header: "Subject", render: (r) => r.subject_name || r.subject_id },
                    { key: "academic_year_id", header: "Year" },
                    { key: "actions", header: "Actions", render: (r) => (
                      <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDeleteTA(r.assignment_id)}>Delete</button>
                    )},
                  ]}
                />
              )}
            </section>
          )}

          {activeTab === "rollover" && (
            <section>
              <h3 className="text-lg font-semibold mb-4">Year Rollover</h3>
              <p className="text-sm text-gray-600 mb-6">Copy class groups from one academic year to the next. Teachers are copied; learners must be re-enrolled.</p>
              <form onSubmit={handleRollover} className="max-w-md space-y-4">
                <div>
                  <label className="label">From Year *</label>
                  <select
                    className="input-field"
                    value={rolloverFromYear}
                    onChange={(e) => setRolloverFromYear(e.target.value)}
                    required
                  >
                    <option value="">Select source year…</option>
                    {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label} {y.is_current ? "(current)" : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">To Year *</label>
                  <select
                    className="input-field"
                    value={rolloverToYear}
                    onChange={(e) => setRolloverToYear(e.target.value)}
                    required
                  >
                    <option value="">Select target year…</option>
                    {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label} {y.is_current ? "(current)" : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Grades (optional)</label>
                  <select
                    className="input-field"
                    multiple
                    value={rolloverGrades}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                      setRolloverGrades(selected);
                    }}
                  >
                    {grades.map(g => <option key={g.grade_id} value={g.grade_id}>{g.grade_label}</option>)}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Leave empty to roll over all grades.</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" className="btn-secondary" onClick={handleDryRun} disabled={rollingOver}>Dry Run</button>
                  <button type="submit" className="btn-primary" disabled={rollingOver}>{rollingOver ? "Rolling Over…" : "Roll Over"}</button>
                </div>
              </form>
            </section>
          )}

          {/* Stream Modal */}
          <Dialog open={streamModalOpen} onClose={() => { setStreamModalOpen(false); setEditingStream(null); setStreamForm({ stream_name: "" }); }} title={editingStream ? "Edit Stream" : "Add Stream"} className="max-w-md">
            <form onSubmit={handleSaveStream}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Stream Name<HelpTip text="e.g. East, West, Red, Blue" /></span>
                <input
                  type="text"
                  required
                  value={streamForm.stream_name}
                  onChange={(e) => setStreamForm({ ...streamForm, stream_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setStreamModalOpen(false); setEditingStream(null); setStreamForm({ stream_name: "" }); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingStream}>{savingStream ? "Saving…" : editingStream ? "Update" : "Create"}</button>
              </div>
            </form>
          </Dialog>

          {/* Class Group Modal */}
          <Dialog open={cgModalOpen} onClose={() => { setCgModalOpen(false); setEditingCG(null); setCgForm({ year_id: "", grade_id: "", stream_id: "", class_teacher_id: "" }); }} title={editingCG ? "Edit Class Teacher" : "Add Class Group"} className="max-w-md">
            <form onSubmit={handleSaveCG}>
              {!editingCG && (
                <>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year *</span>
                    <select
                      required
                      value={cgForm.year_id}
                      onChange={(e) => setCgForm({ ...cgForm, year_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select year…</option>
                      {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label} {y.is_current ? "(current)" : ""}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Grade *</span>
                    <select
                      required
                      value={cgForm.grade_id}
                      onChange={(e) => setCgForm({ ...cgForm, grade_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select grade…</option>
                      {grades.map(g => <option key={g.grade_id} value={g.grade_id}>{g.grade_label}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Stream *</span>
                    <select
                      required
                      value={cgForm.stream_id}
                      onChange={(e) => setCgForm({ ...cgForm, stream_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select stream…</option>
                      {streams.map(s => <option key={s.stream_id} value={s.stream_id}>{s.stream_name}</option>)}
                    </select>
                  </label>
                </>
              )}
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Class Teacher (optional)</span>
                <select
                  value={cgForm.class_teacher_id}
                  onChange={(e) => setCgForm({ ...cgForm, class_teacher_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">No teacher assigned</option>
                  {staff.filter(s => s.role === "TEACHER" || s.role === "HEAD" || s.role === "DEPUTY").map(s => (
                    <option key={s.membership_id} value={s.membership_id}>{s.email || s.phone_number} ({s.role})</option>
                  ))}
                </select>
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setCgModalOpen(false); setEditingCG(null); setCgForm({ year_id: "", grade_id: "", stream_id: "", class_teacher_id: "" }); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingCG}>{savingCG ? "Saving…" : editingCG ? "Update" : "Create"}</button>
              </div>
            </form>
          </Dialog>

          {/* Teaching Assignment Modal */}
          <Dialog open={taModalOpen} onClose={() => { setTaModalOpen(false); setEditingTA(null); setTaForm({ staff_membership_id: "", class_group_id: "", subject_id: "", academic_year_id: "" }); }} title="Add Teaching Assignment" className="max-w-md">
            <form onSubmit={handleSaveTA}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Teacher *</span>
                <select
                  required
                  value={taForm.staff_membership_id}
                  onChange={(e) => setTaForm({ ...taForm, staff_membership_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select teacher…</option>
                  {staff.filter(s => s.role === "TEACHER" || s.role === "HEAD" || s.role === "DEPUTY").map(s => (
                    <option key={s.membership_id} value={s.membership_id}>{s.email || s.phone_number} ({s.role})</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Class Group *</span>
                <select
                  required
                  value={taForm.class_group_id}
                  onChange={(e) => setTaForm({ ...taForm, class_group_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select class…</option>
                  {classGroups.map(cg => <option key={cg.class_group_id} value={cg.class_group_id}>{cg.year_label} — {cg.grade_label} {cg.stream_name}</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Subject *</span>
                <select
                  required
                  value={taForm.subject_id}
                  onChange={(e) => setTaForm({ ...taForm, subject_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select subject…</option>
                  {subjects.map(s => <option key={s.area_id} value={s.area_id}>{s.name} ({s.code})</option>)}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year *</span>
                <select
                  required
                  value={taForm.academic_year_id}
                  onChange={(e) => setTaForm({ ...taForm, academic_year_id: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                >
                  <option value="">Select year…</option>
                  {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label} {y.is_current ? "(current)" : ""}</option>)}
                </select>
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setTaModalOpen(false); setEditingTA(null); setTaForm({ staff_membership_id: "", class_group_id: "", subject_id: "", academic_year_id: "" }); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingTA}>{savingTA ? "Creating…" : "Create"}</button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}