import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "../../components/atoms/Card";
import Input from "../../components/atoms/Input";
import Button from "../../components/atoms/Button";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import { api } from "../../lib/api";
import { KENYA_COUNTY_NAMES, subCountiesFor } from "../../data/kenyaLocations";

type CheckStatus = "ok" | "warn" | "block";
type Check = { code: string; status: CheckStatus; message: string };
type Grade = { grade_id: string; grade_label: string; level_band: string; lessons_per_week: number };

const STEPS = [
  {
    key: "profile",
    title: "School profile",
    blurb: "The school's official identity, location and funding model.",
  },
  {
    key: "calendar",
    title: "Academic year & terms",
    blurb: "Kenya runs three terms a year. Set the dates the school actually uses.",
  },
  {
    key: "structure",
    title: "Academic structure",
    blurb: "Pick the grades the school teaches, then name its streams.",
  },
  {
    key: "finance",
    title: "Finance baseline",
    blurb: "One fee category and a per-term amount. The school refines this after handoff.",
  },
  {
    key: "seeds",
    title: "Staff & learner seeds",
    blurb: "Optional starter records so the school is not empty on day one.",
  },
  {
    key: "review",
    title: "Review & handoff",
    blurb: "Check everything, mark the school ready, then hand it over.",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const STEP_CHECKS: Record<StepKey, string[]> = {
  profile: [],
  calendar: ["academic_year", "current_year", "terms"],
  structure: ["structure"],
  finance: ["finance", "payment_channels"],
  seeds: [],
  review: ["school_admin"],
};

const CHECK_LABELS: Record<string, string> = {
  school_admin: "Assign an active school admin",
  academic_year: "Create the academic year",
  current_year: "Mark the academic year as current",
  terms: "Add at least one term",
  structure: "Create class groups",
  finance: "Create a fee structure",
  payment_channels: "Add an M-PESA payment channel (optional)",
};

const ONBOARDING_LABELS: Record<string, string> = {
  PENDING_SETUP: "Pending setup",
  IN_PROGRESS: "Setup in progress",
  READY_FOR_HANDOFF: "Ready for handoff",
  HANDED_OFF: "Handed off",
};

const SCHOOL_TYPES = [
  { value: "PUBLIC", label: "Public" },
  { value: "PRIVATE", label: "Private" },
  { value: "SNE", label: "Special needs (SNE)" },
];

const FUNDING_MODES = [
  { value: "PUBLIC", label: "Public / government funded" },
  { value: "CAPITATION", label: "Capitation (FPE / FDSE)" },
  { value: "PRIVATE", label: "Private / fee paying" },
  { value: "CUSTOM", label: "Mixed or other" },
];

const OTHER_SUB_COUNTY = "__other__";

type StaffRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};

type LearnerRow = {
  id: string;
  first_name: string;
  last_name: string;
  admission_number: string;
};

type Term = { term_name: string; start_date: string; end_date: string };

type Profile = {
  school_name: string;
  county: string;
  sub_county: string;
  school_type: string;
  funding_mode: string;
  address: string;
  nemis_code: string;
  kemis_code: string;
  knec_code: string;
};

type Calendar = {
  year_label: string;
  start_date: string;
  end_date: string;
  set_current: boolean;
  terms: Term[];
};

type Finance = {
  category_name: string;
  category_code: string;
  amount: string;
  grade_ids: string[];
  paybill: string;
  till: string;
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

const defaultTerms = (): Term[] => [
  { term_name: "Term 1", start_date: "", end_date: "" },
  { term_name: "Term 2", start_date: "", end_date: "" },
  { term_name: "Term 3", start_date: "", end_date: "" },
];

const emptyStaffRow = (): StaffRow => ({
  id: newId(),
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
});

const emptyLearnerRow = (): LearnerRow => ({
  id: newId(),
  first_name: "",
  last_name: "",
  admission_number: "",
});

const isoToDmy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

const parseDmy = (text: string): string | null => {
  const t = text.trim();
  if (!t) return "";
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const nowTime = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const normalizePhone = (raw: string) => raw.replace(/[\s()-]/g, "").replace(/^\+254/, "0");

const isValidPhone = (raw: string) => {
  const p = normalizePhone(raw);
  return /^0\d{9}$/.test(p) || /^254\d{9}$/.test(p);
};

const isValidEmail = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());

const labelOf = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label || value;

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  helper,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  helper?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-kenyan-red">*</span>}
      </label>
      <select className="input-field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {helper && <p className="mt-1 text-[13px] text-gray-600">{helper}</p>}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  error?: string;
}) {
  const invalid = !!value.trim() && parseDmy(value) === null;
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={`input-field ${invalid || error ? "border-red-500" : ""}`}
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {(invalid || error) && (
        <p className="mt-1 text-xs text-red-600">{error || "Use dd/mm/yyyy, e.g. 06/01/2027"}</p>
      )}
    </div>
  );
}

function SaveHint({ savedAt, dirty }: { savedAt?: string; dirty?: boolean }) {
  if (savedAt && dirty) {
    return <span className="text-[13px] font-medium text-amber-700">Unsaved changes</span>;
  }
  if (savedAt) {
    return <span className="text-[13px] font-medium text-green-700">Saved ✓ {savedAt}</span>;
  }
  return <span className="text-[13px] text-gray-500">Not saved yet</span>;
}

