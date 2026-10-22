import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { LinkedLearner, ReportCard } from "../../lib/types";

export default function ParentProgressPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<LinkedLearner[]>([]);
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [selected, setSelected] = useState<LinkedLearner | null>(null);

  useEffect(() => {
    api.get<LinkedLearner[]>("/me/linked-learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
    api.get<ReportCard[]>("/reports/cards")
      .then((r) => { setCards(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (learners.length === 0) return <ViewState state="empty" message={t("parent.no_children", { defaultMessage: "No linked children" })} />;

  const childCards = selected ? cards.filter((c) => c.learner_id === selected.learner_id) : [];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.progress")}</h1>
      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <label className="label block mb-2" htmlFor="child-select">{t("select_child", { defaultMessage: "Select child" })}</label>
          <select id="child-select" className="input-field w-full max-w-sm" value={selected?.learner_id ?? ""} onChange={(e) => setSelected(learners.find((l) => l.learner_id === e.target.value) ?? null)}>
            <option value="">{t("select_child", { defaultMessage: "Select child" })}</option>
            {learners.map((l) => <option key={l.learner_id} value={l.learner_id}>{l.first_name} {l.last_name}</option>)}
          </select>
        </Card>
        {selected && (
          <Card className="p-4">
            <h2 className="text-heading mb-3">{selected.first_name} {selected.last_name}</h2>
            {childCards.length === 0 ? (
              <ViewState state="empty" message={t("parent.no_reports", { defaultMessage: "No published reports" })} />
            ) : (
              <div className="space-y-3">
                {childCards.map((card) => (
                  <Card key={card.card_id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{card.academic_year_id} — {card.term_id ?? "Term"}</div>
                        <div className="text-caption text-muted">{card.grade_id}</div>
                      </div>
                      <Badge variant={card.overall_grade === "EE" ? "success" : card.overall_grade === "ME" ? "info" : card.overall_grade === "AE" ? "warning" : "danger"}>
                        {card.overall_grade ?? "—"}
                      </Badge>
                    </div>
                    {card.percentage != null && (
                      <div className="mt-2 text-sm">{t("parent.percentage", { defaultMessage: "Percentage" })}: {card.percentage}%</div>
                    )}
                    {card.position != null && (
                      <div className="text-sm">{t("parent.position", { defaultMessage: "Position" })}: {card.position}</div>
                    )}
                    {card.comment && (
                      <div className="mt-2 text-sm text-gray-600">{card.comment}</div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <ButtonLink onClick={() => {}}>{t("download_pdf", { defaultMessage: "Download PDF" })}</ButtonLink>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
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
