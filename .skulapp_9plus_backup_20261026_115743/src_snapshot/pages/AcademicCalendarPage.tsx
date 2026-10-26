import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function AcademicCalendarPage() {
  const handleAddTerm = async (yearId: string, name: string, starts: string, ends: string) => {
    setAdding(true);
    try {
      await api.post("/calendar/terms", { academic_year_id: yearId || undefined, term_name: name });
      toast("Term added to calendar!", { type: "success" });
      setTermModal(false);
      setTermForm({ year_id: "", term_name: "" });
      api.get("/calendar/terms").then((r) => setTerms(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to add term", { type: "error" });
    } finally {
      setAdding(false);
    }
  };

  const [termModal, setTermModal] = useState(false);
  const [termForm, setTermForm] = useState({ year_id: "", term_name: "" });
  const [adding, setAdding] = useState(false);

  const [years, setYears] = useState<any[]>([]);
  const [terms, setTerms] = useState<any[]>([]);
  const [windows, setWindows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

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
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Academic Calendar</h2>
            <button className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition" onClick={() => setTermModal(true)}>
              Add Term
            </button>
          </div>
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
          {termModal && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setTermModal(false)}>
              <div style={{ background: "#fff", borderRadius: 8, padding: "1.5rem", width: "22rem", maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-heading" style={{ marginBottom: "1rem" }}>Add Term</h3>
                <form onSubmit={(e) => { e.preventDefault(); handleAddTerm(termForm.year_id, termForm.term_name, "", ""); }}>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Academic Year</span>
                    <select
                      value={termForm.year_id}
                      onChange={(e) => setTermForm({ ...termForm, year_id: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    >
                      <option value="">Latest year (default)</option>
                      {years.map((y) => (
                        <option key={y.year_id || y.id} value={y.year_id || y.id}>{y.year_label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.75rem" }}>
                    <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Term Name</span>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Term 2"
                      value={termForm.term_name}
                      onChange={(e) => setTermForm({ ...termForm, term_name: e.target.value })}
                      style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
                    <button type="button" onClick={() => setTermModal(false)} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                    <button type="submit" className="btn-primary" disabled={adding}>
                      {adding ? "Adding…" : "Add Term"}
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
