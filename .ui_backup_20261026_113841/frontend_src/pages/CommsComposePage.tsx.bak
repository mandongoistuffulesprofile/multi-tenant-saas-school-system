import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";

export default function CommsComposePage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { t } = useTranslation();

  // Load templates on mount.
  if (templates.length === 0) {
    api.get("/comms/templates").then((res) => {
      const list = res.data || [];
      setTemplates(list);
      if (list.length > 0) {
        setSelectedTemplate(list[0].template_id);
        setBody(list[0].body_text);
      }
    });
  }

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = templates.find((x) => x.template_id === templateId);
    if (tpl) setBody(tpl.body_text);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await api.post("/comms/messages", {
        template_id: selectedTemplate,
        body_text: body,
      });
      alert("Message sent");
    } catch {
      alert("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Compose Message</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div>
            <label className="label">Template</label>
            <select className="input-field" value={selectedTemplate} onChange={(e) => handleTemplateChange(e.target.value)}>
              <option value="">Select a template…</option>
              {templates.map((tpl) => (
                <option key={tpl.template_id} value={tpl.template_id}>{tpl.template_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Message Body</label>
            <textarea
              className="input-field min-h-[160px] resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your message…"
            />
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={handleSend} disabled={sending || !body}>
              {sending ? "Sending…" : "Send Message"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}