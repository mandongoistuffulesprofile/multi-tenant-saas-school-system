import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import {
  saveAttendanceMark,
  getAttendanceMarks,
  getDeviceId,
  cacheReference,
  readReference,
} from "../../lib/offline";
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
  const { roles, tenantId } = useAuthStore();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [registers, setRegisters] = useState<AttendanceRegister[]>([]);
  const [selected, setSelected] = useState<AttendanceRegister | null>(null);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({}); // learnerId -> mark
  const [source, setSource] = useState<"network" | "cache">("network");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [regRes, learnerRes] = await Promise.all([
          api.get<AttendanceRegister[]>("/attendance/registers"),
          api.get<Learner[]>("/learners"),
        ]);
        if (cancelled) return;
        const regs = Array.isArray(regRes.data) ? regRes.data : [];
        const roster = Array.isArray(learnerRes.data) ? learnerRes.data : [];
        setRegisters(regs);
        setLearners(roster);
        setSource("network");
        setState("content");
        if (tenantId) {
          // Keep a copy so the register can be opened with no network at all.
          await Promise.all([
            cacheReference(tenantId, "attendance.registers", regs),
            cacheReference(tenantId, "attendance.learners", roster),
          ]);
        }
      } catch {
        if (cancelled) return;
        // Network failed. A cold offline start is only possible if an earlier
        // session saved the register, so read that back instead of an error.
        const [cachedRegs, cachedRoster] = tenantId
          ? await Promise.all([
              readReference<AttendanceRegister[]>(tenantId, "attendance.registers"),
              readReference<Learner[]>(tenantId, "attendance.learners"),
            ])
          : [null, null];
        if (cancelled) return;
        if (cachedRegs && cachedRoster) {
          setRegisters(cachedRegs.data);
          setLearners(cachedRoster.data);
          setSource("cache");
          setCachedAt(cachedRegs.cachedAt);
          setState("content");
        } else {
          setState("error");
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (!selected || !tenantId) return;
    getAttendanceMarks(tenantId).then((saved) => {
      const map: Record<string, string> = {};
      saved.forEach((r) => {
        const p = r.payload as any;
        if (p.register_id === selected?.register_id) map[p.learner_id] = p.status;
      });
      setMarks(map);
    });
  }, [selected, tenantId]);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") {
    return (
      <ViewState
        state="offline"
        message="You are offline and this device has no saved attendance register yet. Open this screen once with a connection to save a copy."
      />
    );
  }
  if (registers.length === 0) return <ViewState state="empty" message={t("no_registers", { defaultValue: "No attendance registers" })} />;

  const offlineNotice = source === "cache" ? (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Offline — showing the register saved{" "}
      {cachedAt ? new Date(cachedAt).toLocaleString() : "earlier"}. Marks you record are kept on this device and sync when
      the connection returns.
    </div>
  ) : null;

  if (!selected) {
    return (
      <div className="p-4 space-y-4">
        {offlineNotice}
        <Card className="p-4">
          <h2 className="text-heading mb-3">{t("teacher.attendance")}</h2>
          <p className="text-body mb-4">{t("teacher.select_register", { defaultValue: "Select a register to mark attendance" })}</p>
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
    // Local draft only; persisted/queued on explicit save to avoid per-tap queue churn.
  };

  return (
    <div className="p-4 space-y-4">
      {offlineNotice}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{selected.register_date}</h1>
          <p className="text-caption text-muted">{selected.session_type} · {selected.status}</p>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold text-gray-900">{presentCount}/{classLearners.length}</div>
          <div className="text-caption text-muted">{t("teacher.present", { defaultValue: "present" })}</div>
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
          const entries = Object.entries(marks).map(([learner_id, mark]) => {
            const id = `${selected.register_id}:${learner_id}`;
            return {
              id,
              client_uuid: id,
              learner_id,
              status: mark,
              register_id: selected.register_id,
              marked_at: new Date().toISOString(),
              device_id: getDeviceId(),
              client_ts: new Date().toISOString(),
            };
          });
          if (entries.length === 0) return;
          try {
            await api.post("/attendance/marks/batch", { register_id: selected.register_id, marks: entries.map(({ learner_id, status, register_id, client_uuid, device_id, client_ts }) => ({ learner_id, status, register_id, client_uuid, device_id, client_ts })) });
            await Promise.all(entries.map((e) => saveAttendanceMark(tenantId!, e as any, { enqueue: false })));
            toast("Attendance saved successfully!", { type: "success" });
          } catch (e) {
            // Persist each mark locally and queue for sync/retry.
            await Promise.all(entries.map((e) => saveAttendanceMark(tenantId!, e as any)));
            toast("Saved offline. Will sync when online.", { type: "warning" });
          }
        }}>
          {t("teacher.save_register", { defaultValue: "Save Register" })}
        </Button>
      </div>
    </div>
  );
}
