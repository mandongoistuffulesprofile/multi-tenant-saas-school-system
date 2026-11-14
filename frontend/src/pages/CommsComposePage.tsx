import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useApiDeduper } from "../lib/mutationDeduper";
import { useToast } from "../components/toast/ToastProvider";

interface Template {
  template_id: string;
  template_name: string;
  body_text?: string;
  is_active?: boolean;
}
interface Grade {
  grade_id: string;
  grade_label: string;
}
type AudienceMode = "ALL" | "GRADE" | "STREAM" | "ARREARS";
type Channel = "SMS" | "WHATSAPP" | "EMAIL";

export default function CommsComposePage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "content" | "error">("loading");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [broadcastName, setBroadcastName] = useState("");
  const [channel, setChannel] = useState<Channel>("SMS");
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("ALL");
  const [gradeIds, setGradeIds] = useState<string[]>([]);
  const [arrearsOver, setArrearsOver] = useState("0");
  const [saving, setSaving] = useState(false);
  const [sendState, setSendState] = useState<"draft" | "sending" | "sent">("draft");
  const [result, setResult] = useState<{ broadcast_id: string; total_recipients: number; excluded_no_consent?: number } | null>(null);
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const createAndSendBroadcast = useApiDeduper();

  // Load templates and grades once on mount (never during render).
  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get("/comms/templates"),
      api.get("/structure/grades").catch(() => ({ data: [] })),
    ])
      .then(([tpl, gr]) => {
        if (!alive) return;
        const list = Array.isArray(tpl.data) ? tpl.data : [];
        setTemplates(list);
        setGrades(Array.isArray(gr.data) ? gr.data : []);
        if (list.length > 0) {
          setSelectedTemplate(list[0].template_id);
          setBody(list[0].body_text || "");
        }
        setLoadState("content");
      })
      .catch(() => alive && setLoadState("error"));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (loadState !== "content") return;
    // On the first stable composition load, focus the message body so the
    // writer can continue typing immediately. Do not focus on intermediate
    // template reloads mid-editing.
    const t0 = performance.now();
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== bodyRef.current) {
        bodyRef.current?.focus();
      }
      // Keep this effect cheap and visual; never block render.
      if (import.meta.env.DEV) {
        console.debug("CommsCompose: autofocused body", performance.now() - t0);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [loadState]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = templates.find((x) => x.template_id === templateId);
    setBody(tpl?.body_text || "");
  };

  const toggleGrade = (id: string) => {
    setGradeIds((gs) => (gs.includes(id) ? gs.filter((g) => g !== id) : [...gs, id]));
  };

  const validate = (): string | null => {
    if (!body.trim()) return "Message body is required";
    if (audienceMode === "GRADE" || audienceMode === "STREAM") {
      if (gradeIds.length === 0) return "Select at least one grade";
    }
    if (audienceMode === "ARREARS") {
      const over = Number(arrearsOver);
      if (!Number.isFinite(over) || over < 0) return "Arrears threshold must be a non-negative number";
    }
    return null;
  };

  const audience = () => ({
    target_audience: audienceMode,
    target_grade_ids: audienceMode === "GRADE" || audienceMode === "STREAM" ? gradeIds : undefined,
    arrears_over: audienceMode === "ARREARS" ? Number(arrearsOver) : undefined,
  });

  const handleCreateAndSend = async (sendNow: boolean) => {
    if (!createAndSendBroadcast()) return;
    const problem = validate();
    setComposeError(problem);
    if (problem) return;
    setSaving(true);
    setSendState("sending");
    try {
      const res = await api.post("/comms/broadcasts", {
        broadcast_name: broadcastName.trim() || `Compose ${new Date().toISOString().slice(0, 10)}`,
        channel,
        subject: subject.trim() || undefined,
        body_text: body,
        template_id: selectedTemplate || undefined,
        audience: audience(),
      });
      const broadcastId = res.data?.broadcast_id;
      setResult({
        broadcast_id: broadcastId,
        total_recipients: res.data?.total_recipients ?? 0,
        excluded_no_consent: res.data?.excluded_no_consent ?? 0,
      });
      if (sendNow && broadcastId) {
        await api.post(`/comms/broadcasts/${broadcastId}/send`);
        setSendState("sent");
        toast(`Message queued for ${res.data?.total_recipients ?? 0} recipient(s)`, { type: "success" });
      } else {
        setSendState("draft");
        toast(`Broadcast saved: ${res.data?.total_recipients ?? 0} recipient(s), ${res.data?.excluded_no_consent ?? 0} excluded (no consent)`, { type: "success" });
      }
    } catch (err: any) {
      setSendState("draft");
      const msg = err?.response?.data?.message || "Failed to create broadcast";
      setComposeError(msg);
      toast(msg, { type: "error" });
    } finally {
      setSaving(false);
      createAndSendBroadcast.reset();
    }
  };

  if (loadState === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex items-center justify-center text-gray-500 text-sm">
        Loading templates…
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-700">Could not load templates.</p>
        <button
          className="btn-secondary"
          onClick={() => { setReloadKey((k) => k + 1); setLoadState("loading"); }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Compose Broadcast</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          {composeError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{composeError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Template</label>
              <select className="input-field" value={selectedTemplate} onChange={(e) => handleTemplateChange(e.target.value)}>
                <option value="">Free-form (no template)</option>
                {templates.map((tpl) => (
                  <option key={tpl.template_id} value={tpl.template_id}>{tpl.template_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Channel</label>
              <select className="input-field" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Recipients</label>
            <select className="input-field" value={audienceMode} onChange={(e) => setAudienceMode(e.target.value as AudienceMode)}>
              <option value="ALL">All Parents</option>
              <option value="GRADE">Specific Grade</option>
              <option value="STREAM">Specific Stream</option>
              <option value="ARREARS">Fee Defaulters (balance over KES)</option>
            </select>
          </div>

          {(audienceMode === "GRADE" || audienceMode === "STREAM") && (
            <div>
              <label className="label">{audienceMode === "GRADE" ? "Grades" : "Streams (by grade)"}</label>
              {grades.length === 0 ? (
                <p className="text-xs text-gray-500">No grades configured yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-1">
                  {grades.map((g) => (
                    <button
                      key={g.grade_id}
                      type="button"
                      onClick={() => toggleGrade(g.grade_id)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition ${
                        gradeIds.includes(g.grade_id)
                          ? "bg-kenyan-red text-white border-kenyan-red"
                          : "bg-white text-gray-700 border-gray-300 hover:border-kenyan-red"
                      }`}
                    >
                      {g.grade_label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {audienceMode === "ARREARS" && (
            <div>
              <label className="label">Outstanding balance over (KES)</label>
              <input
                className="input-field"
                type="number"
                min={0}
                value={arrearsOver}
                onChange={(e) => setArrearsOver(e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Broadcast Name</label>
              <input
                className="input-field"
                value={broadcastName}
                onChange={(e) => setBroadcastName(e.target.value)}
                placeholder="e.g. Term 2 fees reminder"
              />
            </div>
            <div>
              <label className="label">Subject (email/WhatsApp only)</label>
              <input className="input-field" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Message Body</label>
            <textarea
              ref={bodyRef}
              className="input-field min-h-[160px] resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message…"
            />
          </div>

          {result && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              Broadcast saved ({result.total_recipients} recipient(s)
              {result.excluded_no_consent ? `, ${result.excluded_no_consent} excluded — no consent` : ""}).
              {sendState === "sent" ? " Queued for delivery." : " Use “Send” below to queue delivery."}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              className="btn-secondary"
              disabled={saving || sendState === "sending"}
              onClick={() => handleCreateAndSend(false)}
            >
              {saving ? "Saving…" : "Save & Preview Recipients"}
            </button>
            <button
              className="btn-primary"
              disabled={saving || sendState === "sending"}
              onClick={() => handleCreateAndSend(true)}
            >
              {sendState === "sending" ? "Sending…" : "Send Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
