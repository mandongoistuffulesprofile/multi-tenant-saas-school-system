import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import Button from "../components/atoms/Button";
import ViewState from "../components/organisms/ViewState";
import { LearningArea } from "../lib/types";
import { useToast } from "../components/toast/ToastProvider";
import type { TeachingWeeklyLoad } from "../lib/types";

interface ClassGroupRow {
  class_group_id: string;
  year_id: string;
  year_label: string;
  grade_label: string;
  stream_name: string;
}

interface TeachingAssignmentRow {
  assignment_id: string;
  staff_membership_id: string;
  class_group_id: string;
  subject_id: string;
  academic_year_id: string;
}

interface TeacherRow {
  membership_id: string;
  user_id: string;
  email: string;
  phone_number: string;
  role: string;
}

export default function TeachingAllocationPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [areas, setAreas] = useState<LearningArea[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [classGroups, setClassGroups] = useState<ClassGroupRow[]>([]);
  const [yearId, setYearId] = useState("");
  const [classGroupId, setClassGroupId] = useState("");
  const [assignments, setAssignments] = useState<TeachingAssignmentRow[]>([]);
  const [allocation, setAllocation] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [weeklyLoad, setWeeklyLoad] = useState<TeachingWeeklyLoad | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/staff"),
      api.get<LearningArea[]>("/curriculum/areas"),
      api.get<ClassGroupRow[]>("/structure/class-groups"),
    ])
      .then(([staffRes, areasRes, groupsRes]) => {
        const staff = Array.isArray(staffRes.data) ? staffRes.data : [];
        setTeachers(
          staff
            .filter((s: TeacherRow) => ["TEACHER", "HEAD", "DEPUTY", "SCHOOL_ADMIN"].includes((s.role || "").toUpperCase()))
            .map((s: TeacherRow) => ({ ...s })),
        );
        setAreas(Array.isArray(areasRes.data) ? areasRes.data : []);
        const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];
        setClassGroups(groups);
        if (groups.length > 0) {
          setYearId(groups[0].year_id);
          setClassGroupId(groups[0].class_group_id);
        }
        setState("content");
      })
      .catch(() => setState("error"));
  }, []);

  const loadAssignments = useCallback(async (groupId: string) => {
    if (!groupId) {
      setAssignments([]);
      setAllocation({});
      return;
    }
    try {
      const res = await api.get<TeachingAssignmentRow[]>("/structure/teaching-assignments", {
        params: { class_group_id: groupId },
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      setAssignments(rows);
      const next: Record<string, string> = {};
      for (const row of rows) next[row.subject_id] = row.staff_membership_id;
      setAllocation(next);
    } catch {
      setAssignments([]);
      setAllocation({});
    }
  }, []);

  const loadWeeklyLoad = useCallback(async (year: string) => {
    if (!year) {
      setWeeklyLoad(null);
      return;
    }
    setWeeklyLoading(true);
    try {
      const res = await api.get<TeachingWeeklyLoad>("/structure/teaching-weekly-load", {
        params: { academic_year_id: year },
      });
      setWeeklyLoad(res?.data ?? null);
    } catch {
      setWeeklyLoad(null);
    } finally {
      setWeeklyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssignments(classGroupId);
  }, [classGroupId, loadAssignments]);

  useEffect(() => {
    void loadWeeklyLoad(yearId);
  }, [yearId, loadWeeklyLoad]);

  const years = Array.from(
    new Map(classGroups.map((g) => [g.year_id, g.year_label || g.year_id])).entries(),
  );
  const groupsForYear = classGroups.filter((g) => !yearId || g.year_id === yearId);

  const handleYearChange = (nextYearId: string) => {
    setYearId(nextYearId);
    const first = classGroups.find((g) => g.year_id === nextYearId);
    setClassGroupId(first?.class_group_id || "");
  };

  const handleClassGroupChange = (nextGroupId: string) => {
    setClassGroupId(nextGroupId);
  };

  const teacherName = (membershipId: string) => {
    const teacher = teachers.find((item) => item.membership_id === membershipId);
    return teacher?.email || teacher?.phone_number || membershipId;
  };

  const handleSave = async () => {
    if (!classGroupId || !yearId) {
      toast("Choose an academic year and class first.", { type: "error" });
      return;
    }
    setSaving(true);
    try {
      const existingByArea = new Map(assignments.map((row) => [row.subject_id, row]));
      for (const area of areas) {
        const desired = allocation[area.area_id] || "";
        const existing = existingByArea.get(area.area_id);
        if (!desired) {
          if (existing) await api.delete(`/structure/teaching-assignments/${existing.assignment_id}`);
          continue;
        }
        if (existing?.staff_membership_id === desired) continue;
        if (existing) await api.delete(`/structure/teaching-assignments/${existing.assignment_id}`);
        await api.post("/structure/teaching-assignments", {
          staff_membership_id: desired,
          class_group_id: classGroupId,
          subject_id: area.area_id,
          academic_year_id: yearId,
        });
      }
      toast("Teaching allocations saved!", { type: "success" });
      await loadAssignments(classGroupId);
      await loadWeeklyLoad(yearId);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save allocation", { type: "error" });
    } finally {
      setSaving(false);
    }
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="label">{t("academic_year")}</label>
              <select
                className="input-field"
                value={yearId}
                onChange={(e) => handleYearChange(e.target.value)}
              >
                <option value="">{t("select", { defaultValue: "Select" })}</option>
                {years.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("class_group", { defaultValue: "Class" })}</label>
              <select
                className="input-field"
                value={classGroupId}
                onChange={(e) => handleClassGroupChange(e.target.value)}
              >
                <option value="">{t("select", { defaultValue: "Select" })}</option>
                {groupsForYear.map((g) => (
                  <option key={g.class_group_id} value={g.class_group_id}>
                    {g.grade_label}{g.stream_name ? ` ${g.stream_name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[700px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    {t("learning_area")}
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    {t("teacher_label")}
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    {t("status")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {areas.map((area) => {
                  const assigned = allocation[area.area_id];
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
                            const value = e.target.value;
                            setAllocation((prev) => {
                              const next = { ...prev };
                              if (value) next[area.area_id] = value;
                              else delete next[area.area_id];
                              return next;
                            });
                          }}
                        >
                          <option value="">{t("unassigned")}</option>
                          {teachers.map((teacher) => (
                            <option key={teacher.membership_id} value={teacher.membership_id}>
                              {teacher.email || teacher.phone_number || teacher.membership_id}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {!assigned ? (
                          <Badge variant="danger">{t("unassigned")}</Badge>
                        ) : (
                          <Badge variant="success">{teacherName(assigned)}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {areas.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-gray-500">
                      {t("no_learning_areas")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-4">
            <p className="text-caption text-muted">{t("unassigned_warning")}</p>
            <Button variant="primary" onClick={handleSave} disabled={saving || !classGroupId}>
              {saving ? "Saving…" : t("save", { defaultValue: "Save allocations" })}
            </Button>
          </div>
        </Card>

      {weeklyLoad && (
        <Card className="max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-heading">
                {t("weekly_teaching_load", { defaultValue: "Weekly teaching load" })}
              </h2>
              <p className="text-body">
                {weeklyLoad.academic_year_label || weeklyLoad.academic_year_id} · assignments by teacher
                and by class group
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setWeeklyLoad(null)}>
              {t("hide", { defaultValue: "Hide" })}
            </Button>
          </div>

          {weeklyLoading && (
            <p className="text-caption text-muted">{t("loading", { defaultValue: "Loading…" })}</p>
          )}

          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700">
                {t("by_teacher", { defaultValue: "By teacher" })}
              </div>
              <div className="divide-y divide-slate-100">
                {weeklyLoad.by_staff.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500">
                    {t("no_assignments_yet", { defaultValue: "No teaching assignments yet for this academic year." })}
                  </div>
                ) : (
                  weeklyLoad.by_staff.map((staff) => (
                    <div key={staff.staff_membership_id} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900">
                          {staff.staff_name || staff.staff_email || staff.staff_membership_id}
                        </span>
                        <Badge variant="default">
                          {staff.assignment_count} assignment{staff.assignment_count === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {staff.assignments.length > 0 && (
                        <div className="ml-4 text-sm text-slate-600 space-y-1">
                          {staff.assignments.map((row) => (
                            <div key={row.assignment_id} className="flex flex-wrap gap-2">
                              <span className="text-slate-700">{row.class_group_name || `${row.grade_label} ${row.stream_name}`}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-slate-700">{row.learning_area_name || row.subject_id}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-medium text-slate-700">
                {t("by_class_group", { defaultValue: "By class group" })}
              </div>
              <div className="divide-y divide-slate-100">
                {weeklyLoad.by_class_group.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500">
                    {t("no_class_groups", { defaultValue: "No class groups for this academic year." })}
                  </div>
                ) : (
                  weeklyLoad.by_class_group.map((cg) => (
                    <div key={cg.class_group_id} className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900">
                          {cg.class_group_name || `${cg.grade_label ? cg.grade_label + " " : ""}${cg.stream_name}`.trim() || cg.class_group_id}
                        </span>
                        <Badge variant="default">
                          {cg.coverage_count} subject{cg.coverage_count === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {cg.assignments.length > 0 && (
                        <div className="ml-4 text-sm text-slate-600 space-y-1">
                          {cg.assignments.map((row) => (
                            <div key={row.assignment_id} className="flex flex-wrap gap-2">
                              <span className="text-slate-700">{row.learning_area_name || row.subject_id}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-slate-700">{row.staff_name || row.staff_email || row.staff_membership_id}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
