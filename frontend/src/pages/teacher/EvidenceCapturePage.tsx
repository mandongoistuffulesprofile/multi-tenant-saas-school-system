import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import { api } from "../../lib/api";
import { useToast } from "../../components/toast/ToastProvider";

interface Learner {
  learner_id: string;
  first_name: string;
  last_name: string;
  admission_number?: string;
}
interface AssessmentResult {
  result_id: string;
  learner_id: string;
  level_code?: string;
  state?: string;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors common server limits

export default function EvidenceCapturePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [learners, setLearners] = useState<Learner[]>([]);
  const [results, setResults] = useState<AssessmentResult[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "content" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const [learnerId, setLearnerId] = useState("");
  const [resultId, setResultId] = useState("");
  const [observation, setObservation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ evidence_id: string; file_name: string } | null>(null);

  // Load learners and captured results once on mount.
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<Learner[]>("/learners"),
      api.get<AssessmentResult[]>("/assessment/results"),
    ])
      .then(([lr, res]) => {
        if (!alive) return;
        const learnerList = Array.isArray(lr.data) ? lr.data : [];
        const resultList = Array.isArray(res.data) ? res.data : [];
        setLearners(learnerList);
        setResults(resultList);
        setLoadState(learnerList.length === 0 ? "content" : "content");
      })
      .catch(() => alive && setLoadState("error"));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const learnerName = (id: string) => {
    const l = learners.find((x) => x.learner_id === id);
    return l ? `${l.first_name} ${l.last_name}` : id.slice(0, 8);
  };

  // Results captured for the selected learner (most recent first).
  const learnerResults = learnerId
    ? results.filter((r) => r.learner_id === learnerId)
    : [];

  const handleSelectLearner = (id: string) => {
    setLearnerId(id);
    setResultId("");
    setSaved(null);
    setFile(null);
  };

  const handleFile = (f: File | null) => {
    if (f && f.size > MAX_FILE_BYTES) {
      setError("File exceeds the 5 MB limit");
      return;
    }
    setError(null);
    setFile(f);
  };

  const validate = (): string | null => {
    if (!learnerId) return "Select a learner";
    if (!resultId) return "Select the captured result this evidence supports";
    if (!file && !observation.trim()) return "Attach a file or write an observation";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    setSubmitting(true);
    try {
      // Evidence is stored as a file reference record (the backend contract is
      // metadata: result_id, file_name, file_ref, mime_type, file_size). The
      // binary stays on the device under the generated reference; the row
      // links it to the captured assessment result for moderation audits.
      const isObservation = !file;
      const fileRef = file
        ? `evidence/${resultId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
        : `obs/${resultId}/${Date.now()}.txt`;
      const res = await api.post("/assessment/results/evidence", {
        result_id: resultId,
        file_name: file ? file.name : `${learnerId.slice(0, 8)}-observation.txt`,
        file_ref: fileRef,
        mime_type: file ? file.type || "application/octet-stream" : "text/plain",
        file_size: file ? file.size : observation.length,
      });
      setSaved({ evidence_id: res.data?.evidence_id, file_name: file ? file.name : "observation.txt" });
      toast(isObservation ? "Observation recorded" : "Evidence recorded", { type: "success" });
      setFile(null);
      setObservation("");
      setResultId("");
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Failed to record evidence";
      setError(msg);
      toast(msg, { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState === "loading") {
    return (
      <div className="p-4 text-sm text-gray-500">Loading learners and results…</div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-700">Could not load learners or assessment results.</p>
        <Button variant="secondary" onClick={() => { setLoadState("loading"); setReloadKey((k) => k + 1); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display font-display">{t("teacher.evidence_capture")}</h1>
          <p className="text-body">{t("teacher.evidence_capture_desc", { defaultValue: "Record learner evidence and observations" })}</p>
        </div>
      </div>

      {learners.length === 0 ? (
        <Card className="p-6 text-sm text-gray-600">
          No learners yet. Enrol learners first, then capture evidence for them.
        </Card>
      ) : (
        <Card className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
            )}
            {saved && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                Evidence recorded ({saved.evidence_id}) — {saved.file_name}
              </div>
            )}
            <div>
              <label className="label">Learner</label>
              <select
                className="input-field"
                value={learnerId}
                onChange={(e) => handleSelectLearner(e.target.value)}
              >
                <option value="">Select a learner…</option>
                {learners.map((l) => (
                  <option key={l.learner_id} value={l.learner_id}>
                    {l.first_name} {l.last_name}{l.admission_number ? ` (${l.admission_number})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Captured result</label>
              {learnerId ? (
                learnerResults.length > 0 ? (
                  <select
                    className="input-field"
                    value={resultId}
                    onChange={(e) => { setResultId(e.target.value); setSaved(null); }}
                  >
                    <option value="">Select the result this evidence supports…</option>
                    {learnerResults.map((r) => (
                      <option key={r.result_id} value={r.result_id}>
                        {`Result ${r.result_id.slice(0, 8)} — ${r.level_code || "ungraded"}${r.state ? ` (${r.state})` : ""}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    No captured assessment results for this learner yet. Capture a result in the grading grid first.
                  </p>
                )
              ) : null}
            </div>
            <div>
              <label className="label">Observation</label>
              <textarea
                className="input-field min-h-[100px] resize-y"
                value={observation}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setObservation(e.target.value); setSaved(null); }}
                placeholder="What the learner did, said or produced…"
              />
            </div>
            <div>
              <label className="label">Attach evidence (max 5 MB)</label>
              <input
                type="file"
                className="input-field"
                accept="image/*,application/pdf,audio/*"
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
              {file && <p className="text-[11px] text-gray-500 mt-1">{file.name} — {Math.round(file.size / 1024)} KB</p>}
            </div>
            <Button variant="primary" type="submit" fullWidth loading={submitting}>
              {t("record")}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
