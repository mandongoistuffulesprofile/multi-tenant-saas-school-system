import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import { Learner } from "../lib/types";
import { useToast } from "../components/toast/ToastProvider";

export default function GradesStreamsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [grade, setGrade] = useState("");
  const [stream, setStream] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  const grades = ["PP1", "PP2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
  const streams = ["East", "West", "North", "South"];

  const handleAssign = async (learnerId: string, learnerName: string, patch: { grade_label?: string; stream_name?: string }) => {
    setSavingId(learnerId);
    try {
      await api.patch(`/learners/${learnerId}`, patch);
      setLearners((ls) => ls.map((l) => (l.learner_id === learnerId ? { ...l, ...patch } as Learner : l)));
      toast(`${learnerName} updated`, { type: "success" });
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to update learner", { type: "error" });
    } finally {
      setSavingId(null);
    }
  };

  const filtered = learners.filter((l) =>
    (grade ? l.grade_label === grade : true) &&
    (stream ? (l.stream_name || "") === stream : true)
  );

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  const cols = stream ? streams.filter((s) => s === stream) : streams;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{'Grades & Streams'}</h1>
          <p className="text-body">{'Assign learners to grades and streams — changes save immediately.'}</p>
        </div>
        <span className="text-body font-medium">{filtered.length} {'learners'}</span>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-2">
          <div>
            <label className="label">{'Grade'}</label>
            <select className="input-field" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">{'All Grades'}</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{'Stream'}</label>
            <select className="input-field" value={stream} onChange={(e) => setStream(e.target.value)}>
              <option value="">{'All Streams'}</option>
              {streams.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button type="button" onClick={() => { setGrade(""); setStream(""); }} className="text-sm text-kenyan-red hover:underline font-medium">
              {'Reset'}
            </button>
          </div>
          <div className="flex items-end justify-end">
            <span className="text-caption text-gray-500">Tip: change a learner’s Grade or Stream inline below.</span>
          </div>
        </div>
      </Card>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">{'Adm. No.'}</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">{'Learner'}</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">{'Grade'}</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">{'Stream'}</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase">{'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((l) => (
                <tr key={l.learner_id} className={savingId === l.learner_id ? "opacity-60" : ""}>
                  <td className="px-4 py-3 text-sm text-gray-700 font-mono">{l.admission_number}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{l.first_name} {l.last_name}</td>
                  <td className="px-4 py-3">
                    <select
                      className="input-field max-w-[9rem] py-1 text-sm"
                      value={l.grade_label || ""}
                      onChange={(e) => handleAssign(l.learner_id, `${l.first_name} ${l.last_name}`, { grade_label: e.target.value })}
                    >
                      {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                      {!grades.includes(l.grade_label || "") && l.grade_label && <option value={l.grade_label}>{l.grade_label}</option>}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input-field max-w-[9rem] py-1 text-sm"
                      value={l.stream_name || ""}
                      onChange={(e) => handleAssign(l.learner_id, `${l.first_name} ${l.last_name}`, { stream_name: e.target.value })}
                    >
                      <option value="">—</option>
                      {cols.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><Badge variant="default">{l.status}</Badge></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">{'No learners'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
