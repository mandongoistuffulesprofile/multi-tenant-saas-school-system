import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type Grade = { grade_id: string; grade_label: string; level_band: string; lessons_per_week: number };
type Term = { term_id: string; year_id: string; term_number: number; term_label: string; start_date: string; end_date: string; is_current: boolean };
type Year = { year_id: string; year_label: string; is_current: boolean };

export default function AssessmentPage() {
  const [eventModal, setEventModal] = useState(false);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [eventForm, setEventForm] = useState({
    term_id: "",
    grade_id: "",
    learning_area_id: "",
    assessment_type: "FORMATIVE",
    scoring_mode: "RUBRIC",
    assessment_window: "",
    weighting_profile_id: "",
    max_score: 0,
  });
  const [creating, setCreating] = useState(false);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/assessment/events", {
        term_id: eventForm.term_id,
        grade_id: eventForm.grade_id,
        learning_area_id: eventForm.learning_area_id,
        assessment_type: eventForm.assessment_type,
        scoring_mode: eventForm.scoring_mode,
        assessment_window: eventForm.assessment_window,
        weighting_profile_id: eventForm.weighting_profile_id || undefined,
        max_score: eventForm.max_score || undefined,
      });
      toast("Assessment event created — schedule below", { type: "success" });
      setEventModal(false);
      setEventForm({ term_id: "", grade_id: "", learning_area_id: "", assessment_type: "FORMATIVE", scoring_mode: "RUBRIC", assessment_window: "", weighting_profile_id: "", max_score: 0 });
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
      api.get("/structure/grades"),
      api.get("/calendar/years"),
    ]).then(([eRes, rRes, aRes, lRes, gRes, yRes]) => {
      setEvents(Array.isArray(eRes.data) ? eRes.data : []);
      setResults(Array.isArray(rRes.data) ? rRes.data : []);
      setAreas(Array.isArray(aRes.data) ? aRes.data.map((a: any) => ({ id: a.area_id, name: a.name })) : []);
      setGrades(Array.isArray(gRes.data) ? gRes.data : []);
      setYears(Array.isArray(yRes.data) ? yRes.data : []);
      const lr: any[] = Array.isArray(lRes.data) ? lRes.data : [];
      setLearners(lr.map((l) => ({
        id: l.learner_id,
        label: `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id,
      })));
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (years.length === 0) return;
    const currentYear = years.find((y) => y.is_current) || years[0];
    api.get(`/calendar/terms?year_id=${currentYear.year_id}`).then((res) => {
      setTerms(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, [years]);

  useEffect(() => {
    if (terms.length === 0) return;
    const currentTerm = terms.find((t) => t.is_current) || terms[0];
    setEventForm((prev) => ({ ...prev, term_id: currentTerm.term_id }));
  }, [terms]);

  const learnerName = (id: string) => learners.find((l) => l.id === id)?.label || id || "—";

  const fmtDate = (d: any) => {
    if (!d) return "—";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  };

  const gradeLabel = (gradeId: string) => grades.find((g) => g.grade_id === gradeId)?.grade_label || gradeId;
  const termLabel = (termId: string) => terms.find((t) => t.term_id === termId)?.term_label || termId;
  const areaName = (areaId: string) => areas.find((a) => a.id === areaId)?.name || areaId;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Assessment</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setEventModal(true)}>
              New Assessment Event
            </button>
          </div>
          <div className="mb-4 -mt-3">
            <a href="/teacher/grading" className="text-sm font-medium text-kenyan-red hover:underline">
              Enter marks in the rubric grid →
            </a>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={6} />
          ) : (
            <div className="space-y-6">
              <DataTable
                data={events}
                emptyMessage="No assessment events found"
                columns={[
                  { key: "grade_id", header: "Grade", render: (r) => gradeLabel(r.grade_id) },
                  { key: "learning_area_id", header: "Learning Area", render: (r) => areaName(r.learning_area_id) },
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
                  { key: "learning_area_id", header: "Area", render: (r) => areaName(r.learning_area_id) },
                  { key: "raw_score", header: "Score" },
                  { key: "assigned_grade", header: "Grade" },
                  { key: "assessment_date", header: "Date", render: (r) => fmtDate(r.assessment_date) },
                ]}
              />
            </div>
          )}
          {eventModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setEventModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "28rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>New Assessment Event</h3>
                <form onSubmit={handleCreateEvent}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Term *</span>
                    <select
                      required
                      value={eventForm.term_id}
                      onChange={(e) => setEventForm({ ...eventForm, term_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select term…</option>
                      {terms.map((t) => <option key={t.term_id} value={t.term_id}>{t.term_label} ({t.start_date} to {t.end_date})</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Grade *</span>
                    <select
                      required
                      value={eventForm.grade_id}
                      onChange={(e) => setEventForm({ ...eventForm, grade_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select grade…</option>
                      {grades.map((g) => <option key={g.grade_id} value={g.grade_id}>{g.grade_label}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Learning Area *</span>
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
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Type *</span>
                      <select
                        required
                        value={eventForm.assessment_type}
                        onChange={(e) => setEventForm({ ...eventForm, assessment_type: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      >
                        <option value="FORMATIVE">Formative</option>
                        <option value="SUMMATIVE">Summative</option>
                      </select>
                    </label>
                    <label style={{ display: "block" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Mode *</span>
                      <select
                        required
                        value={eventForm.scoring_mode}
                        onChange={(e) => setEventForm({ ...eventForm, scoring_mode: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      >
                        <option value="RUBRIC">Rubric</option>
                        <option value="NUMERIC">Numeric</option>
                      </select>
                    </label>
                  </div>
                  <label style={{ display: "block", margin: "0.75rem 0" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Assessment Window *</span>
                    <input
                      type="date"
                      required
                      value={eventForm.assessment_window}
                      onChange={(e) => setEventForm({ ...eventForm, assessment_window: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Weighting Profile (optional)</span>
                    <input
                      type="text"
                      value={eventForm.weighting_profile_id}
                      onChange={(e) => setEventForm({ ...eventForm, weighting_profile_id: e.target.value })}
                      placeholder="Weighting profile UUID"
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Max Score (optional)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={eventForm.max_score}
                      onChange={(e) => setEventForm({ ...eventForm, max_score: parseFloat(e.target.value) || 0 })}
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