export default function TenantSetupPage() {
  const { tenantId = "" } = useParams();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Partial<Record<StepKey, string>>>({});
  const [savedAt, setSavedAt] = useState<Partial<Record<StepKey, string>>>({});
  const [dirty, setDirty] = useState<Partial<Record<StepKey, boolean>>>({});
  const [active, setActive] = useState<StepKey>("profile");

  const initializedRef = useRef(false);
  const loadedRef = useRef(false);
  const stepCardRef = useRef<HTMLDivElement | null>(null);

  const [profile, setProfile] = useState<Profile>({
    school_name: "",
    county: "",
    sub_county: "",
    school_type: "",
    funding_mode: "",
    address: "",
    nemis_code: "",
    kemis_code: "",
    knec_code: "",
  });
  const [calendar, setCalendar] = useState<Calendar>({
    year_label: `${new Date().getFullYear()}`,
    start_date: "",
    end_date: "",
    set_current: true,
    terms: defaultTerms(),
  });
  const [streams, setStreams] = useState<string[]>([]);
  const [streamInput, setStreamInput] = useState("");
  const [gradeStreams, setGradeStreams] = useState<Record<string, string[]>>({});
  const [finance, setFinance] = useState<Finance>({
    category_name: "Tuition",
    category_code: "TUITION",
    amount: "",
    grade_ids: [],
    paybill: "",
    till: "",
  });
  const [staffRows, setStaffRows] = useState<StaffRow[]>([emptyStaffRow()]);
  const [learnerRows, setLearnerRows] = useState<LearnerRow[]>([emptyLearnerRow()]);
  const [handoffAck, setHandoffAck] = useState(false);

  const touch = (key: StepKey) => {
    setDirty((d) => ({ ...d, [key]: true }));
    setStepErrors((e) => ({ ...e, [key]: undefined }));
  };

  const hydrate = (payload: any) => {
    const school = payload?.school || {};
    setProfile({
      school_name: school.school_name || "",
      county: school.county || "",
      sub_county: school.sub_county || "",
      school_type: school.school_type || "",
      funding_mode: school.funding_mode || "",
      address: school.address || "",
      nemis_code: school.nemis_code || "",
      kemis_code: school.kemis_code || "",
      knec_code: school.knec_code || "",
    });

    const draft = payload?.onboarding?.draft || {};

    const cal = draft.calendar;
    if (cal && typeof cal === "object") {
      setCalendar({
        year_label: cal.year_label || `${new Date().getFullYear()}`,
        start_date: isoToDmy(cal.start_date || ""),
        end_date: isoToDmy(cal.end_date || ""),
        set_current: cal.set_current !== false,
        terms:
          Array.isArray(cal.terms) && cal.terms.length > 0
            ? cal.terms.map((t: any) => ({
                term_name: t.term_name || "",
                start_date: isoToDmy(t.start_date || ""),
                end_date: isoToDmy(t.end_date || ""),
              }))
            : defaultTerms(),
      });
    }

    const structure = draft.structure;
    if (structure && typeof structure === "object") {
      const savedStreams: string[] = Array.isArray(structure.streams)
        ? structure.streams.filter((s: unknown) => typeof s === "string" && s.trim())
        : [];
      setStreams(savedStreams);
      const map: Record<string, string[]> = {};
      const groups: any[] = Array.isArray(structure.class_groups) ? structure.class_groups : [];
      for (const group of groups) {
        if (!group?.grade_id) continue;
        if (!(group.grade_id in map)) map[group.grade_id] = [];
        if (group.stream_name && !map[group.grade_id].includes(group.stream_name)) {
          map[group.grade_id].push(group.stream_name);
        }
      }
      setGradeStreams(map);
    }

    const fin = draft.finance;
    if (fin && typeof fin === "object") {
      const cat = Array.isArray(fin.categories) ? fin.categories[0] : null;
      const structures: any[] = Array.isArray(fin.structures) ? fin.structures : [];
      const channels: any[] = Array.isArray(fin.channels) ? fin.channels : [];
      const paybill = channels.find((c) => String(c.channel_type).toUpperCase() === "PAYBILL");
      const till = channels.find((c) => String(c.channel_type).toUpperCase() === "TILL");
      setFinance({
        category_name: cat?.name || "Tuition",
        category_code: cat?.code || "TUITION",
        amount: structures[0]?.amount ? String(structures[0].amount) : "",
        grade_ids: Array.from(new Set(structures.map((s) => s.grade_id).filter(Boolean))) as string[],
        paybill: paybill?.shortcode_or_account || "",
        till: till?.shortcode_or_account || "",
      });
    }

    const seeds = draft.seeds;
    if (seeds && typeof seeds === "object") {
      const staff: StaffRow[] = (Array.isArray(seeds.staff) ? seeds.staff : []).map((s: any) => ({
        id: newId(),
        first_name: s.first_name || "",
        last_name: s.last_name || "",
        phone: s.phone_number || "",
        email: s.email || "",
      }));
      const learners: LearnerRow[] = (Array.isArray(seeds.learners) ? seeds.learners : []).map((l: any) => ({
        id: newId(),
        first_name: l.first_name || "",
        last_name: l.last_name || "",
        admission_number: l.admission_number || "",
      }));
      if (staff.length > 0) setStaffRows(staff);
      if (learners.length > 0) setLearnerRows(learners);
    }
  };

  const load = async () => {
    if (!tenantId) return;
    if (!loadedRef.current) setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/platform/tenants/${encodeURIComponent(tenantId)}/setup`);
      setData(res.data);
      if (!initializedRef.current) {
        hydrate(res.data);
        initializedRef.current = true;
      }
      loadedRef.current = true;
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load onboarding state");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const school = data?.school || {};
  const grades: Grade[] = Array.isArray(data?.grades) ? data.grades : [];
  const checks: Check[] = data?.readiness?.checks || [];
  const draft = data?.onboarding?.draft || {};
  const steps: Record<string, string> = data?.onboarding?.steps || {};
  const onboardingStatus: string = data?.onboarding?.status || "PENDING_SETUP";
  const handedOff = onboardingStatus === "HANDED_OFF";
  const isReadyForHandoff = onboardingStatus === "READY_FOR_HANDOFF";

  const adminCheck = checks.find((c) => c.code === "school_admin");
  const blockers = checks.filter((c) => c.status === "block");

  const stepDone: Record<"profile" | "calendar" | "structure" | "finance", boolean> = {
    profile: steps.profile === "done" || (!!school.school_name && !!school.county),
    calendar:
      steps.calendar === "done" ||
      (checks.find((c) => c.code === "academic_year")?.status === "ok" &&
        checks.find((c) => c.code === "terms")?.status === "ok"),
    structure: steps.structure === "done" || checks.find((c) => c.code === "structure")?.status === "ok",
    finance: steps.finance === "done" || checks.find((c) => c.code === "finance")?.status === "ok",
  };
  const seedsDone = steps.seeds === "done";

  const requiredDone = [
    stepDone.profile,
    stepDone.calendar,
    stepDone.structure,
    stepDone.finance,
  ].filter(Boolean).length;

  const stepState = (key: StepKey): "done" | "blocked" | "pending" | "optional" => {
    if (key === "seeds") return seedsDone ? "done" : "optional";
    if (key === "review") return handedOff ? "done" : isReadyForHandoff ? "done" : "pending";
    const codes = STEP_CHECKS[key];
    const stepBlocked = checks.some((c) => codes.includes(c.code) && c.status === "block");
    if (stepBlocked) return "blocked";
    if (key === "profile" || key === "calendar" || key === "structure" || key === "finance") {
      return stepDone[key] ? "done" : "pending";
    }
    return "pending";
  };

  const stateLabel = (state: ReturnType<typeof stepState>, key: StepKey) => {
    switch (state) {
      case "done":
        return "Complete";
      case "blocked":
        return "Needs attention";
      case "optional":
        return "Optional";
      default:
        return key === "review" ? "Finish up" : "Not started";
    }
  };

  const stateIcon = (state: ReturnType<typeof stepState>) => {
    switch (state) {
      case "done":
        return "✓";
      case "blocked":
        return "!";
      default:
        return "○";
    }
  };

  const stateColor = (state: ReturnType<typeof stepState>) => {
    switch (state) {
      case "done":
        return "text-green-700";
      case "blocked":
        return "text-red-700";
      default:
        return "text-gray-400";
    }
  };

  const missing: string[] = [];
  if (stepState("profile") !== "done") missing.push("Save the school profile");
  if (stepState("calendar") !== "done") missing.push("Save the academic year and terms");
  if (stepState("structure") !== "done") missing.push("Save the academic structure");
  if (stepState("finance") !== "done") missing.push("Save the finance baseline");
  for (const b of blockers) missing.push(CHECK_LABELS[b.code] || b.message);
  const canMarkReady = requiredDone === 4 && blockers.length === 0 && !isReadyForHandoff && !handedOff;

  const subCountyOptions = useMemo(() => {
    const list = subCountiesFor(profile.county);
    return list.map((s) => ({ value: s, label: s }));
  }, [profile.county]);

  const subCountyIsOther = !!profile.sub_county && !subCountyOptions.some((o) => o.value === profile.sub_county);
  const subCountySelectValue = subCountyIsOther ? OTHER_SUB_COUNTY : profile.sub_county;

  const financeGradeIds = finance.grade_ids.length > 0 ? finance.grade_ids : Object.keys(gradeStreams);
  const gradeLabel = (id: string) => grades.find((g) => g.grade_id === id)?.grade_label || id;

  const selectedGrades = Object.keys(gradeStreams);

  const validStaffRows = staffRows.filter((r) => r.first_name.trim() || r.last_name.trim() || r.phone.trim() || r.email.trim());
  const validLearnerRows = learnerRows.filter(
    (r) => r.first_name.trim() || r.last_name.trim() || r.admission_number.trim()
  );

  const staffRowErrors = (row: StaffRow): string[] => {
    const errs: string[] = [];
    if (!row.first_name.trim() || !row.last_name.trim()) errs.push("First and last name are required");
    if (!row.phone.trim() && !row.email.trim()) errs.push("Add a phone number or an email");
    if (row.phone.trim() && !isValidPhone(row.phone)) errs.push("Phone should be 07XX XXX XXX");
    if (row.email.trim() && !isValidEmail(row.email)) errs.push("Email address looks invalid");
    return errs;
  };

  const learnerRowErrors = (row: LearnerRow): string[] => {
    if (!row.first_name.trim() || !row.last_name.trim()) return ["First and last name are required"];
    return [];
  };

  const staffHasErrors = validStaffRows.some((r) => staffRowErrors(r).length > 0);
  const learnerHasErrors = validLearnerRows.some((r) => learnerRowErrors(r).length > 0);

  const addStream = () => {
    const name = streamInput.trim();
    if (!name) return;
    if (streams.some((s) => s.toLowerCase() === name.toLowerCase())) {
      setStreamInput("");
      return;
    }
    if (streams.length >= 20) return;
    setStreams([...streams, name]);
    setGradeStreams((prev) => {
      const next: Record<string, string[]> = {};
      for (const [grade, names] of Object.entries(prev)) next[grade] = [...names, name];
      return next;
    });
    setStreamInput("");
    touch("structure");
  };

  const removeStream = (name: string) => {
    setStreams(streams.filter((s) => s !== name));
    setGradeStreams((prev) => {
      const next: Record<string, string[]> = {};
      for (const [grade, names] of Object.entries(prev)) next[grade] = names.filter((n) => n !== name);
      return next;
    });
    touch("structure");
  };

  const toggleGrade = (gradeId: string) => {
    setGradeStreams((prev) => {
      if (gradeId in prev) {
        const next = { ...prev };
        delete next[gradeId];
        return next;
      }
      return { ...prev, [gradeId]: [...streams] };
    });
    touch("structure");
  };

  const toggleGradeStream = (gradeId: string, streamName: string) => {
    setGradeStreams((prev) => {
      const current = prev[gradeId] || [];
      const next = current.includes(streamName)
        ? current.filter((s) => s !== streamName)
        : [...current, streamName];
      return { ...prev, [gradeId]: next };
    });
    touch("structure");
  };

  const toggleFinanceGrade = (gradeId: string) => {
    const next = financeGradeIds.includes(gradeId)
      ? financeGradeIds.filter((g) => g !== gradeId)
      : [...financeGradeIds, gradeId];
    setFinance({ ...finance, grade_ids: next });
    touch("finance");
  };

  const run = async (key: StepKey | "complete" | "handoff", fn: () => Promise<void>) => {
    setSaving(key);
    if (key !== "complete" && key !== "handoff") {
      setStepErrors((e) => ({ ...e, [key]: undefined }));
    }
    try {
      await fn();
      await load();
      if (key !== "complete" && key !== "handoff") {
        setSavedAt((s) => ({ ...s, [key]: nowTime() }));
        setDirty((d) => ({ ...d, [key]: false }));
      }
      return true;
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.response?.data?.error || "Action failed";
      if (key === "complete" || key === "handoff") setError(message);
      else setStepErrors((prev) => ({ ...prev, [key]: message }));
      return false;
    } finally {
      setSaving(null);
    }
  };

  const goTo = (key: StepKey) => {
    setActive(key);
    setError(null);
    stepCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const nextStep = () => {
    const index = STEPS.findIndex((s) => s.key === active);
    const next = STEPS[index + 1];
    if (next) goTo(next.key);
  };

  const prevStep = () => {
    const index = STEPS.findIndex((s) => s.key === active);
    const prev = STEPS[index - 1];
    if (prev) goTo(prev.key);
  };

  const saveProfile = async () => {
    if (!profile.school_name.trim()) {
      setStepErrors((e) => ({ ...e, profile: "School name is required" }));
      return;
    }
    if (!profile.county) {
      setStepErrors((e) => ({ ...e, profile: "Select the county the school is in" }));
      return;
    }
    const ok = await run("profile", async () => {
      await api.patch(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/profile`, {
        ...profile,
        sub_county: profile.sub_county.trim(),
      });
    });
    if (ok) nextStep();
  };

  const saveCalendar = async () => {
    if (!calendar.year_label.trim()) {
      setStepErrors((e) => ({ ...e, calendar: "Year label is required, e.g. 2027" }));
      return;
    }
    const yearStart = parseDmy(calendar.start_date);
    const yearEnd = parseDmy(calendar.end_date);
    if (!yearStart || !yearEnd) {
      setStepErrors((e) => ({ ...e, calendar: "Set the year start and end dates as dd/mm/yyyy" }));
      return;
    }
    if (calendar.terms.length === 0) {
      setStepErrors((e) => ({ ...e, calendar: "Add at least one term" }));
      return;
    }
    const incomplete = calendar.terms.find((t) => !t.term_name.trim() || !t.start_date || !t.end_date);
    if (incomplete) {
      setStepErrors((e) => ({ ...e, calendar: "Every term needs a name, start date and end date" }));
      return;
    }
    const termPayload = calendar.terms.map((t) => ({
      term_name: t.term_name.trim(),
      start_date: parseDmy(t.start_date) || "",
      end_date: parseDmy(t.end_date) || "",
    }));
    if (termPayload.some((t) => !t.start_date || !t.end_date)) {
      setStepErrors((e) => ({ ...e, calendar: "Term dates must be valid dd/mm/yyyy dates" }));
      return;
    }
    const ok = await run("calendar", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/calendar`, {
        year_label: calendar.year_label,
        start_date: yearStart,
        end_date: yearEnd,
        set_current: calendar.set_current,
        terms: termPayload,
      });
    });
    if (ok) nextStep();
  };

  const saveStructure = async () => {
    if (selectedGrades.length === 0) {
      setStepErrors((e) => ({ ...e, structure: "Select at least one grade" }));
      return;
    }
    const class_groups = selectedGrades.flatMap((grade_id) => {
      const names = gradeStreams[grade_id] || [];
      if (names.length === 0) return [{ grade_id, stream_name: "" }];
      return names.map((stream_name) => ({ grade_id, stream_name }));
    });
    const ok = await run("structure", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/structure`, {
        streams,
        class_groups,
      });
    });
    if (ok) nextStep();
  };

  const saveFinance = async () => {
    const amount = Number(finance.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStepErrors((e) => ({ ...e, finance: "Enter the fee amount per term (greater than zero)" }));
      return;
    }
    if (!finance.category_name.trim() || !finance.category_code.trim()) {
      setStepErrors((e) => ({ ...e, finance: "Give the fee category a name and a code" }));
      return;
    }
    if (financeGradeIds.length === 0) {
      setStepErrors((e) => ({ ...e, finance: "Select at least one grade for this fee amount" }));
      return;
    }
    if (finance.paybill.trim() && !/^\d{5,10}$/.test(finance.paybill.trim())) {
      setStepErrors((e) => ({ ...e, finance: "Paybill number should be digits only" }));
      return;
    }
    if (finance.till.trim() && !/^\d{5,10}$/.test(finance.till.trim())) {
      setStepErrors((e) => ({ ...e, finance: "Till number should be digits only" }));
      return;
    }
    const channels: any[] = [];
    if (finance.paybill.trim()) {
      channels.push({
        channel_type: "PAYBILL",
        shortcode_or_account: finance.paybill.trim(),
        label: "Main Paybill",
        is_default: true,
      });
    }
    if (finance.till.trim()) {
      channels.push({
        channel_type: "TILL",
        shortcode_or_account: finance.till.trim(),
        label: "Main Till",
        is_default: channels.length === 0,
      });
    }
    const ok = await run("finance", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/finance`, {
        categories: [
          { name: finance.category_name.trim(), code: finance.category_code.trim().toUpperCase(), is_mandatory: true },
        ],
        structures: financeGradeIds.map((grade_id) => ({ grade_id, amount })),
        channels,
      });
    });
    if (ok) nextStep();
  };

  const saveSeeds = async () => {
    if (staffHasErrors || learnerHasErrors) {
      setStepErrors((e) => ({ ...e, seeds: "Fix the highlighted rows before seeding" }));
      return;
    }
    const staff = validStaffRows.map((r) => ({
      first_name: r.first_name.trim(),
      last_name: r.last_name.trim(),
      phone_number: normalizePhone(r.phone),
      email: r.email.trim(),
    }));
    const learners = validLearnerRows.map((r) => ({
      first_name: r.first_name.trim(),
      last_name: r.last_name.trim(),
      admission_number: r.admission_number.trim(),
    }));
    const ok = await run("seeds", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/seeds`, { staff, learners });
    });
    if (ok) nextStep();
  };

  const skipSeeds = () => nextStep();

  const markReady = async () => {
    const ok = await run("complete", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/complete`);
    });
    if (ok) setActive("review");
  };

  const markHandedOff = async () => {
    const ok = await run("handoff", async () => {
      await api.post(`/platform/tenants/${encodeURIComponent(tenantId)}/setup/handoff`);
    });
    if (ok) setHandoffAck(true);
  };

  if (loading) return <ViewState state="loading" />;
  if (!tenantId) return <ViewState state="error" message="Missing tenant id" />;
  if (!data && error) return <ViewState state="error" message={error} />;

  const activeIndex = STEPS.findIndex((s) => s.key === active);
  const activeStep = STEPS[activeIndex];
  const adminOk = adminCheck?.status === "ok";

  const renderStep = () => {
    switch (active) {
      case "profile":
        return (
          <div className="space-y-4">
            <Input
              label="School name"
              value={profile.school_name}
              placeholder="e.g. Mwangaza Primary School"
              onChange={(e: any) => {
                setProfile({ ...profile, school_name: e.target.value });
                touch("profile");
              }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="County"
                required
                value={profile.county}
                placeholder="Select county"
                options={KENYA_COUNTY_NAMES.map((c) => ({ value: c, label: c }))}
                onChange={(county) => {
                  setProfile({ ...profile, county, sub_county: "" });
                  touch("profile");
                }}
              />
              <div>
                <SelectField
                  label="Sub-county"
                  value={subCountySelectValue}
                  placeholder={profile.county ? "Select sub-county" : "Select a county first"}
                  options={[...subCountyOptions, { value: OTHER_SUB_COUNTY, label: "Other (not listed)…" }]}
                  onChange={(value) => {
                    setProfile({
                      ...profile,
                      sub_county: value === OTHER_SUB_COUNTY ? "" : value,
                    });
                    touch("profile");
                  }}
                  helper="Pick “Other” if the sub-county is not in the list."
                />
                {(subCountySelectValue === OTHER_SUB_COUNTY || subCountyIsOther) && (
                  <Input
                    className="mt-2"
                    value={profile.sub_county}
                    placeholder="Type the sub-county"
                    onChange={(e: any) => {
                      setProfile({ ...profile, sub_county: e.target.value });
                      touch("profile");
                    }}
                  />
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="School type"
                value={profile.school_type}
                options={SCHOOL_TYPES}
                onChange={(value) => {
                  setProfile({ ...profile, school_type: value });
                  touch("profile");
                }}
              />
              <SelectField
                label="Funding mode"
                value={profile.funding_mode}
                options={FUNDING_MODES}
                onChange={(value) => {
                  setProfile({ ...profile, funding_mode: value });
                  touch("profile");
                }}
              />
            </div>
            <Input
              label="Physical address"
              value={profile.address}
              placeholder="e.g. Off Thika Road, Ruiru"
              onChange={(e: any) => {
                setProfile({ ...profile, address: e.target.value });
                touch("profile");
              }}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="NEMIS code"
                value={profile.nemis_code}
                placeholder="Optional"
                onChange={(e: any) => {
                  setProfile({ ...profile, nemis_code: e.target.value });
                  touch("profile");
                }}
              />
              <Input
                label="KEMIS code"
                value={profile.kemis_code}
                placeholder="Optional"
                onChange={(e: any) => {
                  setProfile({ ...profile, kemis_code: e.target.value });
                  touch("profile");
                }}
              />
              <Input
                label="KNEC code"
                value={profile.knec_code}
                placeholder="Optional"
                onChange={(e: any) => {
                  setProfile({ ...profile, knec_code: e.target.value });
                  touch("profile");
                }}
              />
            </div>
            <p className="text-[13px] text-gray-600">
              Government codes are optional for small and rural schools. You can add them after handoff.
            </p>
          </div>
        );

      case "calendar":
        return (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Year label"
                value={calendar.year_label}
                placeholder={String(new Date().getFullYear() + 1)}
                onChange={(e: any) => {
                  setCalendar({ ...calendar, year_label: e.target.value });
                  touch("calendar");
                }}
              />
              <DateField
                label="Year starts"
                value={calendar.start_date}
                onChange={(iso) => {
                  setCalendar({ ...calendar, start_date: iso });
                  touch("calendar");
                }}
              />
              <DateField
                label="Year ends"
                value={calendar.end_date}
                onChange={(iso) => {
                  setCalendar({ ...calendar, end_date: iso });
                  touch("calendar");
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={calendar.set_current}
                onChange={(e) => {
                  setCalendar({ ...calendar, set_current: e.target.checked });
                  touch("calendar");
                }}
              />
              Set as the current academic year
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Terms</h3>
                <span className="text-[13px] text-gray-500">Dates in dd/mm/yyyy</span>
              </div>
              {calendar.terms.map((term, index) => (
                <div key={index} className="rounded-xl border border-gray-200 p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                    <Input
                      label={`Term ${index + 1} name`}
                      value={term.term_name}
                      onChange={(e: any) => {
                        const terms = [...calendar.terms];
                        terms[index] = { ...terms[index], term_name: e.target.value };
                        setCalendar({ ...calendar, terms });
                        touch("calendar");
                      }}
                    />
                    <DateField
                      label="Starts"
                      value={term.start_date}
                      onChange={(iso) => {
                        const terms = [...calendar.terms];
                        terms[index] = { ...terms[index], start_date: iso };
                        setCalendar({ ...calendar, terms });
                        touch("calendar");
                      }}
                    />
                    <DateField
                      label="Ends"
                      value={term.end_date}
                      onChange={(iso) => {
                        const terms = [...calendar.terms];
                        terms[index] = { ...terms[index], end_date: iso };
                        setCalendar({ ...calendar, terms });
                        touch("calendar");
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-2 text-[13px] font-medium text-kenyan-red hover:underline"
                    onClick={() => {
                      setCalendar({ ...calendar, terms: calendar.terms.filter((_, i) => i !== index) });
                      touch("calendar");
                    }}
                  >
                    Remove term
                  </button>
                </div>
              ))}
              {calendar.terms.length < 3 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCalendar({
                      ...calendar,
                      terms: [
                        ...calendar.terms,
                        { term_name: `Term ${calendar.terms.length + 1}`, start_date: "", end_date: "" },
                      ],
                    });
                    touch("calendar");
                  }}
                >
                  + Add term
                </Button>
              )}
              <p className="text-[13px] text-gray-500">A Kenyan academic year has three terms.</p>
            </div>
          </div>
        );

      case "structure":
        return (
          <div className="space-y-5">
            <div>
              <label className="label">Streams</label>
              <p className="mb-2 text-[13px] text-gray-600">
                Add each stream once, e.g. A, B or Blue, Red. Leave empty for single-stream grades.
              </p>
              <div className="flex flex-wrap gap-2">
                {streams.length === 0 && <span className="text-sm text-gray-500">No streams added yet.</span>}
                {streams.map((stream) => (
                  <span
                    key={stream}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800"
                  >
                    {stream}
                    <button
                      type="button"
                      aria-label={`Remove stream ${stream}`}
                      className="text-gray-400 hover:text-kenyan-red"
                      onClick={() => removeStream(stream)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  className="input-field max-w-[220px]"
                  placeholder="e.g. Blue"
                  value={streamInput}
                  onChange={(e) => setStreamInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addStream();
                    }
                  }}
                />
                <Button variant="secondary" size="sm" onClick={addStream}>
                  Add stream
                </Button>
              </div>
            </div>

            <div>
              <label className="label">Grades the school teaches</label>
              {grades.length === 0 ? (
                <p className="text-sm text-gray-600">No grades are configured in the system yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {grades.map((grade) => {
                    const selected = grade.grade_id in gradeStreams;
                    return (
                      <button
                        key={grade.grade_id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleGrade(grade.grade_id)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                          selected
                            ? "border-kenyan-red bg-red-50 text-kenyan-red"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {selected ? "✓ " : ""}
                        {grade.grade_label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedGrades.length > 0 && (
              <div className="rounded-xl border border-gray-200">
                <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-[13px] font-medium text-gray-700">
                  Class groups to create
                </div>
                <div className="divide-y divide-gray-100">
                  {selectedGrades.map((gradeId) => (
                    <div key={gradeId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className="w-28 shrink-0 text-sm font-medium text-gray-900">{gradeLabel(gradeId)}</span>
                      {streams.length === 0 ? (
                        <span className="text-[13px] text-gray-500">Single class (no stream)</span>
                      ) : (
                        <>
                          {streams.map((stream) => {
                            const on = (gradeStreams[gradeId] || []).includes(stream);
                            return (
                              <button
                                key={stream}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleGradeStream(gradeId, stream)}
                                className={`rounded-full border px-2.5 py-1 text-[13px] ${
                                  on
                                    ? "border-gray-900 bg-gray-900 text-white"
                                    : "border-gray-300 bg-white text-gray-600"
                                }`}
                              >
                                {stream}
                              </button>
                            );
                          })}
                          {(gradeStreams[gradeId] || []).length === 0 && (
                            <span className="text-[13px] text-amber-700">No stream selected — one unstreamed class</span>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[13px] text-gray-600">
              Class groups are created in the current academic year. Save the calendar step first.
            </p>
          </div>
        );

      case "finance":
        return (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Fee category name"
                value={finance.category_name}
                placeholder="e.g. Tuition"
                onChange={(e: any) => {
                  setFinance({ ...finance, category_name: e.target.value });
                  touch("finance");
                }}
              />
              <Input
                label="Category code"
                value={finance.category_code}
                placeholder="e.g. TUITION"
                onChange={(e: any) => {
                  setFinance({ ...finance, category_code: e.target.value.toUpperCase() });
                  touch("finance");
                }}
              />
            </div>
            <div>
              <Input
                label="Amount per term (KES)"
                type="number"
                min={0}
                value={finance.amount}
                placeholder="e.g. 7500"
                onChange={(e: any) => {
                  setFinance({ ...finance, amount: e.target.value });
                  touch("finance");
                }}
              />
              <p className="mt-1 text-[13px] text-gray-600">
                Enter a real amount — a zero fee structure is not useful to the school.
              </p>
            </div>
            <div>
              <label className="label">Apply to grades</label>
              {grades.length === 0 ? (
                <p className="text-sm text-gray-600">No grades configured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {grades.map((grade) => {
                    const selected = financeGradeIds.includes(grade.grade_id);
                    return (
                      <button
                        key={grade.grade_id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleFinanceGrade(grade.grade_id)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                          selected
                            ? "border-kenyan-red bg-red-50 text-kenyan-red"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {selected ? "✓ " : ""}
                        {grade.grade_label}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-[13px] text-gray-600">
                Defaults to the grades selected in the structure step. The school can refine per grade and term later.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900">M-PESA collection (optional)</p>
              <p className="mt-1 text-[13px] text-gray-600">
                Add a Paybill or Till when the school is ready to collect fees by M-PESA. This never blocks handoff.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label="Paybill number"
                  value={finance.paybill}
                  placeholder="Optional"
                  inputMode="numeric"
                  onChange={(e: any) => {
                    setFinance({ ...finance, paybill: e.target.value });
                    touch("finance");
                  }}
                />
                <Input
                  label="Till number"
                  value={finance.till}
                  placeholder="Optional"
                  inputMode="numeric"
                  onChange={(e: any) => {
                    setFinance({ ...finance, till: e.target.value });
                    touch("finance");
                  }}
                />
              </div>
            </div>
          </div>
        );

      case "seeds":
        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-[13px] text-amber-900">
                Optional. Skip this and the school starts empty — everything here can be added after handoff.
              </p>
              <Badge variant="warning">Optional</Badge>
            </div>

            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Staff</h3>
                  <p className="text-[13px] text-gray-600">
                    In Kenya most staff have no school email. A phone number alone is enough. Seeded staff are added
                    as teachers; roles can be adjusted after handoff.
                  </p>
                </div>
                <span className="text-[13px] text-gray-500">{validStaffRows.length} row(s)</span>
              </div>
              <div className="hidden gap-2 text-[13px] font-medium text-gray-600 sm:grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <span>First name</span>
                <span>Last name</span>
                <span>Phone</span>
                <span>Email (optional)</span>
                <span />
              </div>
              {staffRows.map((row, index) => {
                const errs = staffRowErrors(row);
                const showErrors =
                  errs.length > 0 && (row.first_name || row.last_name || row.phone || row.email);
                return (
                  <div key={row.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-center">
                      <Input
                        aria-label={`Staff ${index + 1} first name`}
                        value={row.first_name}
                        placeholder="Wanjiku"
                        onChange={(e: any) => {
                          const next = [...staffRows];
                          next[index] = { ...row, first_name: e.target.value };
                          setStaffRows(next);
                          touch("seeds");
                        }}
                      />
                      <Input
                        aria-label={`Staff ${index + 1} last name`}
                        value={row.last_name}
                        placeholder="Kamau"
                        onChange={(e: any) => {
                          const next = [...staffRows];
                          next[index] = { ...row, last_name: e.target.value };
                          setStaffRows(next);
                          touch("seeds");
                        }}
                      />
                      <Input
                        aria-label={`Staff ${index + 1} phone`}
                        value={row.phone}
                        placeholder="0712 345 678"
                        inputMode="tel"
                        onChange={(e: any) => {
                          const next = [...staffRows];
                          next[index] = { ...row, phone: e.target.value };
                          setStaffRows(next);
                          touch("seeds");
                        }}
                      />
                      <Input
                        aria-label={`Staff ${index + 1} email`}
                        value={row.email}
                        placeholder="Optional"
                        type="email"
                        onChange={(e: any) => {
                          const next = [...staffRows];
                          next[index] = { ...row, email: e.target.value };
                          setStaffRows(next);
                          touch("seeds");
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove staff row ${index + 1}`}
                        className="justify-self-start text-sm text-gray-400 hover:text-kenyan-red sm:justify-self-auto"
                        onClick={() => {
                          setStaffRows(staffRows.length === 1 ? [emptyStaffRow()] : staffRows.filter((r) => r.id !== row.id));
                          touch("seeds");
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    {showErrors && (
                      <ul className="mt-2 space-y-0.5 text-[13px] text-red-700">
                        {errs.map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStaffRows([...staffRows, emptyStaffRow()]);
                  touch("seeds");
                }}
              >
                + Add staff member
              </Button>
            </section>

            <section className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Learners</h3>
                  <p className="text-[13px] text-gray-600">
                    Admission numbers are optional — rural schools often do not have them yet. A temporary number is
                    generated when left blank.
                  </p>
                </div>
                <span className="text-[13px] text-gray-500">{validLearnerRows.length} row(s)</span>
              </div>
              <div className="hidden gap-2 text-[13px] font-medium text-gray-600 sm:grid sm:grid-cols-[1fr_1fr_1fr_auto]">
                <span>First name</span>
                <span>Last name</span>
                <span>Admission no. (optional)</span>
                <span />
              </div>
              {learnerRows.map((row, index) => {
                const errs = learnerRowErrors(row);
                const showErrors = errs.length > 0 && (row.first_name || row.last_name || row.admission_number);
                return (
                  <div key={row.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
                      <Input
                        aria-label={`Learner ${index + 1} first name`}
                        value={row.first_name}
                        placeholder="Amani"
                        onChange={(e: any) => {
                          const next = [...learnerRows];
                          next[index] = { ...row, first_name: e.target.value };
                          setLearnerRows(next);
                          touch("seeds");
                        }}
                      />
                      <Input
                        aria-label={`Learner ${index + 1} last name`}
                        value={row.last_name}
                        placeholder="Otieno"
                        onChange={(e: any) => {
                          const next = [...learnerRows];
                          next[index] = { ...row, last_name: e.target.value };
                          setLearnerRows(next);
                          touch("seeds");
                        }}
                      />
                      <Input
                        aria-label={`Learner ${index + 1} admission number`}
                        value={row.admission_number}
                        placeholder="Optional"
                        onChange={(e: any) => {
                          const next = [...learnerRows];
                          next[index] = { ...row, admission_number: e.target.value };
                          setLearnerRows(next);
                          touch("seeds");
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove learner row ${index + 1}`}
                        className="justify-self-start text-sm text-gray-400 hover:text-kenyan-red sm:justify-self-auto"
                        onClick={() => {
                          setLearnerRows(
                            learnerRows.length === 1 ? [emptyLearnerRow()] : learnerRows.filter((r) => r.id !== row.id)
                          );
                          touch("seeds");
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    {showErrors && (
                      <ul className="mt-2 space-y-0.5 text-[13px] text-red-700">
                        {errs.map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setLearnerRows([...learnerRows, emptyLearnerRow()]);
                  touch("seeds");
                }}
              >
                + Add learner
              </Button>
              <p className="text-[13px] text-gray-600">
                Seeded learners are enrolled in the first class group; the school can move them afterwards.
              </p>
            </section>
          </div>
        );

      case "review": {
        const calDraft = calendar;
        const termSummary =
          calDraft.terms.length > 0
            ? calDraft.terms
                .map((t) => `${t.term_name || "Untitled"}${t.start_date ? ` (${isoToDmy(t.start_date)})` : ""}`)
                .join(" · ")
            : "No terms saved";
        return (
          <div className="space-y-5">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
              <p className="text-[13px] text-blue-900">
                <span className="font-semibold">Your Super Admin account stays platform-only.</span> It never becomes a
                member of this school. After handoff, the School Admin signs in and customizes school data; use the
                audited impersonation flow only for verification.
              </p>
            </div>

            {onboardingStatus === "READY_FOR_HANDOFF" && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-[13px] text-green-900">
                Marked ready for handoff. Tick the confirmation below, then mark the school handed off.
              </div>
            )}
            {handedOff && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-[13px] text-green-900">
                Handed off{data?.onboarding?.handed_off_at ? ` on ${String(data.onboarding.handed_off_at).slice(0, 10)}` : ""}.
                The school is now the owner of this tenant. The school admin finishes the rest of the setup: admissions and learner enrolment, fee structures and payment channels, staff assignments and roles, and parent/guardian linkage.
              </div>
            )}

            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              <SummaryRow
                title="School profile"
                state={stepDone.profile ? "done" : "pending"}
                body={
                  <>
                    <span className="font-medium text-gray-900">{profile.school_name || "Not set"}</span>
                    {" · "}
                    {[profile.sub_county, profile.county].filter(Boolean).join(", ") || "Location not set"}
                    {" · "}
                    {labelOf(SCHOOL_TYPES, profile.school_type) || "Type not set"}
                    {" · "}
                    {labelOf(FUNDING_MODES, profile.funding_mode) || "Funding not set"}
                  </>
                }
              />
              <SummaryRow
                title="Academic year & terms"
                state={stepDone.calendar ? "done" : "pending"}
                body={
                  <>
                    {calDraft.year_label || "Year not set"}
                    {calDraft.start_date && calDraft.end_date
                      ? ` (${calDraft.start_date} – ${calDraft.end_date})`
                      : ""}
                    {" · "}
                    {termSummary}
                  </>
                }
              />
              <SummaryRow
                title="Academic structure"
                state={stepDone.structure ? "done" : "pending"}
                body={
                  selectedGrades.length === 0
                    ? "No grades selected"
                    : `${selectedGrades.length} grade(s), ${streams.length} stream(s) · ${selectedGrades
                        .map((g) => gradeLabel(g))
                        .join(", ")}`
                }
              />
              <SummaryRow
                title="Finance baseline"
                state={stepDone.finance ? "done" : "pending"}
                body={
                  <>
                    {finance.category_name || "Category"} ({finance.category_code || "—"}) · KES{" "}
                    {finance.amount ? Number(finance.amount).toLocaleString("en-KE") : "0"} per term ·{" "}
                    {financeGradeIds.length} grade(s) ·{" "}
                    {[finance.paybill ? "Paybill" : "", finance.till ? "Till" : ""].filter(Boolean).join(" + ") ||
                      "No M-PESA channel"}
                  </>
                }
              />
              <SummaryRow
                title="Staff & learner seeds"
                state={seedsDone ? "done" : "optional"}
                body={
                  seedsDone
                    ? `${validStaffRows.length} staff, ${validLearnerRows.length} learners seeded`
                    : "Skipped — the school starts empty"
                }
              />
              <SummaryRow
                title="School admin prerequisite"
                state={adminOk ? "done" : "blocked"}
                body={adminCheck?.message || "No active school admin membership"}
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={handoffAck}
                  onChange={(e) => setHandoffAck(e.target.checked)}
                  disabled={handedOff}
                />
                Credentials and handoff instructions have been communicated to the School Admin, and the school now owns this tenant.
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  loading={saving === "handoff"}
                  disabled={!handoffAck || handedOff || (!isReadyForHandoff && !handedOff)}
                  onClick={markHandedOff}
                >
                  Mark handed off
                </Button>
                <span className="text-[13px] text-gray-600">
                  {handedOff
                    ? "This school has been handed off."
                    : isReadyForHandoff
                      ? "Ready. Tick the box and hand off."
                      : "Unlocks after the setup is marked ready for handoff."}
                </span>
              </div>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="p-4 pb-0">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link to="/platform/tenants" className="font-medium text-kenyan-red hover:underline">
          ← Tenant Registry
        </Link>
      </nav>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display font-display break-words">{school.school_name || "School setup"}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Tenant <span className="font-mono text-[13px] text-gray-700">{tenantId}</span> · platform setup is
            audited and resumable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={handedOff ? "success" : isReadyForHandoff ? "info" : "warning"}>
            {ONBOARDING_LABELS[onboardingStatus] || "Pending setup"}
          </Badge>
          {school.status && (
            <Badge variant="default">
              {school.status.charAt(0) + school.status.slice(1).toLowerCase()}
            </Badge>
          )}
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="mt-5 grid gap-6 pb-24 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-4">
          <Card className="p-3">
            <p className="px-3 pb-2 pt-1 text-[12px] font-semibold uppercase tracking-wider text-gray-500">
              Setup progress
            </p>
            <ol className="space-y-1">
              {STEPS.map((step, index) => {
                const state = stepState(step.key);
                const isActive = step.key === active;
                return (
                  <li key={step.key}>
                    <button
                      type="button"
                      onClick={() => goTo(step.key)}
                      aria-current={isActive ? "step" : undefined}
                      className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                        isActive ? "bg-red-50 text-kenyan-red" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className={`mt-0.5 w-4 shrink-0 text-center text-sm font-bold ${stateColor(state)}`}>
                        {stateIcon(state)}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm ${isActive ? "font-semibold" : "font-medium text-gray-800"}`}>
                          {index + 1}. {step.title}
                        </span>
                        <span className="block text-[12px] text-gray-500">{stateLabel(state, step.key)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
                          <div className="mt-3 border-t border-gray-200 px-3 pt-3 text-[13px] text-gray-600">
              School admin:{" "}
              <span className={adminOk ? "font-medium text-green-700" : "font-medium text-red-700"}>
                {adminOk ? "assigned ✓" : "missing !"}
              </span>
              {" · "}After handoff the school admin finishes admissions, fee structures, staff assignments, and parent/guardian linkage.
            </div>
          </Card>
          <p className="mt-3 hidden px-1 text-[13px] text-gray-500 lg:block">
            Steps 1–4 are required. Seeds are optional.
          </p>
        </aside>

        <div ref={stepCardRef} className="min-w-0 max-w-[760px] space-y-4 scroll-mt-4">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-500">
                  Step {activeIndex + 1} of {STEPS.length}
                </p>
                <h2 className="text-heading mt-1">{activeStep.title}</h2>
                <p className="mt-1 max-w-lg text-sm text-gray-600">{activeStep.blurb}</p>
              </div>
              {active === "seeds" && <Badge variant="warning">Optional</Badge>}
            </div>

            <div className="mt-5">
              {stepErrors[active] && (
                <div
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {stepErrors[active]}
                </div>
              )}
              {renderStep()}
            </div>

            {active !== "review" && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <SaveHint savedAt={savedAt[active]} dirty={dirty[active]} />
                <div className="flex flex-wrap items-center gap-2">
                  {activeIndex > 0 && (
                    <Button variant="secondary" size="sm" onClick={prevStep}>
                      Back
                    </Button>
                  )}
                  {active === "seeds" && (
                    <Button variant="ghost" size="sm" onClick={skipSeeds}>
                      Skip for now
                    </Button>
                  )}
                  {active === "profile" && (
                    <Button variant="primary" size="sm" loading={saving === "profile"} onClick={saveProfile}>
                      Save &amp; continue
                    </Button>
                  )}
                  {active === "calendar" && (
                    <Button variant="primary" size="sm" loading={saving === "calendar"} onClick={saveCalendar}>
                      Save &amp; continue
                    </Button>
                  )}
                  {active === "structure" && (
                    <Button variant="primary" size="sm" loading={saving === "structure"} onClick={saveStructure}>
                      Save &amp; continue
                    </Button>
                  )}
                  {active === "finance" && (
                    <Button variant="primary" size="sm" loading={saving === "finance"} onClick={saveFinance}>
                      Save &amp; continue
                    </Button>
                  )}
                  {active === "seeds" && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={saving === "seeds"}
                      disabled={staffHasErrors || learnerHasErrors}
                      title={staffHasErrors || learnerHasErrors ? "Fix the highlighted rows first" : undefined}
                      onClick={saveSeeds}
                    >
                      Save seeds &amp; continue
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>

          {active === "review" && (
                          <p className="text-[13px] text-gray-600">
                When the required steps are done, mark the school ready for handoff, then hand it over. After handoff the school admin owns this tenant and finishes admissions, fee structures, staff assignments, and parent/guardian linkage.
              </p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">{requiredDone} of 4 required steps done</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-hidden>
              {STEPS.slice(0, 4).map((step) => (
                <span
                  key={step.key}
                  className={`h-1.5 w-10 rounded-full ${
                    stepState(step.key) === "done"
                      ? "bg-green-600"
                      : stepState(step.key) === "blocked"
                        ? "bg-kenyan-red"
                        : "bg-gray-200"
                  }`}
                />
              ))}
              <span className="ml-1 text-[13px] text-gray-500">
                {school.subdomain ? `/${school.subdomain}` : tenantId}
              </span>
            </div>
            {!canMarkReady && !handedOff && (
              <p className="mt-1 max-w-xl text-[13px] text-amber-700">
                {missing.length > 0 ? `Still needed: ${Array.from(new Set(missing)).join("; ")}` : "Ready when you are."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {handedOff ? (
              <Badge variant="success">Handed off ✓</Badge>
            ) : (
              <Button
                variant="primary"
                loading={saving === "complete"}
                disabled={!canMarkReady}
                title={canMarkReady ? undefined : `Still needed: ${Array.from(new Set(missing)).join("; ")}`}
                onClick={markReady}
              >
                {isReadyForHandoff ? "Ready for handoff ✓" : "Mark ready for handoff"}
              </Button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

function SummaryRow({
  title,
  state,
  body,
}: {
  title: string;
  state: "done" | "pending" | "optional" | "blocked";
  body: ReactNode;
}) {
  const styles: Record<typeof state, string> = {
    done: "text-green-700",
    pending: "text-gray-400",
    optional: "text-gray-400",
    blocked: "text-red-700",
  };
  const glyph = state === "done" ? "✓" : state === "blocked" ? "!" : "○";
  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span className={`mt-0.5 w-4 shrink-0 text-center text-sm font-bold ${styles[state]}`}>{glyph}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-[13px] text-gray-600">{body}</p>
      </div>
    </div>
  );
}
