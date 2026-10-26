import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { saveAttendanceMark, getAttendanceMarks, DEVICE_ID } from "../../lib/offline";
import { AttendanceRegister, AttendanceMark, Learner } from "../../lib/types";
import { useToast } from "../../components/toast/ToastProvider";

const MARKS = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const MARK_COLORS: Record<string, string> = {
  PRESENT: "bg-kenyan-green/20 text-kenyan-green border-kenyan-green",
  ABSENT: "bg-red-100 text-red-700 border-red-200",
  LATE: "bg-amber-100 text-amber-700 border-amber-200",
  EXCUSED: "bg-blue-100 text-blue-700 border-blue-200",
};

export default function AttendanceRegisterPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { roles } = useAuthStore();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [registers, setRegisters] = useState<AttendanceRegister[]>([]);
  const [selected, setSelected] = useState<AttendanceRegister | null>(null);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({}); // learnerId -> mark

  useEffect(() => {
    api.get<AttendanceRegister[]>("/attendance/registers")
      .then((r) => { setRegisters(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    getAttendanceMarks().then((saved) => {
      const map: Record<string, string> = {};
      saved.forEach((r) => {
        const p = r.payload as any;
        if (p.register_id === selected?.register_id) map[p.learner_id] = p.status;
      });
      setMarks(map);
    });
  }, [selected]);

  if (state === "loading") return <ViewState state="loading" />;
  if (registers.length === 0) return <ViewState state="empty" message={t("no_registers", { defaultMessage: "No attendance registers" })} />;
  if (!selected) {
    return (
      <div className="p-4 space-y-4">
        <Card className="p-4">
          <h2 className="text-heading mb-3">{t("teacher.attendance")}</h2>
          <p className="text-body mb-4">{t("teacher.select_register", { defaultMessage: "Select a register to mark attendance" })}</p>
          <div className="space-y-2">
            {registers.map((reg) => (
              <Button key={reg.register_id} variant="secondary" fullWidth onClick={() => setSelected(reg)}>
                {reg.register_date} — {reg.session_type} ({reg.status})
              </Button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const classLearners = learners.filter((l) => l.status === "ACTIVE");
  const presentCount = Object.values(marks).filter((m) => m === "PRESENT").length;

  const handleMark = (learnerId: string, mark: string) => {
    setMarks((m) => ({ ...m, [learnerId]: mark }));
    saveAttendanceMark({
      register_id: selected!.register_id,
      learner_id: learnerId,
      status: mark,
      marked_at: new Date().toISOString(),
      device_id: DEVICE_ID,
    } as any);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{selected.register_date}</h1>
          <p className="text-caption text-muted">{selected.session_type} · {selected.status}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-gray-900">{presentCount}/{classLearners.length}</div>
          <div className="text-caption text-muted">{t("teacher.present", { defaultMessage: "present" })}</div>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {MARKS.map((m) => (
          <Button key={m} variant="secondary" size="sm" onClick={() => {
            classLearners.forEach((l) => { handleMark(l.learner_id, m); });
          }} className="w-20">
            {m}
          </Button>
        ))}
      </div>

      <Card className="p-3">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase sticky left-0 bg-white z-10">{t("learner")}</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase">{t("mark")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {classLearners.map((l) => (
                <tr key={l.learner_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 text-sm font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">
                    {l.first_name} {l.last_name}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      {MARKS.map((m) => {
                        const active = marks[l.learner_id] === m;
                        return (
                          <Button
                            key={m}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMark(l.learner_id, m)}
                            className={`w-10 h-10 rounded-lg text-xs font-bold border ${active ? MARK_COLORS[m] : "bg-white border-gray-300 text-gray-600"}`}
                          >
                            {m.charAt(0)}
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
      </Card>

      <div className="p-4">
        <Button variant="primary" fullWidth onClick={async () => {
          if (!selected) return;
          try {
            const entries = Object.entries(marks).map(([learner_id, mark]) => ({ learner_id, mark }));
            await api.post("/attendance/marks/batch", { register_id: selected.register_id, marks: entries });
            toast("Attendance saved successfully!", { type: "success" });
          } catch (e) { toast("Failed to save attendance", { type: "error" }); }
        }}>
          {t("teacher.save_register", { defaultMessage: "Save Register" })}
        </Button>
      </div>
    </div>
  );
}
