import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { saveAssessmentResult, getAssessmentResults, DEVICE_ID } from "../../lib/offline";
import { Learner, AssessmentResult, LevelCode } from "../../lib/types";

const LEVELS: LevelCode[] = ["EE", "ME", "AE", "BE"];
const LEVEL_COLORS: Record<LevelCode, string> = {
  EE: "bg-kenyan-green/20 text-kenyan-green border-kenyan-green",
  ME: "bg-blue-100 text-blue-700 border-blue-200",
  AE: "bg-amber-100 text-amber-700 border-amber-200",
  BE: "bg-red-100 text-red-700 border-red-200",
};

interface GradingCell {
  learnerId: string;
  learnerName: string;
  subStrandId: string;
  subStrandName: string;
  level?: LevelCode;
  points?: number;
}

export default function GradingGridPage() {
  const { t } = useTranslation();
  const { roles } = useAuthStore();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [cells, setCells] = useState<Record<string, LevelCode>>({}); // key: learnerId-subStrandId

  useEffect(() => {
    api.get<any[]>("/assessment/events")
      .then((r) => { setEvents(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    getAssessmentResults().then((saved) => {
      const map: Record<string, LevelCode> = {};
      saved.forEach((r) => {
        const p = r.payload as any;
        const key = `${p.learner_id}-${p.sub_strand_id}`;
        if (p.level_code) map[key] = p.level_code;
      });
      setCells(map);
    });
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (events.length === 0) return <ViewState state="empty" message={t("no_assessment_events", { defaultMessage: "No assessment events" })} />;
  if (!selectedEvent) {
    return (
      <div className="p-4 space-y-4">
        <Card className="p-4">
          <h2 className="text-heading mb-3">{t("teacher.grading")}</h2>
          <p className="text-body mb-4">{t("teacher.select_assessment_event", { defaultMessage: "Select an assessment event to start grading" })}</p>
          <div className="space-y-2">
            {events.map((e) => (
              <Button
                key={e.event_id}
                variant={selectedEvent === e.event_id ? "primary" : "secondary"}
                fullWidth
                onClick={() => setSelectedEvent(e.event_id)}
              >
                {e.assessment_type} — {e.learning_area_id} ({e.status})
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const event = events.find((e) => e.event_id === selectedEvent);
  if (!event) return <ViewState state="empty" />;

  const grid = learners.map((l) => ({
    learnerId: l.learner_id,
    learnerName: `${l.first_name} ${l.last_name}`,
    subStrandId: event.learning_area_id,
    subStrandName: event.learning_area_id,
    level: cells[`${l.learner_id}-${event.learning_area_id}`] as LevelCode | undefined,
  }));

  const handleLevel = (learnerId: string, level: LevelCode) => {
    const key = `${learnerId}-${event.learning_area_id}`;
    setCells((c) => ({ ...c, [key]: level }));
    saveAssessmentResult({
      learner_id: learnerId,
      event_id: selectedEvent,
      sub_strand_id: event.learning_area_id,
      level_code: level,
      state: "DRAFT",
      version: 1,
      device_id: DEVICE_ID,
      client_ts: new Date().toISOString(),
      teacher_id: roles.includes("TEACHER") ? (useAuthStore.getState().userId || "") : "",
    } as any);
  };

  const syncedCount = Object.values(cells).length;
  const total = grid.length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-heading font-display">{event.assessment_type}</h2>
          <p className="text-caption text-muted">{event.learning_area_id}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-gray-900">{syncedCount}/{total}</div>
          <div className="text-caption text-muted">{t("teacher.graded", { defaultMessage: "graded" })}</div>
        </div>
      </div>

      <Card className="p-3">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase sticky left-0 bg-white z-10">{t("learner")}</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">{event.learning_area_id}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grid.map((cell) => (
                <tr key={cell.learnerId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 text-sm font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">
                    {cell.learnerName}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      {LEVELS.map((lv) => {
                        const active = cell.level === lv;
                        return (
                          <Button
                            key={lv}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleLevel(cell.learnerId, lv)}
                            className={`w-10 h-10 rounded-lg text-xs font-bold border ${
                              active ? LEVEL_COLORS[lv] : "bg-white border-gray-300 text-gray-600 hover:border-gray-500"
                            }`}
                          >
                            {lv}
                          </Button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-muted mt-2 text-right">{t("teacher.tap_cell", { defaultMessage: "Tap a level to grade a learner. Changes save automatically." })}</p>
      </Card>
    </div>
  );
}
