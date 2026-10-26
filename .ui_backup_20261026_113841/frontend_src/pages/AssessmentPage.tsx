import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

const GRADES = ["PP1", "PP2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];

export default function AssessmentPage() {
  const [eventModal, setEventModal] = useState(false);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [eventForm, setEventForm] = useState({ title: "", grade_label: "Grade 4", learning_area_id: "", assessment_type: "FORMATIVE", scoring_mode: "RUBRIC", assessment_window: "" });
  const [creating, setCreating] = useState(false);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/assessment/events", {
        title: eventForm.title || undefined,
        grade_label: eventForm.grade_label,
        learning_area_id: eventForm.learning_area_id,
        learning_area: areas.find((a) => a.id === eventForm.learning_area_id)?.name,
        assessment_type: eventForm.assessment_type,
        scoring_mode: eventForm.scoring_mode,
        assessment_window: eventForm.assessment_window || undefined,
        status: "OPEN",
      });
      toast("Assessment event created — schedule below", { type: "success" });
      setEventModal(false);
      setEventForm({ title: "", grade_label: "Grade 4", learning_area_id: "", assessment_type: "FORMATIVE", scoring_mode: "RUBRIC", assessment_window: "" });
      api.get("/assessment/events").then((r) => setEvents(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create event", { type: "error" });
    } finally {
      setCreating(false);
    }
  };

  const [events, setEvents] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      api.get("/assessment/events"),
      api.get("/assessment/results"),
      api.get("/curriculum/areas"),
      api.get("/learners"),
    ]).then(([eRes, rRes, aRes, lRes]) => {
      setEvents(Array.isArray(eRes.data) ? eRes.data : []);
      setResults(Array.isArray(rRes.data) ? rRes.data : []);
      setAreas(Array.isArray(aRes.data) ? aRes.data.map((a: any) => ({ id: a.area_id, name: a.name })) : []);
      const lr: any[] = Array.isArray(lRes.data) ? lRes.data : [];
      setLearners(lr.map((l) => ({
        id: l.learner_id,
        label: `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id,
      })));
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || id || "—";

  const fmtDate = (d: any) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Assessment</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setEventModal(true)}>
              New Assessment Event
            </button>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <div className="space-y-6">
              <DataTable
                data={events}
                emptyMessage="No assessment events found"
                columns={[
                  { key: "grade_id", header: "Grade" },
                  { key: "learning_area_id", header: "Learning Area" },
                  { key: "assessment_type", header: "Type" },
                  { key: "scoring_mode", header: "Mode" },
                  { key: "assessment_window", header: "Window", render: (r) => r.assessment_window || "—" },
                  { key: "status", header: "Status" },
                ]}
              />
              <DataTable
                data={results}
                emptyMessage="No assessment results found"
                columns={[
                  { key: "learner_id", header: "Learner", render: (r) => learnerName(r.learner_id) },
                  { key: "learning_area_id", header: "Area" },
                  { key: "raw_score", header: "Score" },
                  { key: "assigned_grade", header: "Grade" },
                  { key: "assessment_date", header: "Date", render: (r) => fmtDate(r.assessment_date) },
                ]}
              />
            </div>
          )}
          {eventModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setEventModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>New Assessment Event</h3>
                <form onSubmit={handleCreateEvent}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Title (optional)</span>
                    <input
                      type="text"
                      value={eventForm.title}
                      onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                      placeholder="e.g. Opener Term 2"
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Grade</span>
                    <select
                      value={eventForm.grade_label}
                      onChange={(e) => setEventForm({ ...eventForm, grade_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learning Area</span>
                    <select
                      required
                      value={eventForm.learning_area_id}
                      onChange={(e) => setEventForm({ ...eventForm, learning_area_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select area…</option>
                      {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Type</span>
                      <select
                        value={eventForm.assessment_type}
                        onChange={(e) => setEventForm({ ...eventForm, assessment_type: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      >
                        <option>FORMATIVE</option>
                        <option>SUMMATIVE</option>
                      </select>
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Mode</span>
                      <select
                        value={eventForm.scoring_mode}
                        onChange={(e) => setEventForm({ ...eventForm, scoring_mode: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      >
                        <option>RUBRIC</option>
                        <option>NUMERIC</option>
                      </select>
                    </label>
                  </div>
                  <label style={{ display: "block", margin: "0.75rem 0" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Window (optional)</span>
                    <input
                      type="date"
                      value={eventForm.assessment_window}
                      onChange={(e) => setEventForm({ ...eventForm, assessment_window: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setEventModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={creating}>
                      {creating ? "Creating…" : "Create Event"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
