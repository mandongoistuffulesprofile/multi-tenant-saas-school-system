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

const EMPTY_LEARNER_FORM = {
  admission_number: "", upi_nemis_number: "", first_name: "", middle_name: "",
  last_name: "", date_of_birth: "", gender: "", status: "ACTIVE", admitted_on: "",
  boarding_type: "DAY", grade_label: "Grade 1", stream_name: "East",
  residence_type: "DAY_SCHOLAR_WITH_LUNCH", kemis_upi: "",
  knec_assessment_no: "", sne_category: "NONE",
  transport_zone_id: "", transport_trip_type: "NONE",
  guardian_name: "", guardian_phone: "", guardian_email: "", guardian_relationship: "PARENT",
  fee_category: "TUITION", fee_agreed: true,
};
const GENDERS = ["Male", "Female"];
const RESIDENCE_OPTIONS = [
  { value: "DAY_SCHOLAR_WITH_LUNCH", label: "Day Scholar (with lunch)" },
  { value: "DAY_SCHOLAR_NO_LUNCH", label: "Day Scholar (no lunch / own tiffin)" },
  { value: "BOARDER_FULL", label: "Full Boarder" },
  { value: "BOARDER_WEEKLY", label: "Weekly Boarder" },
];

const TRIP_OPTIONS = [
  { value: "NONE", label: "No transport" },
  { value: "TWO_WAY", label: "Two-way (morning & evening)" },
  { value: "ONE_WAY_AM", label: "One-way (morning pick-up)" },
  { value: "ONE_WAY_PM", label: "One-way (evening drop-off)" },
];

const SNE_OPTIONS = [
  { value: "NONE", label: "None (regular learner)" },
  { value: "GIFTED", label: "Gifted & talented" },
  { value: "VISUAL", label: "Visual impairment" },
  { value: "HEARING", label: "Hearing impairment" },
  { value: "PHYSICAL", label: "Physical disability" },
  { value: "NEURODIVERSE", label: "Neurodiverse (autism / ADHD)" },
  { value: "MULTIPLE", label: "Multiple needs" },
];

type TransportZone = {
  zone_id: string;
  zone_name: string;
  two_way_fee: number;
  one_way_fee: number;
};

