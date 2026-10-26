import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import { Learner } from "../lib/types";

export default function GradesStreamsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [grade, setGrade] = useState("");
  const [stream, setStream] = useState("");

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  const grades = ["PP1", "PP2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  const streams = ["East", "West", "North", "South"];

  const filtered = learners.filter((l) =>
    (grade ? l.grade_label === grade : true) &&
    (stream ? l.stream_name === stream : true)
  );

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{t("grades_streams")}</h1>
          <p className="text-body">{t("assign_learners_to_grades_streams")}</p>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="label">{t("grade")}</label>
            <select className="input-field" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">{t("all_grades")}</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t("stream")}</label>
            <select className="input-field" value={stream} onChange={(e) => setStream(e.target.value)}>
              <option value="">{t("all_streams")}</option>
              {streams.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <ButtonLink onClick={() => { setGrade(""); setStream(""); }}>{t("reset")}</ButtonLink>
          </div>
          <div className="flex items-end">
            <span className="text-body font-medium">{filtered.length} {t("learners")}</span>
          </div>
        </div>
      </Card>

      <Card>
        <DataTable
          data={filtered}
          columns={[
            { key: "admission_number", header: t("admission_number"), sortable: true },
            { key: "first_name", header: t("first_name"), sortable: true },
            { key: "last_name", header: t("last_name"), sortable: true },
            { key: "grade_label", header: t("grade"), sortable: true },
            { key: "stream_name", header: t("stream"), sortable: true },
            { key: "status", header: t("status"), render: (row) => <Badge variant="default">{row.status}</Badge> },
          ]}
          emptyMessage={t("no_learners")}
          keyField="learner_id"
        />
      </Card>
    </div>
  );
}

function ButtonLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-kenyan-red hover:underline font-medium">
      {children}
    </button>
  );
}
