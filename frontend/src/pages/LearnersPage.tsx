import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import Button from "../components/atoms/Button";
import Input from "../components/atoms/Input";
import { FormField } from "../components/molecules/FormField";
import ViewState from "../components/organisms/ViewState";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import { useToast } from "../components/toast/ToastProvider";
import { Learner, LearnerCreateRequest } from "../lib/types";
import { SponsorshipBadge } from "../components/learners/SponsorshipBadge";
import { FloatingBulkDock } from "../components/ui/FloatingBulkDock";

const GRADES = ["PP1", "PP2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"];
const STREAMS = ["East", "West", "North", "South"];
const GENDERS = ["Male", "Female"];
const BOARDING_OPTIONS = [
  { value: "DAY", labelKey: "day_scholar" },
  { value: "BOARDING", labelKey: "boarding" },
];

export default function LearnersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>({
    admission_number: "", upi_nemis_number: "", first_name: "", middle_name: "",
    last_name: "", date_of_birth: "", gender: "", status: "ACTIVE", admitted_on: "",
    boarding_type: "DAY", grade_label: "Grade 1", stream_name: "East",
    guardian_name: "", guardian_phone: "", guardian_email: "", guardian_relationship: "PARENT",
    fee_category: "TUITION", fee_agreed: true
  });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [streamFilter, setStreamFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get<Learner[]>("/learners")
      .then((r) => { setLearners(Array.isArray(r.data) ? r.data : []); setState("content"); })
      .catch(() => setState("error"));
    const safety = setTimeout(() => setState((s) => (s === "loading" ? "content" : s)), 2500);
    return () => clearTimeout(safety);
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((l) => l.learner_id)));
    }
  };

  const isSelected = (id: string) => selected.has(id);

  const filtered = learners.filter((l) => {
    const matchQ =
      l.first_name.toLowerCase().includes(q.toLowerCase()) ||
      l.last_name.toLowerCase().includes(q.toLowerCase()) ||
      l.admission_number.toLowerCase().includes(q.toLowerCase());
    return (
      matchQ &&
      (gradeFilter ? l.grade_label === gradeFilter : true) &&
      (streamFilter ? l.stream_name === streamFilter : true)
    );
  });

  const isLastStep = step === 2;
  const nextStep = () => setStep((s) => (s < 2 ? s + 1 : s));
  const prevStep = () => setStep((s) => (s > 0 ? s - 1 : s));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      guardians: form.guardian_phone ? [{
        full_name: form.guardian_name || `${form.last_name} Guardian`,
        phone_number: form.guardian_phone,
        email: form.guardian_email,
        relationship: form.guardian_relationship,
        is_emergency_contact: true
      }] : []
    };
    api.post("/learners", payload)
      .then(() => {
        setOpen(false);
        setStep(0);
        api.get<Learner[]>("/learners").then((r) => setLearners(Array.isArray(r.data) ? r.data : []));
      })
      .catch((err) => {
        toast(err.response?.data?.message || "Failed to create learner", { type: "error" });
      })
      .finally(() => setSaving(false));
  };

  const handleBatchInvoice = () => {
    toast(`Batch invoice prepared for ${selected.size} learner(s)`, { type: "info" });
    setSelected(new Set());
  };

  const handleExportCsv = () => {
    toast(`Exporting ${selected.size} learner record(s)`, { type: "info" });
    setSelected(new Set());
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" onRetry={() => setState("loading")} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-display">{t("learners")}</h1>
          <p className="text-body">{t("learner_registry")}</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t("add_learner")}
        </Button>
      </div>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="relative">
            <Input placeholder={t("search_learners")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="label">{t("grade")}</label>
            <select className="input-field" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
              <option value="">{t("all_grades")}</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="label">{t("stream")}</label>
            <select className="input-field" value={streamFilter} onChange={(e) => setStreamFilter(e.target.value)}>
              <option value="">{t("all_streams")}</option>
              {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <DataTable
          data={filtered}
          loading={false}
          columns={[
            { key: "select", header: "", sortable: false, className: "w-10", render: (row) => (
              <input
                type="checkbox"
                checked={isSelected(row.learner_id)}
                onChange={() => toggleSelect(row.learner_id)}
                className="rounded border-gray-300 text-slate-900 focus:ring-slate-900"
              />
            )},
            { key: "admission_number", header: t("admission_number"), sortable: true },
            { key: "first_name", header: t("first_name"), sortable: true },
            { key: "last_name", header: t("last_name"), sortable: true },
            { key: "grade_label", header: t("grade"), sortable: true },
            { key: "stream_name", header: t("stream"), sortable: true },
            { key: "guardian_phone", header: t("phone"), sortable: true },
            {
              key: "sponsorship",
              header: t("sponsorship"),
              sortable: false,
              render: (row) => <SponsorshipBadge />,
            },
            { key: "status", header: t("status"), render: (row) => <Badge variant="default">{row.status}</Badge> },
          ]}
          emptyMessage={t("no_learners")}
          keyField="learner_id"
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
            {selected.size > 0 ? t("clear_selection") : t("select_all")}
          </Button>
          <Button variant="secondary" size="sm">{t("bulk_import")}</Button>
          <Button variant="ghost" size="sm">{t("export")}</Button>
        </div>
      </Card>

      {selected.size > 0 && (
        <FloatingBulkDock
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          onBatchInvoice={handleBatchInvoice}
          onExportCsv={handleExportCsv}
        />
      )}

      <Dialog open={open} onClose={() => { setOpen(false); setStep(0); }} title={t("add_learner")} className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {step === 0 && (
            <>
              <div className="text-caption text-muted">{t("wizard.step_personal")}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label={t("admission_number")} required>
                  <Input required value={form.admission_number} onChange={(e) => setForm({ ...form, admission_number: e.target.value })} />
                </FormField>
                <FormField label="UPI / NEMIS No.">
                  <Input value={form.upi_nemis_number} onChange={(e) => setForm({ ...form, upi_nemis_number: e.target.value })} />
                </FormField>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label={t("first_name")} required>
                  <Input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                </FormField>
                <FormField label={t("last_name")} required>
                  <Input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                </FormField>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField label={t("date_of_birth")}>
                  <Input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
                </FormField>
                <FormField label={t("gender")}>
                  <select className="input-field" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="">{t("select_gender")}</option>
                    {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </FormField>
                <FormField label={t("status")}>
                  <select className="input-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="TRANSFERRED">Transferred</option>
                  </select>
                </FormField>
              </div>
              <FormField label={t("boarding_type")}>
                <select className="input-field" value={form.boarding_type} onChange={(e) => setForm({ ...form, boarding_type: e.target.value })}>
                  {BOARDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                </select>
              </FormField>
              <div className="flex justify-end pt-4">
                <Button variant="secondary" onClick={() => { setOpen(false); setStep(0); }}>{t("cancel")}</Button>
                <Button variant="primary" onClick={nextStep}>{t("next")} →</Button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="text-caption text-muted">{t("wizard.step_guardian")}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label={t("guardian_phone")} required>
                  <Input
                    required
                    type="tel"
                    placeholder="07XXXXXXXX"
                    value={form.guardian_phone}
                    onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
                  />
                </FormField>
                <FormField label={t("guardian_email")}>
                  <Input
                    type="email"
                    placeholder="guardian@example.ke"
                    value={form.guardian_email}
                    onChange={(e) => setForm({ ...form, guardian_email: e.target.value })}
                  />
                </FormField>
              </div>
              <div className="flex justify-end pt-4">
                <Button variant="secondary" onClick={prevStep}>← {t("back")}</Button>
                <Button variant="primary" onClick={nextStep}>{t("next")} →</Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="text-caption text-muted">{t("wizard.step_fees")}</div>
              <Card className="p-4 border-dashed">
                <p className="text-body">{t("wizard.assign_fee_categories")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked onChange={() => {}} /> Tuition
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked onChange={() => {}} /> Transport
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked onChange={() => {}} /> Feeding Program
                  </label>
                </div>
              </Card>
              <div className="flex justify-between pt-4">
                <Button variant="secondary" onClick={prevStep}>← {t("back")}</Button>
                <Button variant="primary" type="submit" loading={saving}>{t("save_learner")}</Button>
              </div>
            </>
          )}
        </form>
      </Dialog>

      <div className="text-caption text-muted">
        {t("learner_count", { count: learners.length })}
        {selected.size > 0 && ` · ${selected.size} selected`}
      </div>
    </div>
  );
}
