import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import { Learner } from "../../lib/types";

export default function MyClassesPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  // Group learners by grade + stream
  const groups = new Map<string, Learner[]>();
  learners.forEach((l) => {
    const key = `${l.grade_label ?? "Ungraded"} — ${l.stream_name ?? "General"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  });

  if (groups.size === 0) return <ViewState state="empty" message={t("teacher.no_classes")} />;

  return (
    <div className="space-y-4 p-4">
      {Array.from(groups.entries()).map(([label, classLearners]) => (
        <Card key={label} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-heading font-display">{label}</h2>
              <p className="text-caption text-muted">{classLearners.length} {t("learners", { defaultMessage: "learners" })}</p>
            </div>
            <Badge variant="default">{t("teacher.online", { defaultMessage: "Online" })}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {classLearners.map((l) => (
              <div key={l.learner_id} className="flex flex-col items-center gap-1 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg">{l.photo_ref ? "📷" : ""}</div>
                <span className="text-xs font-medium text-gray-900 truncate w-full text-center">
                  {l.first_name} {l.last_name}
                </span>
                <span className="text-xs text-gray-500">{l.admission_number}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
