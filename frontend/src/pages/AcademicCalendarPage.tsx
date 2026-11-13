import { useState, useEffect } from "react";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type AcademicYear = {
  year_id: string;
  year_label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type Term = {
  term_id: string;
  year_id: string;
  term_number: number;
  term_label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
};

type ExamWindow = {
  window_id: string;
  exam_type: string;
  window_label: string;
  start_date: string;
  end_date: string;
};

const emptyTerm = (yearID = "") => ({
  year_id: yearID,
  term_label: "",
  start_date: "",
  end_date: "",
  is_current: false,
});

const formatDate = (value?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};

export default function AcademicCalendarPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [windows, setWindows] = useState<ExamWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"year" | "term" | "window" | null>(null);
  const { toast } = useToast();

  const [yearModal, setYearModal] = useState(false);
  const [yearForm, setYearForm] = useState({
    year_label: "",
    start_date: "",
    end_date: "",
    is_current: false,
  });

  const [termModal, setTermModal] = useState(false);
  const [termForm, setTermForm] = useState(emptyTerm());

  const [windowModal, setWindowModal] = useState(false);
  const [windowForm, setWindowForm] = useState({
    exam_type: "END_TERM",
    window_label: "",
    start_date: "",
    end_date: "",
  });

  const loadCalendar = async () => {
    try {
      const [yRes, tRes, wRes] = await Promise.all([
        api.get("/calendar/years"),
        api.get("/calendar/terms"),
        api.get("/calendar/exam-windows"),
      ]);
      setYears(Array.isArray(yRes.data) ? yRes.data : []);
      setTerms(Array.isArray(tRes.data) ? tRes.data : []);
      setWindows(Array.isArray(wRes.data) ? wRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to load the academic calendar", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddYear = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("year");
    try {
      await api.post("/calendar/years", yearForm);
      toast("Academic year added!", { type: "success" });
      setYearModal(false);
      setYearForm({ year_label: "", start_date: "", end_date: "", is_current: false });
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to add academic year", { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  const openTermModal = () => {
    if (years.length === 0) {
      toast("Add an academic year before adding a term", { type: "error" });
      setYearModal(true);
      return;
    }
    const year = years.find((y) => y.is_current) ?? years[0];
    setTermForm(emptyTerm(year.year_id));
    setTermModal(true);
  };

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termForm.year_id) {
      toast("Select the academic year this term belongs to", { type: "error" });
      return;
    }
    const termNumber =
      Math.max(0, ...terms.filter((t) => t.year_id === termForm.year_id).map((t) => t.term_number)) + 1;
    setSaving("term");
    try {
      await api.post("/calendar/terms", { ...termForm, term_number: termNumber });
      toast("Term added to calendar!", { type: "success" });
      setTermModal(false);
      setTermForm(emptyTerm());
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to add term", { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  const handleAddWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("window");
    try {
      await api.post("/calendar/exam-windows", windowForm);
      toast("Exam window added!", { type: "success" });
      setWindowModal(false);
      setWindowForm({ exam_type: "END_TERM", window_label: "", start_date: "", end_date: "" });
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to add exam window", { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="text-heading">Academic Calendar</h2>
            <div className="flex flex-wrap gap-2">
              <button className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition" onClick={() => setYearModal(true)}>
                Add Academic Year
              </button>
              <button className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition" onClick={() => setWindowModal(true)}>
                Add Exam Window
              </button>
              <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openTermModal}>
                Add Term
              </button>
            </div>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <div className="space-y-6">
              <DataTable
                data={years}
                emptyMessage="No academic years found — add one to start the calendar"
                columns={[
                  { key: "year_label", header: "Year" },
                  { key: "start_date", header: "Starts", render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: "Ends", render: (r) => formatDate(r.end_date) },
                  { key: "is_current", header: "Status", render: (r) => (r.is_current ? "Current" : "—") },
                ]}
              />
              <DataTable
                data={terms}
                emptyMessage="No terms found"
                columns={[
                  { key: "term_label", header: "Term" },
                  { key: "term_number", header: "No." },
                  { key: "start_date", header: "Starts", render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: "Ends", render: (r) => formatDate(r.end_date) },
                  { key: "is_current", header: "Status", render: (r) => (r.is_current ? "Current" : "—") },
                ]}
              />
              <DataTable
                data={windows}
                emptyMessage="No exam windows found"
                columns={[
                  { key: "window_label", header: "Window" },
                  { key: "exam_type", header: "Exam" },
                  { key: "start_date", header: "Starts", render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: "Ends", render: (r) => formatDate(r.end_date) },
                ]}
              />
            </div>
          )}

          {yearModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setYearModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add Academic Year</h3>
                <form onSubmit={handleAddYear}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Year Label *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 2027"
                      value={yearForm.year_label}
                      onChange={(e) => setYearForm({ ...yearForm, year_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Start Date *</span>
                      <input
                        type="date"
                        required
                        value={yearForm.start_date}
                        onChange={(e) => setYearForm({ ...yearForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>End Date *</span>
                      <input
                        type="date"
                        required
                        value={yearForm.end_date}
                        onChange={(e) => setYearForm({ ...yearForm, end_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <input
                      type="checkbox"
                      checked={yearForm.is_current}
                      onChange={(e) => setYearForm({ ...yearForm, is_current: e.target.checked })}
                    />
                    <span style={{ fontSize: "0.85rem" }}>Make this the current academic year</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setYearModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving === "year"}>
                      {saving === "year" ? "Adding…" : "Add Year"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {termModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setTermModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add Term</h3>
                <form onSubmit={handleAddTerm}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year *</span>
                    <select
                      required
                      value={termForm.year_id}
                      onChange={(e) => setTermForm({ ...termForm, year_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Select year…</option>
                      {years.map((y) => (
                        <option key={y.year_id} value={y.year_id}>{y.year_label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Term Name *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Term 2"
                      value={termForm.term_label}
                      onChange={(e) => setTermForm({ ...termForm, term_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Start Date *</span>
                      <input
                        type="date"
                        required
                        value={termForm.start_date}
                        onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>End Date *</span>
                      <input
                        type="date"
                        required
                        value={termForm.end_date}
                        onChange={(e) => setTermForm({ ...termForm, end_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                    <input
                      type="checkbox"
                      checked={termForm.is_current}
                      onChange={(e) => setTermForm({ ...termForm, is_current: e.target.checked })}
                    />
                    <span style={{ fontSize: "0.85rem" }}>Make this the current term</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setTermModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving === "term"}>
                      {saving === "term" ? "Adding…" : "Add Term"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {windowModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setWindowModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add Exam Window</h3>
                <form onSubmit={handleAddWindow}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Exam Type *</span>
                    <select
                      required
                      value={windowForm.exam_type}
                      onChange={(e) => setWindowForm({ ...windowForm, exam_type: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="END_TERM">End of Term</option>
                      <option value="MID_TERM">Mid Term</option>
                      <option value="KPSEA">KPSEA</option>
                      <option value="KJSEA">KJSEA</option>
                      <option value="MOCK">Mock</option>
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Window Label *</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Term 2 End of Term"
                      value={windowForm.window_label}
                      onChange={(e) => setWindowForm({ ...windowForm, window_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Start Date *</span>
                      <input
                        type="date"
                        required
                        value={windowForm.start_date}
                        onChange={(e) => setWindowForm({ ...windowForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>End Date *</span>
                      <input
                        type="date"
                        required
                        value={windowForm.end_date}
                        onChange={(e) => setWindowForm({ ...windowForm, end_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setWindowModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={saving === "window"}>
                      {saving === "window" ? "Adding…" : "Add Window"}
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
