import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import { KPIStatCard } from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { getAssessmentResults } from "../../lib/offline";
import { Learner, AssessmentResult } from "../../lib/types";

export default function ClassProgressPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [results, setResults] = useState<AssessmentResult[]>([]);

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
    getAssessmentResults().then((saved) => {
      setResults(saved.map((r) => r.payload as AssessmentResult));
    });
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (learners.length === 0) return <ViewState state="empty" message={t("teacher.no_learners")} />;

  const totalLearners = learners.length;
  const gradedLearners = new Set(results.map((r) => r.learner_id)).size;
  const ee = results.filter((r) => r.level_code === "EE").length;
  const me = results.filter((r) => r.level_code === "ME").length;
  const ae = results.filter((r) => r.level_code === "AE").length;
  const be = results.filter((r) => r.level_code === "BE").length;

        const support = learners.map((l) => {
          const r = results.find((x) => x.learner_id === l.learner_id);
          return { ...l, level_code: r?.level_code ?? null };
        }).filter((l) => !l.level_code || l.level_code === "BE" || l.level_code === "AE");

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("teacher.class_progress")}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard title={t("total_learners", { defaultMessage: "Total Learners" })} value={totalLearners} />
        <KPIStatCard title={t("teacher.graded_learners", { defaultMessage: "Graded" })} value={gradedLearners} trend={{ label: t("teacher.pending", { defaultMessage: "pending" }), value: totalLearners - gradedLearners, positive: false }} />
        <KPIStatCard title="EE" value={ee} trend={{ label: t("level_exceeding"), value: ee, positive: true }} />
        <KPIStatCard title="ME" value={me} trend={{ label: t("level_meeting"), value: me, positive: true }} />
        <KPIStatCard title="AE" value={ae} trend={{ label: t("level_approaching"), value: ae, positive: false }} />
        <KPIStatCard title="BE" value={be} trend={{ label: t("level_below"), value: be, positive: false }} />
      </div>

      <Card className="p-4">
        <h3 className="text-heading mb-3">{t("teacher.learners_needing_support", { defaultMessage: "Learners Needing Support" })}</h3>
        <DataTable
          data={support}
          columns={[
            { key: "admission_number", header: t("admission_number") },
            { key: "first_name", header: t("first_name") },
            { key: "last_name", header: t("last_name") },
            { key: "grade_label", header: t("grade") },
            { key: "level_code", header: t("level"), render: (row) => <Badge variant="default">{row.level_code ?? "—"}</Badge> },
          ]}
          emptyMessage={t("teacher.all_on_track", { defaultMessage: "All learners on track" })}
          keyField="learner_id"
        />
      </Card>
    </div>
  );
}
