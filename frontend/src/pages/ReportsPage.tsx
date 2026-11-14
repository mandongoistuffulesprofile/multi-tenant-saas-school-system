import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

type ReportTemplate = {
  template_id: string;
  tenant_id: string;
  template_name: string;
  template_type: string;
  grade_band: string;
  is_default: boolean;
  is_active: boolean;
  template_config: Record<string, any>;
  created_at: string;
};

export default function ReportsPage() {
  const [generating, setGenerating] = useState(false);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingRunId, setPublishingRunId] = useState("");
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    template_name: "",
    template_type: "CBC",
    grade_band: "LOWER_PRIMARY",
    template_config: {},
    is_default: false,
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [grading, setGrading] = useState<{ scale: string; show_aggregate: boolean; show_position: boolean; cutoffs?: Record<string, number> }>({ scale: "AUTO", show_aggregate: false, show_position: false });
  const [savingGrading, setSavingGrading] = useState(false);
  const { t } = useTranslation();
  const { toast } = useToast();

  const handleGenerateRun = async (termId?: string) => {
    const template = templates.find((tpl: any) => tpl.is_default) ?? templates[0];
    if (!template) {
      toast("No report template is configured for this school.", { type: "error" });
      return;
    }
    setGenerating(true);
    try {
      await api.post("/reports/runs", {
        term_id: termId || "current",
        template_id: template.template_id,
      });
      toast("Report cards generation initiated!", { type: "success" });
      const [rRes, cRes] = await Promise.all([
        api.get("/reports/runs"),
        api.get("/reports/cards"),
      ]);
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);
      setCards(Array.isArray(cRes.data) ? cRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to generate report run", { type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const loadTemplates = async () => {
    const res = await api.get("/reports/templates");
    setTemplates(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    Promise.all([
      api.get("/reports/templates"),
      api.get("/reports/runs"),
      api.get("/reports/cards"),
    ]).then(([tRes, rRes, cRes]) => {
      setTemplates(Array.isArray(tRes.data) ? tRes.data : []);
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);
      setCards(Array.isArray(cRes.data) ? cRes.data : []);
    }).catch(() => {})
      .finally(() => setLoading(false));
    api.get("/grading/settings")
      .then((res) => {
        const cfg = res.data?.config;
        if (cfg) {
          setGrading({
            scale: cfg.scale || "AUTO",
            show_aggregate: cfg.show_aggregate === true,
            show_position: cfg.show_position === true,
            cutoffs: cfg.cutoffs || undefined,
          });
        }
      })
      .catch(() => { /* settings remain at compliant defaults */ });
  }, []);

  const saveGrading = async () => {
    setSavingGrading(true);
    try {
      const res = await api.patch("/grading/settings", grading);
      const cfg = res.data?.config || grading;
      setGrading({
        scale: cfg.scale || "AUTO",
        show_aggregate: cfg.show_aggregate === true,
        show_position: cfg.show_position === true,
        cutoffs: cfg.cutoffs || grading.cutoffs,
      });
      toast("Report card grading rules saved", { type: "success" });
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save grading rules", { type: "error" });
    } finally {
      setSavingGrading(false);
    }
  };

  const openCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ template_name: "", template_type: "CBC", grade_band: "LOWER_PRIMARY", template_config: {}, is_default: false });
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (tpl: ReportTemplate) => {
    setEditingTemplate(tpl);
    setTemplateForm({
      template_name: tpl.template_name,
      template_type: tpl.template_type,
      grade_band: tpl.grade_band,
      template_config: tpl.template_config || {},
      is_default: tpl.is_default,
    });
    setTemplateModalOpen(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.template_name.trim() || !templateForm.template_type || !templateForm.grade_band) {
      toast("Fill all required fields", { type: "error" });
      return;
    }
    setSavingTemplate(true);
    try {
      if (editingTemplate) {
        await api.put(`/reports/templates/${editingTemplate.template_id}`, {
          template_name: templateForm.template_name.trim(),
          grade_band: templateForm.grade_band,
          template_config: templateForm.template_config,
          is_active: true,
          is_default: templateForm.is_default,
        });
        toast("Template updated", { type: "success" });
      } else {
        await api.post("/reports/templates", {
          template_name: templateForm.template_name.trim(),
          template_type: templateForm.template_type,
          grade_band: templateForm.grade_band,
          template_config: templateForm.template_config,
          is_default: templateForm.is_default,
        });
        toast("Template created", { type: "success" });
      }
      setTemplateModalOpen(false);
      setEditingTemplate(null);
      await loadTemplates();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to save template", { type: "error" });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm("Deactivate this template? It will no longer be available for new runs.")) return;
    try {
      await api.delete(`/reports/templates/${id}`);
      toast("Template deactivated", { type: "success" });
      await loadTemplates();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to deactivate", { type: "error" });
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.put(`/reports/templates/${id}`, { is_default: true });
      toast("Default template set", { type: "success" });
      await loadTemplates();
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to set default", { type: "error" });
    }
  };

  const publishRun = async (run: any) => {
    const id = run.run_id || run.id;
    if (!id) return;
    setPublishingRunId(id);
    try {
      const res = await api.post(`/reports/runs/${id}/publish`);
      toast(`Published ${res.data?.published ?? 0} report card(s)`, { type: "success" });
      const [rRes, cRes] = await Promise.all([
        api.get("/reports/runs"),
        api.get("/reports/cards"),
      ]);
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);
      setCards(Array.isArray(cRes.data) ? cRes.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to publish run", { type: "error" });
    } finally {
      setPublishingRunId("");
    }
  };

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      CBC: "bg-blue-100 text-blue-700",
      KPSEA: "bg-purple-100 text-purple-700",
      KJSEA: "bg-indigo-100 text-indigo-700",
      CUSTOM: "bg-gray-100 text-gray-700",
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type] || "bg-gray-100 text-gray-700"}`}>{type}</span>;
  };

  const bandBadge = (band: string) => {
    const colors: Record<string, string> = {
      PRE_PRIMARY: "bg-pink-100 text-pink-700",
      LOWER_PRIMARY: "bg-green-100 text-green-700",
      UPPER_PRIMARY: "bg-blue-100 text-blue-700",
      JUNIOR_SECONDARY: "bg-purple-100 text-purple-700",
    };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[band] || "bg-gray-100 text-gray-700"}`}>{band}</span>;
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading">Reports</h2>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={openCreateTemplate}>Manage Templates</button>
              <button
                className="btn-primary"
                onClick={() => handleGenerateRun()}
                disabled={generating}
              >
                {generating ? "Generating…" : "Generate Report Cards"}
              </button>
            </div>
          </div>

          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Templates</h3>
                  <p className="text-3xl font-bold text-kenyan-red">{templates.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Runs</h3>
                  <p className="text-3xl font-bold text-kenyan-green">{runs.length}</p>
                </div>
                <div className="card p-6">
                  <h3 className="text-caption uppercase tracking-wide mb-2">Report Cards</h3>
                  <p className="text-3xl font-bold text-gray-900">{cards.length}</p>
                </div>
              </div>

              {/* Grading and report-card policy. Aggregates and ranking are
                  opt-in because the CBC card reports achievement levels. */}
              <div className="card p-6 mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-caption uppercase tracking-wide">Grading &amp; Report Card Rules</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Applied when a run is published. Published cards are frozen, so changes only affect future publications.
                    </p>
                  </div>
                  <button className="btn-primary" onClick={saveGrading} disabled={savingGrading}>
                    {savingGrading ? "Saving…" : "Save Rules"}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="text-sm">
                    <span className="block font-medium mb-1">Performance scale</span>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-2"
                      value={grading.scale}
                      onChange={(e) => setGrading({ ...grading, scale: e.target.value })}
                    >
                      <option value="AUTO">Automatic (4-band PP1–G3, 8-point G4–G9)</option>
                      <option value="FOUR_BAND">4-band for all grades (EE–BE)</option>
                      <option value="EIGHT_POINT">8-point for all grades (EE1–BE2)</option>
                    </select>
                  </label>
                  <label className="text-sm flex items-start gap-2 mt-6">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={grading.show_aggregate}
                      onChange={(e) => setGrading({ ...grading, show_aggregate: e.target.checked })}
                    />
                    <span>
                      <span className="block font-medium">Show aggregate summary</span>
                      <span className="block text-xs text-gray-500">Adds total, percentage and overall grade to the card. Off by default.</span>
                    </span>
                  </label>
                  <label className="text-sm flex items-start gap-2 mt-6">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={grading.show_position}
                      onChange={(e) => setGrading({ ...grading, show_position: e.target.checked })}
                    />
                    <span>
                      <span className="block font-medium">Show class position</span>
                      <span className="block text-xs text-gray-500">Ranks learners within the run. Off by default and never applied to KNEC bands.</span>
                    </span>
                  </label>
                </div>
              </div>

              {/* Templates Section */}
              <div className="card p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-caption uppercase tracking-wide">Report Templates</h3>
                  <button className="btn-primary" onClick={openCreateTemplate}>Add Template</button>
                </div>
                {templates.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No templates yet — create one above to enable report card generation.
                  </p>
                ) : (
                  <DataTable
                    data={templates}
                    emptyMessage="No templates"
                    columns={[
                      { key: "template_name", header: "Name" },
                      { key: "template_type", header: "Type", render: (r) => typeBadge(r.template_type) },
                      { key: "grade_band", header: "Grade Band", render: (r) => bandBadge(r.grade_band) },
                      { key: "is_default", header: "Default", render: (r) => r.is_default ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Yes</span>
                      ) : (
                        <button className="px-2 py-1 text-xs text-kenyan-red hover:underline" onClick={() => handleSetDefault(r.template_id)}>Set Default</button>
                      ) },
                      { key: "is_active", header: "Status", render: (r) => r.is_active ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>
                      ) },
                      { key: "actions", header: "Actions", render: (r) => (
                        <div className="flex gap-2">
                          <button className="px-3 py-1 text-sm text-kenyan-red hover:underline" onClick={() => openEditTemplate(r)}>Edit</button>
                          {r.is_active && <button className="px-3 py-1 text-sm text-red-600 hover:underline" onClick={() => handleDeleteTemplate(r.template_id)}>Deactivate</button>}
                        </div>
                      )},
                    ]}
                  />
                )}
              </div>

              {/* Report Runs */}
              <div className="card p-6 mb-6">
                <h3 className="text-caption uppercase tracking-wide mb-3">Report Runs</h3>
                {runs.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No runs yet — generate cards for the current term above.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-2">Run</th>
                        <th className="pb-2">Term</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run: any) => (
                        <tr key={run.run_id || run.id} className="border-t border-gray-100">
                          <td className="py-2 font-mono text-xs">{String(run.run_id || run.id).slice(0, 8)}</td>
                          <td className="py-2">{run.term_id || run.academic_year_id || "—"}</td>
                          <td className="py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                run.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {run.status || "PENDING"}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            {run.status === "PUBLISHED" ? (
                              <button
                                className="px-3 py-1 rounded-lg border border-kenyan-red text-kenyan-red text-xs font-medium hover:bg-red-50 disabled:opacity-50"
                                disabled={publishingRunId !== ""}
                                onClick={() => publishRun(run)}
                                title="Creates revision N+1 with the latest results and national bands"
                              >
                                {publishingRunId === (run.run_id || run.id) ? "Issuing…" : "Issue correction"}
                              </button>
                            ) : (
                              <button
                                className="px-3 py-1 rounded-lg bg-kenyan-red text-white text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
                                disabled={publishingRunId !== ""}
                                onClick={() => publishRun(run)}
                              >
                                {publishingRunId === (run.run_id || run.id) ? "Publishing…" : "Publish"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Report Cards */}
              <DataTable
                data={cards}
                emptyMessage="No report cards found"
                columns={[
                  { key: "card_number", header: "Card No." },
                  { key: "learner_id", header: "Learner", render: (r) => r.learner_name || r.learner_id },
                  { key: "grade_id", header: "Grade" },
                  { key: "status", header: "Status" },
                  { key: "percentage", header: "Percentage", render: (r) => r.percentage != null ? `${r.percentage}%` : "—" },
                  { key: "action", header: "Action", sortable: false, render: (r) => (
                    r.card_id ? <a href={`/reports/cards/${r.card_id}/print`} className="text-kenyan-red underline text-sm">View / Print</a> : "—"
                  ) },
                ]}
              />
            </>
          )}

          {/* Template Modal */}
          <Dialog open={templateModalOpen} onClose={() => { setTemplateModalOpen(false); setEditingTemplate(null); }} title={editingTemplate ? "Edit Template" : "Create Template"} className="max-w-2xl">
            <form onSubmit={handleSaveTemplate}>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Template Name *<HelpTip text="e.g. CBC Term 1 2024, KPSEA 2024" /></span>
                <input
                  type="text"
                  required
                  value={templateForm.template_name}
                  onChange={(e) => setTemplateForm({ ...templateForm, template_name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Type *</span>
                  <select
                    required
                    value={templateForm.template_type}
                    onChange={(e) => setTemplateForm({ ...templateForm, template_type: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                  >
                    <option value="CBC">CBC</option>
                    <option value="KPSEA">KPSEA</option>
                    <option value="KJSEA">KJSEA</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Grade Band *</span>
                  <select
                    required
                    value={templateForm.grade_band}
                    onChange={(e) => setTemplateForm({ ...templateForm, grade_band: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                  >
                    <option value="PRE_PRIMARY">Pre-Primary (PP1-PP2)</option>
                    <option value="LOWER_PRIMARY">Lower Primary (G1-G3)</option>
                    <option value="UPPER_PRIMARY">Upper Primary (G4-G6)</option>
                    <option value="JUNIOR_SECONDARY">Junior Secondary (G7-G9)</option>
                  </select>
                </label>
              </div>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Default Template</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={templateForm.is_default}
                    onChange={(e) => setTemplateForm({ ...templateForm, is_default: e.target.checked })}
                  />
                  <span className="text-sm">Use as default for new report runs</span>
                </label>
              </label>
              <label style={{ display: "block", marginBottom: "0.75rem" }}>
                <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>Template Config (JSON)</span>
                <textarea
                  value={JSON.stringify(templateForm.template_config, null, 2)}
                  onChange={(e) => {
                    try {
                      setTemplateForm({ ...templateForm, template_config: JSON.parse(e.target.value) });
                    } catch {
                      // ignore invalid JSON while typing
                    }
                  }}
                  rows={6}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6, fontFamily: "monospace", fontSize: "0.8rem" }}
                  placeholder='{"sections": [{"name": "Academic", "areas": ["Mathematics", "English", "Kiswahili"]}]}'
                />
              </label>
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <button type="button" onClick={() => { setTemplateModalOpen(false); setEditingTemplate(null); }} style={{ padding: "0.5rem 1rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={savingTemplate}>
                  {savingTemplate ? "Saving…" : editingTemplate ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}