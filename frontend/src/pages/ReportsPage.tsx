import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);
  const handleGenerateRun = async (termId?: string) => {
    setGenerating(true);
    try {
      await api.post("/reports/runs", { term_id: termId || "current", template_id: "standard_cbc" });
      toast("Report cards generation initiated!", { type: "success" });
      // Reload reports
      api.get("/reports/cards").then((r) => setCards(Array.isArray(r.data) ? r.data : []));
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to generate report run", { type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([
      api.get("/reports/templates"),
      api.get("/reports/runs"),
      api.get("/reports/cards"),
    ]).then(([tRes, rRes, cRes]) => {
      setTemplates(tRes.data || []);
      setRuns(rRes.data || []);
      setCards(cRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-heading">Reports</h2>
        <button
          className="px-4 py-2 rounded-lg bg-kenyan-red text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          onClick={() => handleGenerateRun()}
          disabled={generating}
        >
          {generating ? "Generating…" : "Generate Report Cards"}
        </button>
      </div>
          {loading ? (
            <Skeleton rows={5} columns={5} />
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
              <DataTable
                data={cards}
                emptyMessage="No report cards found"
                columns={[
                  { key: "card_number", header: "Card No." },
                  { key: "learner_id", header: "Learner", render: (r) => r.learner_name || r.learner_id },
                  { key: "grade_id", header: "Grade" },
                  { key: "status", header: "Status" },
                  { key: "percentage", header: "Percentage", render: (r) => r.percentage != null ? `${r.percentage}%` : "—" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}