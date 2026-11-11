import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import Card from "../../components/atoms/Card";
import Button from "../../components/atoms/Button";
import Input from "../../components/atoms/Input";
import ViewState from "../../components/organisms/ViewState";
import { Learner } from "../../lib/types";
import { useToast } from "../../components/toast/ToastProvider";

export default function LearnerRemarksPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [remark, setRemark] = useState("");
  const [learningAreaId, setLearningAreaId] = useState("GENERAL");
  const [publishing, setPublishing] = useState(false);
  const [headComment, setHeadComment] = useState("");

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    if (!selectedLearnerId) { setCards([]); setSelectedCardId(""); return; }
    api.get("/reports/cards", { params: { learner_id: selectedLearnerId } })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        setCards(list);
        setSelectedCardId(list[0]?.card_id || "");
      })
      .catch(() => { setCards([]); setSelectedCardId(""); });
  }, [selectedLearnerId]);

  const selectedLearner = useMemo(() => learners.find((l) => l.learner_id === selectedLearnerId) || null, [learners, selectedLearnerId]);

  const submitRemark = async () => {
    if (!selectedCardId) { toast("Select a report card for this learner", { type: "error" }); return; }
    if (!remark.trim()) { toast("Enter a remark", { type: "error" }); return; }
    setPublishing(true);
    try {
      await api.post(`/reports/cards/${selectedCardId}/comments`, {
        learning_area_id: learningAreaId.trim() || "GENERAL",
        comment_text: remark.trim(),
      });
      if (headComment.trim()) {
        await api.put(`/reports/cards/${selectedCardId}/head-comment`, { head_teacher_comment: headComment.trim() });
      }
      toast("Remark saved to report card", { type: "success" });
      setRemark("");
    } catch (e: any) {
      toast(e?.response?.data?.message || "Could not save remark", { type: "error" });
    } finally {
      setPublishing(false);
    }
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => window.location.reload()} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("teacher.learner_remarks", { defaultMessage: "Learner Remarks" })}</h1>
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label block mb-1">Learner</label>
            <select className="input-field w-full" value={selectedLearnerId} onChange={(e) => setSelectedLearnerId(e.target.value)}>
              <option value="">Select learner…</option>
              {learners.map((l) => <option key={l.learner_id} value={l.learner_id}>{l.first_name} {l.last_name} ({l.admission_number})</option>)}
            </select>
          </div>
          <div>
            <label className="label block mb-1">Report card</label>
            <select className="input-field w-full" value={selectedCardId} onChange={(e) => setSelectedCardId(e.target.value)} disabled={!selectedLearnerId}>
              <option value="">{cards.length ? "Select report card…" : "No report cards for learner"}</option>
              {cards.map((c) => (
                <option key={c.card_id} value={c.card_id}>
                  {(c.card_number || c.card_id)} · {c.grade_id || ""} · {c.status}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedLearner && (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <span className="font-medium">{selectedLearner.first_name} {selectedLearner.last_name}</span>
              <span className="text-gray-500"> · {selectedLearner.admission_number} · {selectedLearner.grade_label || "—"}</span>
            </div>
            <div>
              <label className="label block mb-1">Learning area / strand code</label>
              <Input value={learningAreaId} onChange={(e) => setLearningAreaId(e.target.value)} placeholder="e.g. MATH, ENG, GENERAL" />
            </div>
            <div>
              <label className="label block mb-1">Teacher remark</label>
              <textarea className="input-field w-full min-h-[100px]" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Write remark for this learning area…" />
            </div>
            <div>
              <label className="label block mb-1">Head teacher comment (optional)</label>
              <Input value={headComment} onChange={(e) => setHeadComment(e.target.value)} placeholder="Overall/head teacher comment" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setRemark(""); setHeadComment(""); }}>Clear</Button>
              <Button variant="primary" loading={publishing} disabled={!selectedCardId} onClick={submitRemark}>
                {t("teacher.publish", { defaultMessage: "Save remark" })}
              </Button>
            </div>
            {!cards.length && selectedLearnerId && (
              <p className="text-xs text-amber-700">No report cards found for this learner. Generate/publish report cards first.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
