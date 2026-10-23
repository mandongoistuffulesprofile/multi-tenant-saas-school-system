import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";

export default function AssessmentPage() {
  const handleBatchSubmit = async (eventId: string, learnerId: string, rubricLevel: string, score: number) => {
    try {
      await api.post("/assessment/results/batch", {
        assessment_event_id: eventId,
        results: [{ learner_id: learnerId, rubric_level: rubricLevel, raw_score: score }]
      });
      alert("CBC score recorded!");
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to save assessment mark");
    }
  };

  const [events, setEvents] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    Promise.all([
      api.get("/assessment/events"),
      api.get("/assessment/results"),
    ]).then(([eRes, rRes]) => {
      setEvents(eRes.data || []);
      setResults(rRes.data || []);
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-heading mb-6">Assessment</h2>
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
                  { key: "assessment_window", header: "Window" },
                  { key: "status", header: "Status" },
                ]}
              />
              <DataTable
                data={results}
                emptyMessage="No assessment results found"
                columns={[
                  { key: "learner_id", header: "Learner" },
                  { key: "learning_area_id", header: "Learning Area" },
                  { key: "raw_score", header: "Score" },
                  { key: "assigned_grade", header: "Grade" },
                  { key: "assessment_date", header: "Date" },
                ]}
              />
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}