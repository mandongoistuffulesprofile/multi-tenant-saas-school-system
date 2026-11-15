import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";
import { useAuthStore } from "../lib/authStore";
import { SCHOOL_ADMIN_ROLES } from "../lib/roles";

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
  const { t } = useTranslation();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [windows, setWindows] = useState<ExamWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"year" | "term" | "window" | null>(null);
  const { toast } = useToast();
  const { roles } = useAuthStore();
  // Clerks can read the calendar, but every create endpoint is restricted to
  // school administrators.
  const canManageCalendar = roles.some((r) => SCHOOL_ADMIN_ROLES.includes(r as any));

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
      toast(err.response?.data?.message || t("calendar_page.load_failed"), { type: "error" });
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
      toast(t("calendar_page.added_year"), { type: "success" });
      setYearModal(false);
      setYearForm({ year_label: "", start_date: "", end_date: "", is_current: false });
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || t("calendar_page.add_year_failed"), { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  const openTermModal = () => {
    if (years.length === 0) {
      toast(t("calendar_page.need_year_first"), { type: "error" });
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
      toast(t("calendar_page.select_year_error"), { type: "error" });
      return;
    }
    const termNumber =
      Math.max(0, ...terms.filter((t) => t.year_id === termForm.year_id).map((t) => t.term_number)) + 1;
    setSaving("term");
    try {
      await api.post("/calendar/terms", { ...termForm, term_number: termNumber });
      toast(t("calendar_page.added_term"), { type: "success" });
      setTermModal(false);
      setTermForm(emptyTerm());
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || t("calendar_page.add_term_failed"), { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  const handleAddWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving("window");
    try {
      await api.post("/calendar/exam-windows", windowForm);
      toast(t("calendar_page.added_window"), { type: "success" });
      setWindowModal(false);
      setWindowForm({ exam_type: "END_TERM", window_label: "", start_date: "", end_date: "" });
      await loadCalendar();
    } catch (err: any) {
      toast(err.response?.data?.message || t("calendar_page.add_window_failed"), { type: "error" });
    } finally {
      setSaving(null);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="text-heading">{t("calendar_page.title")}</h2>
            {canManageCalendar && (
              <div className="flex flex-wrap gap-2">
                <button className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition" onClick={() => setYearModal(true)}>
                  {t("calendar_page.add_year")}
                </button>
                <button className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 transition" onClick={() => setWindowModal(true)}>
                  {t("calendar_page.add_exam_window")}
                </button>
                <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={openTermModal}>
                  {t("calendar_page.add_term")}
                </button>
              </div>
            )}
          </div>
          {loading ? (
            <Skeleton rows={5} columns={4} />
          ) : (
            <div className="space-y-6">
              <DataTable
                data={years}
                emptyMessage={t("calendar_page.empty_years")}
                columns={[
                  { key: "year_label", header: t("calendar_page.year") },
                  { key: "start_date", header: t("calendar_page.starts"), render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: t("calendar_page.ends"), render: (r) => formatDate(r.end_date) },
                  { key: "is_current", header: t("calendar_page.status"), render: (r) => (r.is_current ? t("calendar_page.current") : "—") },
                ]}
              />
              <DataTable
                data={terms}
                emptyMessage={t("calendar_page.empty_terms")}
                columns={[
                  { key: "term_label", header: t("calendar_page.term") },
                  { key: "term_number", header: t("calendar_page.no") },
                  { key: "start_date", header: t("calendar_page.starts"), render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: t("calendar_page.ends"), render: (r) => formatDate(r.end_date) },
                  { key: "is_current", header: t("calendar_page.status"), render: (r) => (r.is_current ? t("calendar_page.current") : "—") },
                ]}
              />
              <DataTable
                data={windows}
                emptyMessage={t("calendar_page.empty_windows")}
                columns={[
                  { key: "window_label", header: t("calendar_page.window") },
                  { key: "exam_type", header: t("calendar_page.exam") },
                  { key: "start_date", header: t("calendar_page.starts"), render: (r) => formatDate(r.start_date) },
                  { key: "end_date", header: t("calendar_page.ends"), render: (r) => formatDate(r.end_date) },
                ]}
              />
            </div>
          )}

          {yearModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setYearModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{t("calendar_page.add_year")}</h3>
                <form onSubmit={handleAddYear}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.year_label")}</span>
                    <input
                      type="text"
                      required
                      placeholder={t("calendar_page.year_placeholder")}
                      value={yearForm.year_label}
                      onChange={(e) => setYearForm({ ...yearForm, year_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.start_date")}</span>
                      <input
                        type="date"
                        required
                        value={yearForm.start_date}
                        onChange={(e) => setYearForm({ ...yearForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.end_date")}</span>
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
                    <span style={{ fontSize: "0.85rem" }}>{t("calendar_page.make_current_year")}</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setYearModal(false)} style={{ padding: "0.5rem 1rem" }}>{t("calendar_page.cancel")}</button>
                    <button type="submit" className="btn-primary" disabled={saving === "year"}>
                      {saving === "year" ? t("calendar_page.adding") : t("calendar_page.add_year_submit")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {termModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setTermModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{t("calendar_page.add_term")}</h3>
                <form onSubmit={handleAddTerm}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.academic_year")}</span>
                    <select
                      required
                      value={termForm.year_id}
                      onChange={(e) => setTermForm({ ...termForm, year_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">{t("calendar_page.select_year")}</option>
                      {years.map((y) => (
                        <option key={y.year_id} value={y.year_id}>{y.year_label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.term_name")}</span>
                    <input
                      type="text"
                      required
                      placeholder={t("calendar_page.term_placeholder")}
                      value={termForm.term_label}
                      onChange={(e) => setTermForm({ ...termForm, term_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.start_date")}</span>
                      <input
                        type="date"
                        required
                        value={termForm.start_date}
                        onChange={(e) => setTermForm({ ...termForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.end_date")}</span>
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
                    <span style={{ fontSize: "0.85rem" }}>{t("calendar_page.make_current_term")}</span>
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                    <button type="button" onClick={() => setTermModal(false)} style={{ padding: "0.5rem 1rem" }}>{t("calendar_page.cancel")}</button>
                    <button type="submit" className="btn-primary" disabled={saving === "term"}>
                      {saving === "term" ? t("calendar_page.adding") : t("calendar_page.add_term_submit")}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {windowModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setWindowModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "24rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>{t("calendar_page.add_exam_window")}</h3>
                <form onSubmit={handleAddWindow}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.exam_type")}</span>
                    <select
                      required
                      value={windowForm.exam_type}
                      onChange={(e) => setWindowForm({ ...windowForm, exam_type: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="END_TERM">{t("calendar_page.exam_end_term")}</option>
                      <option value="MID_TERM">{t("calendar_page.exam_mid_term")}</option>
                      <option value="KPSEA">KPSEA</option>
                      <option value="KJSEA">KJSEA</option>
                      <option value="MOCK">{t("calendar_page.exam_mock")}</option>
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.window_label")}</span>
                    <input
                      type="text"
                      required
                      placeholder={t("calendar_page.window_placeholder")}
                      value={windowForm.window_label}
                      onChange={(e) => setWindowForm({ ...windowForm, window_label: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.start_date")}</span>
                      <input
                        type="date"
                        required
                        value={windowForm.start_date}
                        onChange={(e) => setWindowForm({ ...windowForm, start_date: e.target.value })}
                        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                      />
                    </label>
                    <label style={{ display: "block", marginBottom: "0.75rem" }}>
                      <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("calendar_page.end_date")}</span>
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
                    <button type="button" onClick={() => setWindowModal(false)} style={{ padding: "0.5rem 1rem" }}>{t("calendar_page.cancel")}</button>
                    <button type="submit" className="btn-primary" disabled={saving === "window"}>
                      {saving === "window" ? t("calendar_page.adding") : t("calendar_page.add_window_submit")}
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
