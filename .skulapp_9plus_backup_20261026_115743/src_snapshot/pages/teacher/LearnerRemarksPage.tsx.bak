import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { Learner } from "../../lib/types";

export default function LearnerRemarksPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [selected, setSelected] = useState<Learner | null>(null);
  const [remark, setRemark] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  const competencies = ["Reading", "Writing", "Numeracy", "Creativity", "Collaboration", "Digital Literacy"];
  const levels = ["EE", "ME", "AE", "BE"];

  if (state === "loading") return <ViewState state="loading" />;
  if (learners.length === 0) return <ViewState state="empty" message={t("teacher.no_learners")} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("teacher.learner_remarks")}</h1>
      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <label className="label block" htmlFor="learner-select">{t("select_learner", { defaultMessage: "Select learner" })}</label>
              <select id="learner-select" className="input-field" value={selected?.learner_id ?? ""} onChange={(e) => setSelected(learners.find((l) => l.learner_id === e.target.value) ?? null)}>
                <option value="">{t("select_learner", { defaultMessage: "Select learner" })}</option>
                {learners.map((l) => <option key={l.learner_id} value={l.learner_id}>{l.first_name} {l.last_name} ({l.admission_number})</option>)}
              </select>
            </div>
          </div>
        </Card>
        {selected && (
          <Card className="p-4">
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-heading font-display mb-2">{selected.first_name} {selected.last_name}</h2>
                <p className="text-caption text-muted">{selected.admission_number} — {selected.grade_label ?? "—"} {selected.stream_name ?? ""}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {competencies.map((c) => (
                  <div key={c} className="flex flex-col gap-2">
                    <label className="label">{c}</label>
                    <div className="flex gap-2">
                      {levels.map((lv) => (
                        <Button
                          key={lv}
                          variant="ghost"
                          size="sm"
                          onClick={() => setValues({ ...values, [c]: lv })}
                          className={`w-10 h-10 rounded-lg text-xs font-bold border ${values[c] === lv ? "bg-kenyan-red text-white border-kenyan-red" : "bg-white border-gray-300 text-gray-600"}`}
                        >
                          {lv}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t">
                <label className="label block">{t("term_remark", { defaultMessage: "Term remark" })}</label>
                <Input value={remark} onChange={(e) => setRemark(e.target.value)} className="h-32" />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="secondary" onClick={() => setRemark("")}>{t("save_draft")}</Button>
                <Button variant="primary" onClick={() => {}}>{t("teacher.publish")}</Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
