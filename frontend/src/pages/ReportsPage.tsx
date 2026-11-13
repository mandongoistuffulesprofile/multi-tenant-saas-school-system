import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingRunId, setPublishingRunId] = useState("");
  const { t } = useTranslation();
  const { toast } = useToast();

  const handleGenerateRun = async (termId?: string) => {
    const template = templates.find((tpl: any) => tpl.is_default) ?? templates[0];
    if (!template) {
      toast("No report template is configured for this school.", { type: "error" });
      return;
    }

    // The backend accepts term_id and template_id, with optional academic_year_id
    // and grade_id. We omit academic_year_id and grade_id here so the server
    // resolves the current (or latest) academic year and generates for every
    // grade. That is the default opening-day workflow: pick the default template
    // and generate cards for the current term.
    const payload: any = {
      term_id: termId || "current",
      template_id: template.template_id,
    };

    setGenerating(true);
    try {
      await api.post("/reports/runs", payload);
      toast("Report cards generation initiated!", { type: "success" });
      // Reload runs and cards after the run is queued. Fetch runs first so
      // the recent run appears before the cards gallery; if cards fails, the
      // run list still refreshes.
      const rRes = await api.get("/reports/runs");
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);

      try {
        const cRes = await api.get("/reports/cards");
        setCards(Array.isArray(cRes.data) ? cRes.data : []);
      } catch {
        // cards can lag behind the run on slow connections; leave existing cards
      }
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to generate report run", { type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get("/reports/templates"),
      api.get("/reports/runs"),
      api.get("/reports/cards"),
    ]).then(([tRes, rRes, cRes]) => {
      setTemplates(tRes.data || []);
      setRuns(rRes.data || []);
      setCards(cRes.data || []);
    }).catch(() => {
      setLoadError(true);
    }).finally(() => setLoading(false));
  }, []);

  const [loadError, setLoadError] = useState(false);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Reports</h2>
            <div className="flex items-center gap-3">
              {templates.length === 0 && !loading && !loadError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No report template is configured for this school, so report cards cannot be generated.
                </div>
              ) : null}
              <button
                className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                onClick={() => handleGenerateRun()}
                disabled={generating || templates.length === 0 || loadError}
              >
                {generating ? "Generating…" : templates.length === 0 ? "No template configured" : "Generate Report Cards"}
              </button>
            </div>
          </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 mb-6">
              <p className="text-sm text-red-700">
                Could not load report templates, runs or cards.
              </p>
              <button
                className="mt-3 text-sm font-medium text-kenyan-red hover:underline"
                onClick={() => { setLoadError(false); setLoading(true); }}
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Templates</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{templates.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Runs</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{runs.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Report Cards</h3>
                  <p className="text-3xl font-bold text-gray-900">{cards.length}</p>
                </div>
              </div>

              <div className="card p-6 mb-6">
                <h3 className="text-caption uppercase tracking-wide mb-3">Report Runs</h3>
                {runs.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No runs yet — generate cards for the current term above.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-2">Run</th>
                        <th className="pb-2">Term</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run: any) => (
                        <tr key={run.run_id || run.id} className="border-t border-gray-100">
                          <td className="py-2 font-mono text-xs">{String(run.run_id || run.id).slice(0, 8)}</td>
                          <td className="py-2">{run.term_id || run.academic_year_id || "—"}</td>
                          <td className="py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                run.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {run.status || "PENDING"}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            {run.status === "PUBLISHED" ? (
                              <span className="text-xs text-gray-400">Published</span>
                            ) : (
                              <button
                                className="px-3 py-1 rounded-lg bg-kenyan-red text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                                disabled={publishingRunId !== ""}
                                onClick={async () => {
                                  const id = run.run_id || run.id;
                                  setPublishingRunId(id);
                                  try {
                                    const res = await api.post(`/reports/runs/${id}/publish`);
                                    toast(`Published ${res.data?.published ?? 0} report card(s)`, { type: "success" });
                                    const [rRes, cRes] = await Promise.all([
                                      api.get("/reports/runs"),
                                      api.get("/reports/cards"),
                                    ]);
                                    setRuns(Array.isArray(rRes.data) ? rRes.data : []);
                                    setCards(Array.isArray(cRes.data) ? cRes.data : []);
                                  } catch (err: any) {
                                    toast(err.response?.data?.message || "Failed to publish run", { type: "error" });
                                  } finally {
                                    setPublishingRunId("");
                                  }
                                }}
                              >
                                {publishingRunId === (run.run_id || run.id) ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <DataTable
                data={cards}
                emptyMessage="No report cards found"
                columns={[
                  { key: "card_number", header: "Card No." },
                  { key: "learner_id", header: "Learner", render: (r) => r.learner_name || r.learner_id },
                  { key: "grade_id", header: "Grade" },
                  { key: "status", header: "Status" },
                  { key: "percentage", header: "Percentage", render: (r) => r.percentage != null ? `${r.percentage}%` : "—" },
                  { key: "action", header: "Action", sortable: false, render: (r) => (
                    r.card_id ? <a href={`/reports/cards/${r.card_id}/print`} className="text-kenyan-red underline text-sm">View / Print</a> : "—"
                  ) },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}