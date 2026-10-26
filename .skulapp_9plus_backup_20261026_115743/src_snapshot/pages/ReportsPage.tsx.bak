import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function ReportsPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

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
          <h2 className="text-heading mb-6">Reports</h2>
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
                  { key: "learner_id", header: "Learner" },
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