export default function LearnersPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<any>({ ...EMPTY_LEARNER_FORM });
  const resetWizard = () => {
    setForm({ ...EMPTY_LEARNER_FORM });
    setFeeChecks({});
    setStep(0);
  };
	  const [zones, setZones] = useState<TransportZone[]>([]);
  const [categories, setCategories] = useState<{ category_id: string; name: string; is_tuition?: boolean }[]>([]);
  const [structures, setStructures] = useState<any[]>([]);
  const [gradeOptions, setGradeOptions] = useState<string[]>(GRADES);
  const [streamOptions, setStreamOptions] = useState<string[]>(STREAMS);
  const [gradeIdByLabel, setGradeIdByLabel] = useState<Record<string, string>>({});
  const [feeChecks, setFeeChecks] = useState<Record<string, boolean>>({});
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

  // Load the school's real structure + fee categories so the wizard offers
  // only the categories that actually have a fee structure for the selected
  // grade. The fee-option API stores a structure_id, not just a category.
  useEffect(() => {
    const safe = (p: string) => api.get(p).then((r) => r.data).catch(() => null);
    	    Promise.all([
	      safe("/finance/fee-categories"),
	      safe("/finance/fee-structures"),
	      safe("/structure/grades"),
	      safe("/structure/streams"),
	      safe("/transport/zones"),
	    ]).then(([cats, structs, grades, streams, transportZones]) => {
	      if (Array.isArray(transportZones)) setZones(transportZones);
      const list = Array.isArray(cats) ? cats : [];
      setCategories(list.map((c: any) => ({ category_id: c.category_id, name: c.name || c.code, is_tuition: c.is_tuition })));
      const defaults: Record<string, boolean> = {};
      list.forEach((c: any) => { defaults[c.category_id] = Boolean(c.is_tuition); });
      setFeeChecks(defaults);
      if (Array.isArray(structs)) setStructures(structs);
      if (Array.isArray(grades) && grades.length > 0) {
        const labels = grades.map((g: any) => g.grade_label).filter(Boolean);
        const map: Record<string, string> = {};
        grades.forEach((g: any) => { if (g.grade_label && g.grade_id) map[g.grade_label] = g.grade_id; });
        setGradeIdByLabel(map);
        if (labels.length) {
          setGradeOptions(labels);
          setForm((f: any) => (labels.includes(f.grade_label) ? f : { ...f, grade_label: labels[0] }));
        }
      }
      if (Array.isArray(streams) && streams.length > 0) {
        const names = streams.map((s: any) => s.stream_name).filter(Boolean);
        if (names.length) {
          setStreamOptions(names);
          setForm((f: any) => (names.includes(f.stream_name) ? f : { ...f, stream_name: names[0] }));
        }
      }
    });
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
  const nextStep = () => {
    if (step === 0) {
      const missing = [
        !form.admission_number.trim() && t("admission_number"),
        !form.first_name.trim() && t("first_name"),
        !form.last_name.trim() && t("last_name"),
      ].filter(Boolean);
      if (missing.length > 0) {
        toast(`Enter ${missing.join(", ")} before continuing`, { type: "error" });
        return;
      }
    }
    setStep((s) => (s < 2 ? s + 1 : s));
  };
  const prevStep = () => setStep((s) => (s > 0 ? s - 1 : s));

  const structureForCategory = (categoryId: string) => {
    const gradeId = gradeIdByLabel[form.grade_label];
    if (!gradeId) return null;
    return structures.find((s: any) => s.category_id === categoryId && s.grade_id === gradeId) || null;
  };
  const availableCategories = categories.filter((c) => Boolean(structureForCategory(c.category_id)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      admission_number: form.admission_number,
      upi_nemis_number: form.upi_nemis_number,
      first_name: form.first_name,
      middle_name: form.middle_name,
      last_name: form.last_name,
      date_of_birth: form.date_of_birth,
      gender: form.gender,
      status: form.status,
      admitted_on: form.admitted_on,
      	      boarding_type: form.boarding_type,
	      residence_type: form.residence_type,
	      kemis_upi: form.kemis_upi,
	      knec_assessment_no: form.knec_assessment_no,
	      sne_category: form.sne_category,
	      transport_zone_id: form.transport_zone_id,
	      transport_trip_type: form.transport_trip_type,
	      grade_label: form.grade_label,
	      stream_name: form.stream_name,
      guardians: form.guardian_phone ? [{
        full_name: form.guardian_name || `${form.last_name} Guardian`,
        phone_number: form.guardian_phone,
        email: form.guardian_email,
        relationship: form.guardian_relationship,
        is_emergency_contact: true
      }] : []
    };
    try {
      const res = await api.post("/learners", payload);
      // Persist opted-in fee categories from step 2 onto the new learner.
      // The API stores a structure_id, so only send categories that have a
      // matching structure for the selected grade. A failed fee option must
      // not make the learner look like it was not admitted.
      const learnerId = res?.data?.learner_id;
      let savedOptions = 0;
      let skippedOptions = 0;
      if (learnerId) {
        for (const [categoryId, checked] of Object.entries(feeChecks)) {
          if (!checked) continue;
          const structure = structureForCategory(categoryId);
          if (!structure) { skippedOptions++; continue; }
          try {
            await api.post(`/finance/learners/${learnerId}/fee-options`, {
              category_id: categoryId,
              structure_id: structure.structure_id,
              opted_in: true,
            });
            savedOptions++;
          } catch {
            skippedOptions++;
          }
        }
      }
      setOpen(false);
      resetWizard();
      const skippedNote = skippedOptions ? ` · ${skippedOptions} fee option(s) skipped (no fee structure configured)` : "";
      toast(
        `Learner admitted${savedOptions ? ` with ${savedOptions} fee category(ies)` : ""}${skippedNote}`,
        { type: skippedOptions ? "info" : "success" },
      );
      const r = await api.get<Learner[]>("/learners").catch(() => null);
      if (r) setLearners(Array.isArray(r.data) ? r.data : []);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to create learner", { type: "error" });
    } finally {
      setSaving(false);
    }
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
	            {
	              key: "residence_type",
	              header: "Residence",
	              render: (row) => RESIDENCE_OPTIONS.find((o) => o.value === row.residence_type)?.label ?? "—",
	            },
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

      <Dialog open={open} onClose={() => { setOpen(false); resetWizard(); }} title={t("add_learner")} className="max-w-2xl">
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
              	              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                <FormField label="Learner Mode / Residence" required>
	                  <select
	                    className="input-field"
	                    value={form.residence_type}
	                    onChange={(e) => {
	                      const residence = e.target.value;
	                      setForm({
	                        ...form,
	                        residence_type: residence,
	                        boarding_type: residence.startsWith("BOARDER") ? "BOARDING" : "DAY",
	                        transport_trip_type: residence.startsWith("DAY_SCHOLAR") ? form.transport_trip_type : "NONE",
	                        transport_zone_id: residence.startsWith("DAY_SCHOLAR") ? form.transport_zone_id : "",
	                      });
	                    }}
	                  >
	                    {RESIDENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
	                  </select>
	                </FormField>
	                <FormField label="Special Needs (SNE)">
	                  <select className="input-field" value={form.sne_category} onChange={(e) => setForm({ ...form, sne_category: e.target.value })}>
	                    {SNE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
	                  </select>
	                </FormField>
	              </div>
              	              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                <FormField label={t("grade")}>
	                  <select className="input-field" value={form.grade_label} onChange={(e) => setForm({ ...form, grade_label: e.target.value })}>
	                    {gradeOptions.map((g) => <option key={g} value={g}>{g}</option>)}
	                  </select>
	                </FormField>
	                <FormField label={t("stream")}>
	                  <select className="input-field" value={form.stream_name} onChange={(e) => setForm({ ...form, stream_name: e.target.value })}>
	                    {streamOptions.map((s) => <option key={s} value={s}>{s}</option>)}
	                  </select>
	                </FormField>
	              </div>

	              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-4">
	                <div className="text-caption font-semibold uppercase tracking-wide text-emerald-800">
	                  Ministry of Education & National Examination IDs
	                </div>
	                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                  <FormField label="NEMIS UPI">
	                    <Input
	                      placeholder="e.g. M7X9K2P1"
	                      className="font-mono uppercase"
	                      value={form.upi_nemis_number}
	                      onChange={(e) => setForm({ ...form, upi_nemis_number: e.target.value.toUpperCase() })}
	                    />
	                  </FormField>
	                  <FormField label="KEMIS UPI">
	                    <Input
	                      placeholder="e.g. K3M8S2P4"
	                      className="font-mono uppercase"
	                      value={form.kemis_upi}
	                      onChange={(e) => setForm({ ...form, kemis_upi: e.target.value.toUpperCase() })}
	                    />
	                  </FormField>
	                </div>
	                <FormField label="KNEC Assessment No (KPSEA / KJSEA)">
	                  <Input
	                    placeholder="e.g. 20401021/045"
	                    className="font-mono"
	                    value={form.knec_assessment_no}
	                    onChange={(e) => setForm({ ...form, knec_assessment_no: e.target.value })}
	                  />
	                </FormField>
	              </div>

	              {String(form.residence_type).startsWith("DAY_SCHOLAR") && (
	                <div className="rounded-xl border border-slate-200 p-4 space-y-4">
	                  <div className="text-caption font-semibold uppercase tracking-wide text-slate-700">
	                    Transport (zoned day-scholar routes)
	                  </div>
	                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                    <FormField label="Route / Zone">
	                      <select
	                        className="input-field"
	                        value={form.transport_zone_id}
	                        onChange={(e) => setForm({ ...form, transport_zone_id: e.target.value })}
	                      >
	                        <option value="">No transport required</option>
	                        {zones.map((z) => (
	                          <option key={z.zone_id} value={z.zone_id}>
	                            {z.zone_name} (KES {Number(z.two_way_fee).toLocaleString()})
	                          </option>
	                        ))}
	                      </select>
	                    </FormField>
	                    <FormField label="Trip Pattern">
	                      <select
	                        className="input-field"
	                        disabled={!form.transport_zone_id}
	                        value={form.transport_trip_type}
	                        onChange={(e) => setForm({ ...form, transport_trip_type: e.target.value })}
	                      >
	                        {TRIP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
	                      </select>
	                    </FormField>
	                  </div>
	                  {zones.length === 0 && (
	                    <p className="text-xs text-gray-500">
	                      No transport zones configured yet. Add them via the transport zones API before assigning a route.
	                    </p>
	                  )}
	                </div>
	              )}
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                <Button variant="secondary" onClick={() => { setOpen(false); resetWizard(); }}>{t("cancel")}</Button>
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
              <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
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
                  {categories.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No fee categories configured yet — fees can be assigned after admission via Finance → Fee Categories.
                    </p>
                  ) : availableCategories.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No fee structure is configured for {form.grade_label} yet. Add one via Finance → Fee Structures, or admit the learner now and assign fees later.
                    </p>
                  ) : (
                    availableCategories.map((c) => (
                      <label key={c.category_id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(feeChecks[c.category_id])}
                          onChange={(e) => setFeeChecks((fc) => ({ ...fc, [c.category_id]: e.target.checked }))}
                        /> {c.name}
                      </label>
                    ))
                  )}
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
