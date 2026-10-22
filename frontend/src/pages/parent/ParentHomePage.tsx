import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import { KPIStatCard } from "../../components/atoms/Card";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { LinkedLearner } from "../../lib/types";

export default function ParentHomePage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<LinkedLearner[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});

  useEffect(() => {
    api.get<LinkedLearner[]>("/me/linked-learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (learners.length === 0) return <ViewState state="empty" message={t("parent.no_children", { defaultMessage: "No linked children" })} />;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{t("parent.home")}</h1>
          <p className="text-body">{t("parent.children_summary", { defaultMessage: "Your children at a glance" })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {learners.map((child) => (
          <Card key={child.learner_id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="w-12 h-12 rounded-full bg-kenyan-red/10 flex items-center justify-center text-lg text-kenyan-red">👦</div>
              <Badge variant="default">{child.grade_label ?? "—"}</Badge>
            </div>
            <h3 className="text-heading mb-1">{child.first_name} {child.last_name}</h3>
            <p className="text-caption text-muted mb-4">{child.admission_number}</p>
            <div className="grid grid-cols-2 gap-2">
              <KPIStatCard title={t("balance", { defaultMessage: "Balance" })} value={`KES ${balances[child.learner_id] ?? 0}`} />
              <KPIStatCard title={t("parent.last_synced", { defaultMessage: "Last synced" })} value="Just now" />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" size="sm" fullWidth>{t("view")}</Button>
              <Button variant="primary" size="sm" fullWidth>{t("parent.pay_fees", { defaultMessage: "Pay Fees" })}</Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="primary" fullWidth>{t("notices")}</Button>
        <Button variant="secondary" fullWidth>{t("consents")}</Button>
      </div>
    </div>
  );
}
