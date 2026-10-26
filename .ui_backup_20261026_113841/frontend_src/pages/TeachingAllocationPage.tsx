import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import Button from "../components/atoms/Button";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import { LearningArea } from "../lib/types";
import { useToast } from "../components/toast/ToastProvider";

export default function TeachingAllocationPage() {
  const handleSaveAllocation = async (allocations: any) => {
    // Only post real (teacher-id) selections.
    const payload = Object.fromEntries(Object.entries(allocations).filter(([, v]) => !!v));
    try {
      await api.post("/structure/teaching-allocations", payload);
      toast("Teaching allocations saved to database!", { type: "success" });
    } catch {
      toast("Failed to save allocation", { type: "error" });
    }
  };

  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [areas, setAreas] = useState<LearningArea[]>([]);
  const [allocation, setAllocation] = useState<Record<string, string | undefined>>({});
  const [teachers, setTeachers] = useState<{ id: string; name: string; subjects: string[] }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Real staff directory — teachers (and admins able to take a class).
    api
      .get("/staff")
      .then((r) => {
        if (!Array.isArray(r.data)) return;
        const rows = r.data.filter((s: any) => ["teacher", "head", "deputy", "admin"].includes(s.role))
          .map((s: any) => ({
            id: s.staff_id || s.user_id,
            name: s.full_name || s.name || s.email,
            subjects: [] as string[],
          }));
        setTeachers(rows);
        setState("content");
      })
      .catch(() => setState("error"));
    api.get<LearningArea[]>("/curriculum/areas")
      .then((r) => { setAreas(Array.isArray(r.data) ? r.data : []); })
      .catch(() => setState("error"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await handleSaveAllocation(allocation);
    setSaving(false);
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{t("teaching_allocation")}</h1>
          <p className="text-body">{t("assign_teachers_to_learning_areas")}</p>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">{t("learning_area")}</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">{t("teacher_label")}</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {areas.map((area) => {
                const assigned = allocation[area.area_id];
                const teacher = teachers.find((t) => t.id === assigned);
                return (
                  <tr key={area.area_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="font-medium">{area.name}</div>
                      <div className="text-caption text-gray-500">{area.code}</div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <select
                        className="input-field w-full max-w-xs"
                        value={assigned || ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAllocation({ ...allocation, [area.area_id]: v || undefined });
                        }}
                      >
                        <option value="">{t("unassigned")}</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {!assigned ? (
                        <Badge variant="danger">{t("unassigned")}</Badge>
                      ) : (
                        <Badge variant="success">{t("assigned")}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {areas.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-500">{t("no_learning_areas")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-caption text-muted">{t("unassigned_warning")}</p>
          <Button variant="primary" onClick={handleSave} disabled={saving || Object.keys(allocation).length === 0}>
            {saving ? "Saving…" : t("save", { defaultMessage: "Save allocations" })}
          </Button>
        </div>
      </Card>
    </div>
  );
}
