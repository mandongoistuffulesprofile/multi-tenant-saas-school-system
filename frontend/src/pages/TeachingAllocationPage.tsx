import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import { LearningArea } from "../lib/types";

export default function TeachingAllocationPage() {
  const handleSaveAllocation = async (allocations: any) => {
    try {
      await api.post("/structure/teaching-allocations", allocations);
      alert("Teaching allocations saved to database!");
    } catch {
      alert("Failed to save allocation");
    }
  };

  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [areas, setAreas] = useState<LearningArea[]>([]);
  const [allocation, setAllocation] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    api.get<LearningArea[]>("/curriculum/areas")
      .then((r) => { setAreas(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  const teachers = [
    { id: "t1", name: "Ms. Wanjiku", subjects: ["Mathematics", "English"] },
    { id: "t2", name: "Mr. Otieno", subjects: ["Science", "Social Studies"] },
    { id: "t3", name: "Ms. Njeri", subjects: ["Kiswahili", "CRE"] },
  ];

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
        <p className="text-caption text-muted mt-2">{t("unassigned_warning")}</p>
      </Card>
    </div>
  );
}
