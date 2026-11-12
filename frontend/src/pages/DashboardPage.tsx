import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  ShieldAlert,
  Smartphone,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import { ACADEMIC_ROLES, FINANCE_ROLES, SCHOOL_ADMIN_ROLES } from "../lib/roles";
import ViewState from "../components/organisms/ViewState";
import Dialog from "../components/dialog/Dialog";
import HelpTip from "../components/atoms/HelpTip";
import { useToast } from "../components/toast/ToastProvider";
import { formatKES } from "../utils/currency";

interface FinanceSummary {
  collected: number;
  outstanding: number;
  invoice_count: number;
  unmatched_count: number;
  collection_rate: number;
  by_grade: { grade_label: string; total_amount: number; amount_paid: number; amount_outstanding: number }[];
}

interface ArrearsLearner {
  learner_id: string;
  admission_number: string;
  learner_name: string;
  grade_label: string;
  stream_name: string;
  outstanding: number;
  invoice_count: number;
  oldest_due_date: string;
  bucket: string;
}

interface MpesaEvent {
  event_id: string;
  trans_id: string;
  trans_time: string;
  amount: number;
  bill_ref?: string;
  status: "ALLOCATED" | "SUSPENSE" | "FAILED";
}

interface ReportRun {
  run_id: string;
  status: string;
  learner_count: number;
  generated_count: number;
  created_at: string;
  term_id?: string;
}

interface ReportCard {
  card_id: string;
  status: string;
}

interface Template {
  template_id: string;
  name?: string;
  is_default?: boolean;
}

const EMPTY_FINANCE: FinanceSummary = {
  collected: 0,
  outstanding: 0,
  invoice_count: 0,
  unmatched_count: 0,
  collection_rate: 0,
  by_grade: [],
};

const BUCKETS = [
  { key: "0_30", label: "Under KES 5,000" },
  { key: "30_60", label: "KES 5,000 – 19,999" },
  { key: "60_90", label: "KES 20,000 – 49,999" },
  { key: "90_PLUS", label: "KES 50,000+" },
];

const REMINDER_COPY =
  "Dear parent/guardian, our records show an outstanding school fee balance. Please settle it at your earliest convenience or contact the bursar's office to arrange a plan. Thank you.";

function safe<T>(promise: Promise<{ data: T }>, fallback: T): Promise<{ data: T; ok: boolean }> {
  return promise
    .then((res) => ({ data: res.data ?? fallback, ok: true }))
    .catch(() => ({ data: fallback, ok: false }));
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "ALLOCATED" || normalized === "PUBLISHED" || normalized === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { roles, tenantId } = useAuthStore();
  const { toast } = useToast();

  const isSaasAdmin = roles.includes("SAAS_ADMIN") || roles.includes("SUPER_ADMIN");
  const isParent = roles.includes("PARENT") || roles.includes("GUARDIAN");
  const canFinance = roles.some((r) => FINANCE_ROLES.includes(r as any));
  const canAcademic = roles.some((r) => ACADEMIC_ROLES.includes(r as any));
  const canGenerateReports = roles.some((r) => SCHOOL_ADMIN_ROLES.includes(r as any));

  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [finance, setFinance] = useState<FinanceSummary>(EMPTY_FINANCE);
  const [arrears, setArrears] = useState<ArrearsLearner[]>([]);
  const [events, setEvents] = useState<MpesaEvent[]>([]);
  const [mpesaStats, setMpesaStats] = useState({ total: 0, allocated: 0, suspense: 0, sync_percent: 0 });
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [counts, setCounts] = useState({ learners: 0, staff: 0, registers: 0, assessments: 0 });

  const [reminderOpen, setReminderOpen] = useState(false);
  const [selectedLearners, setSelectedLearners] = useState<string[]>([]);
  const [reminderBody, setReminderBody] = useState(REMINDER_COPY);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);

    const tasks: Promise<{ data: any; ok: boolean }>[] = [
      safe(api.get("/learners"), []),
      safe(api.get("/staff"), []),
      safe(api.get("/attendance/registers"), []),
      safe(api.get("/assessment/events"), []),
    ];
    if (canFinance) {
      tasks.push(
        safe<FinanceSummary>(api.get("/finance/dashboard"), EMPTY_FINANCE),
        safe(api.get("/finance/arrears"), { learners: [] }),
        safe(api.get("/finance/mpesa/events"), { events: [], stats: {} }),
      );
    }
    if (canAcademic) {
      tasks.push(
        safe(api.get("/reports/runs"), []),
        safe(api.get("/reports/cards"), []),
        safe(api.get("/reports/templates"), []),
      );
    }

    const results = await Promise.all(tasks);
    const byIndex = (i: number) => results[i]?.data;

    const learners = Array.isArray(byIndex(0)) ? byIndex(0) : [];
    const staff = Array.isArray(byIndex(1)) ? byIndex(1) : [];
    const registers = Array.isArray(byIndex(2)) ? byIndex(2) : [];
    const assessments = Array.isArray(byIndex(3)) ? byIndex(3) : [];

    setCounts({
      learners: learners.length,
      staff: staff.length,
      registers: registers.length,
      assessments: assessments.filter((e: any) => String(e.status || "").toUpperCase() === "OPEN").length,
    });

    let offset = 4;
    if (canFinance) {
      setFinance(byIndex(offset) ?? EMPTY_FINANCE);
      const arr = byIndex(offset + 1);
      setArrears(Array.isArray(arr?.learners) ? arr.learners : []);
      const ev = byIndex(offset + 2);
      setEvents(Array.isArray(ev?.events) ? ev.events : []);
      setMpesaStats({
        total: Number(ev?.stats?.total || 0),
        allocated: Number(ev?.stats?.allocated || 0),
        suspense: Number(ev?.stats?.suspense || 0),
        sync_percent: Number(ev?.stats?.sync_percent || 0),
      });
      offset += 3;
    }
    if (canAcademic) {
      setRuns(Array.isArray(byIndex(offset)) ? byIndex(offset) : []);
      setCards(Array.isArray(byIndex(offset + 1)) ? byIndex(offset + 1) : []);
      setTemplates(Array.isArray(byIndex(offset + 2)) ? byIndex(offset + 2) : []);
    }

    setDegraded(results.some((r) => !r.ok));
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    if (isSaasAdmin || isParent) {
      setLoading(false);
      return;
    }
    void load(true);
    // Role set is stable for the session; reload only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSaasAdmin, isParent, canFinance, canAcademic]);

  const bandTotals = useMemo(() => {
    return BUCKETS.map((bucket) => {
      const rows = arrears.filter((a) => a.bucket === bucket.key);
      return {
        ...bucket,
        count: rows.length,
        amount: rows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0),
      };
    });
  }, [arrears]);

  const publishedCards = cards.filter((c) => String(c.status).toUpperCase() === "PUBLISHED").length;
  const latestRun = runs[0];
  const reportPercent = cards.length > 0 ? Math.round((publishedCards * 100) / cards.length) : 0;

  const openReminderDialog = () => {
    setSelectedLearners(arrears.slice(0, 10).map((a) => a.learner_id));
    setReminderBody(REMINDER_COPY);
    setReminderOpen(true);
  };

  const sendReminders = async () => {
    if (selectedLearners.length === 0) {
      toast("Select at least one learner", { type: "error" });
      return;
    }
    setSendingReminders(true);
    try {
      const res = await api.post("/finance/arrears/reminders", {
        learner_ids: selectedLearners,
        body_text: reminderBody.trim() || undefined,
      });
      const queued = Number(res.data?.queued || 0);
      toast(
        `Queued ${queued} reminder${queued === 1 ? "" : "s"} to primary guardians`,
        { type: queued > 0 ? "success" : "warning" }
      );
      setReminderOpen(false);
    } catch (err: any) {
      toast(err.response?.data?.message || "Could not queue reminders", { type: "error" });
    } finally {
      setSendingReminders(false);
    }
  };

  const defaultTemplate = templates.find((tpl) => tpl.is_default) || templates[0];

  const openReportDialog = () => {
    if (!defaultTemplate) {
      toast("No report template is configured. Set one up before generating cards.", { type: "error" });
      return;
    }
    setReportOpen(true);
  };

  const generateReports = async () => {
    if (!defaultTemplate) return;
    setGenerating(true);
    try {
      await api.post("/reports/runs", {
        term_id: "current",
        template_id: defaultTemplate.template_id,
      });
      toast("Report card generation started", { type: "success" });
      setReportOpen(false);
      await load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Could not start report card generation", { type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <ViewState state="loading" />;

  // ---------- Parent variant ----------
  if (isParent) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-display">{t("dashboard")}</h1>
          <p className="text-body">Follow your children’s fees, attendance and progress.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link to="/parent" className="card block p-6 text-center hover:border-brand-800">
            <Users className="mx-auto mb-2 h-9 w-9 stroke-[1.5] text-brand-800" />
            <div className="text-heading mt-2">My Children</div>
          </Link>
          <Link to="/parent/fees" className="card block p-6 text-center hover:border-brand-800">
            <CreditCard className="mx-auto mb-2 h-9 w-9 stroke-[1.5] text-brand-800" />
            <div className="text-heading mt-2">Fees</div>
          </Link>
          <Link to="/parent/notices" className="card block p-6 text-center hover:border-brand-800">
            <Receipt className="mx-auto mb-2 h-9 w-9 stroke-[1.5] text-brand-800" />
            <div className="text-heading mt-2">Notices</div>
          </Link>
        </div>
      </div>
    );
  }

  // ---------- Platform variant ----------
  if (isSaasAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-display">Platform overview</h1>
          <p className="text-body">Tenant operations, subscriptions and service health.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link to="/platform/operations" className="card block p-5 hover:border-brand-800">
            <BarChart3 className="mb-2 h-5 w-5 text-brand-800" />
            <div className="font-medium text-slate-900">Operations Centre</div>
            <p className="mt-1 text-xs text-slate-500">Live tenant health and onboarding state.</p>
          </Link>
          <Link to="/platform/tenants" className="card block p-5 hover:border-brand-800">
            <Users className="mb-2 h-5 w-5 text-brand-800" />
            <div className="font-medium text-slate-900">Tenant Registry</div>
            <p className="mt-1 text-xs text-slate-500">Schools, plans and provisioning.</p>
          </Link>
          <Link to="/platform/subscriptions" className="card block p-5 hover:border-brand-800">
            <FileText className="mb-2 h-5 w-5 text-brand-800" />
            <div className="font-medium text-slate-900">Subscriptions</div>
            <p className="mt-1 text-xs text-slate-500">Billing and plan assignments.</p>
          </Link>
        </div>
      </div>
    );
  }

  // ---------- School leadership cockpit ----------
  const schoolCode = (() => {
    try {
      return localStorage.getItem("school_code") || tenantId || "—";
    } catch {
      return tenantId || "—";
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-700">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · {schoolCode}
          </p>
          <h1 className="mt-1 text-display">School command centre</h1>
          <p className="mt-1 text-sm text-slate-600">
            Fees, reconciliation and CBC readiness in one operating view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {canFinance && (
            <Link
              to="/finance/payments?action=record"
              className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-900"
            >
              <CreditCard className="h-4 w-4" /> Record payment
            </Link>
          )}
          <Link
            to="/learners?action=new"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" /> Add learner
          </Link>
        </div>
      </div>

      {degraded && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Some panels could not refresh. Figures shown may be incomplete; retry before relying on them for a
            board report.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canFinance ? (
          <>
        <Metric
          label="Fees collected"
          value={formatKES(finance.collected)}
          hint="Total amount paid against invoices in this school. The collection rate compares collected against collected plus outstanding."
          icon={<Wallet className="h-4 w-4" />}
          footnote={`${Math.round(finance.collection_rate)}% collection rate`}
        />
        <Metric
          label="Outstanding fees"
          value={formatKES(finance.outstanding)}
          hint="Sum of amount_outstanding across all invoices. Arrears below are grouped by the server's balance bands."
          icon={<TriangleAlert className="h-4 w-4" />}
          tone="warning"
          footnote={`${arrears.length} learner${arrears.length === 1 ? "" : "s"} in arrears`}
        />
        <Metric
          label="Unmatched receipts"
          value={String(finance.unmatched_count || 0)}
          hint="M-Pesa transactions recorded by the school that are not yet matched to an invoice. Match them from Reconciliation."
          icon={<Smartphone className="h-4 w-4" />}
          tone={finance.unmatched_count > 0 ? "warning" : "default"}
          footnote={`${events.filter((e) => e.status === "SUSPENSE").length} inbox receipt(s) awaiting review`}
        />
        <Metric
          label="Report cards published"
          value={`${publishedCards}/${cards.length}`}
          hint="Published report cards are visible to linked guardians. Draft cards remain internal until a run is published."
          icon={<ClipboardList className="h-4 w-4" />}
          footnote={cards.length ? `${reportPercent}% of generated cards published` : "No cards generated yet"}
        />
          </>
        ) : (
          <>
            <Metric
              label="Learners"
              value={String(counts.learners)}
              hint="Active learners visible to this school account."
              icon={<Users className="h-4 w-4" />}
              footnote="Enrolled learner records"
            />
            <Metric
              label="Staff"
              value={String(counts.staff)}
              hint="Staff profiles recorded for this school."
              icon={<Users className="h-4 w-4" />}
              footnote="Staff on record"
            />
            <Metric
              label="Open assessments"
              value={String(counts.assessments)}
              hint="Assessment events currently open for evidence capture."
              icon={<ClipboardList className="h-4 w-4" />}
              footnote="Events accepting results"
            />
            <Metric
              label="Report cards published"
              value={`${publishedCards}/${cards.length}`}
              hint="Published report cards are visible to linked guardians."
              icon={<FileText className="h-4 w-4" />}
              footnote={cards.length ? `${reportPercent}% of generated cards published` : "No cards generated yet"}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {canFinance && (
          <>
        <section className="card p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1 text-heading">
                Fee recovery radar
                <HelpTip text="Outstanding balances grouped by the server's balance bands. The oldest due date is shown per learner; this is not a days-overdue ageing calculation." />
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Prioritise balances and send a queued SMS to primary guardians without leaving the dashboard.
              </p>
            </div>
            <Link to="/finance/reconciliation" className="text-sm font-medium text-brand-800 hover:underline">
              Open reconciliation
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {bandTotals.map((band) => (
              <div key={band.key} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{band.label}</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{formatKES(band.amount)}</div>
                <div className="text-xs text-slate-500">{band.count} learner{band.count === 1 ? "" : "s"}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            {arrears.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600" />
                <p className="mt-2 text-sm font-medium text-slate-800">No outstanding balances</p>
                <p className="mt-1 text-xs text-slate-500">Every issued invoice is settled or no invoices exist yet.</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-100 sm:hidden">
                  {arrears.slice(0, 6).map((row) => (
                    <div key={`card-${row.learner_id}`} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{row.learner_name || "Unnamed learner"}</div>
                          <div className="font-mono text-[11px] text-slate-500">{row.admission_number || row.learner_id}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {[row.grade_label, row.stream_name].filter(Boolean).join(" · ") || "No class"}
                            {row.oldest_due_date ? ` · due ${dateLabel(row.oldest_due_date)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right font-semibold tabular-nums text-slate-900">
                          {formatKES(row.outstanding)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Learner</th>
                      <th className="px-4 py-2.5 font-medium">Grade</th>
                      <th className="px-4 py-2.5 font-medium text-right">Outstanding</th>
                      <th className="px-4 py-2.5 font-medium">Oldest due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {arrears.slice(0, 6).map((row) => (
                      <tr key={row.learner_id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{row.learner_name || "Unnamed learner"}</div>
                          <div className="font-mono text-[11px] text-slate-500">{row.admission_number || row.learner_id}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {[row.grade_label, row.stream_name].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                          {formatKES(row.outstanding)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{dateLabel(row.oldest_due_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Reminders are queued as SMS to primary guardians. Delivery depends on the configured SMS provider.
            </p>
            <button
              type="button"
              onClick={openReminderDialog}
              disabled={arrears.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-800 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-900 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Send fee reminders
            </button>
          </div>
        </section>

        <section className="card flex flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1 text-heading">
                Reconciliation feed
                <HelpTip text="C2B receipts arrive in the durable M-Pesa inbox first. Allocated receipts already have a payment; suspense receipts still need a learner or invoice match." />
              </h2>
              <p className="mt-1 text-sm text-slate-500">Latest receipts from the school paybill.</p>
            </div>
            <Link to="/finance/mpesa" className="text-xs font-medium text-brand-800 hover:underline">
              Ledger
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Receipts</div>
              <div className="text-sm font-semibold text-slate-900">{mpesaStats.total}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Allocated</div>
              <div className="text-sm font-semibold text-slate-900">{mpesaStats.allocated}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Synced</div>
              <div className="text-sm font-semibold text-slate-900">{mpesaStats.sync_percent}%</div>
            </div>
          </div>

          <div className="mt-4 flex-1 space-y-2">
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center">
                <Smartphone className="mx-auto h-5 w-5 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-700">No receipts yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  Receipts appear after the Safaricom callback is configured and the first payment arrives.
                </p>
              </div>
            ) : (
              events.slice(0, 4).map((event) => (
                <div key={event.event_id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium text-slate-800">{event.trans_id}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {event.bill_ref || "No reference"} · {dateLabel(event.trans_time)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-slate-900">{formatKES(event.amount)}</div>
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge(event.status)}`}>
                      {event.status === "SUSPENSE" ? "NEEDS REVIEW" : event.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <Link
            to="/finance/reconciliation"
            className="mt-4 inline-flex items-center justify-between rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <span className="inline-flex items-center gap-2"><ArrowRight className="h-4 w-4" /> Instant M-Pesa matcher</span>
          </Link>
        </section>
          </>
        )}

        <section className="card p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1 text-heading">
                CBC compliance &amp; report cards
                <HelpTip text="A report run generates cards from captured assessment results for the current term. Publishing releases cards to linked guardians; it does not change marks." />
              </h2>
              <p className="mt-1 text-sm text-slate-500">Readiness of the current reporting cycle.</p>
            </div>
            {canGenerateReports && (
              <button
                type="button"
                onClick={openReportDialog}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <FileText className="h-4 w-4" /> Generate report cards
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Open assessments</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{counts.assessments}</div>
              <Link to="/assessment" className="mt-2 inline-block text-xs font-medium text-brand-800 hover:underline">
                Review assessment events
              </Link>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Attendance registers</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{counts.registers}</div>
              <Link to="/attendance" className="mt-2 inline-block text-xs font-medium text-brand-800 hover:underline">
                Open attendance
              </Link>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Latest report run</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{latestRun?.status || "No run"}</span>
                {latestRun && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusBadge(latestRun.status)}`}>
                    {latestRun.generated_count}/{latestRun.learner_count} cards
                  </span>
                )}
              </div>
              <Link to="/reports" className="mt-2 inline-block text-xs font-medium text-brand-800 hover:underline">
                Open reports
              </Link>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Published cards</span>
              <span>{publishedCards} of {cards.length}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-800 transition-all" style={{ width: `${reportPercent}%` }} />
            </div>
            {cards.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Generate a run once marks are captured; cards appear here with print and publish controls.
              </p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-heading">Operating context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <dt className="flex items-center gap-2 text-slate-600"><Users className="h-4 w-4" /> Learners</dt>
              <dd className="font-semibold text-slate-900">{counts.learners}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <dt className="flex items-center gap-2 text-slate-600"><Users className="h-4 w-4" /> Staff</dt>
              <dd className="font-semibold text-slate-900">{counts.staff}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <dt className="flex items-center gap-2 text-slate-600"><Receipt className="h-4 w-4" /> Invoices issued</dt>
              <dd className="font-semibold text-slate-900">{finance.invoice_count}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2 text-slate-600"><CalendarCheck className="h-4 w-4" /> Registers</dt>
              <dd className="font-semibold text-slate-900">{counts.registers}</dd>
            </div>
          </dl>

          <div className="mt-5 space-y-2">
            <Link to="/attendance" className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
              <span className="inline-flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> Daily roll call</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link to="/finance/payments?action=record" className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
              <span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" /> Record fee payment</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            {canAcademic && (
              <Link to="/assessment" className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
                <span className="inline-flex items-center gap-2"><ClipboardList className="h-4 w-4" /> CBC rubric entry</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </section>
      </div>

      <Dialog open={reminderOpen} onClose={() => setReminderOpen(false)} title="Send fee reminders" className="max-w-xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Queues one SMS per selected learner to the primary guardian with a phone number on record. Learners without
            a primary payer are skipped by the server.
          </p>
          <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3">
            {arrears.slice(0, 12).map((row) => (
              <label key={row.learner_id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={selectedLearners.includes(row.learner_id)}
                    onChange={(e) =>
                      setSelectedLearners((prev) =>
                        e.target.checked ? [...prev, row.learner_id] : prev.filter((id) => id !== row.learner_id)
                      )
                    }
                  />
                  <span className="truncate text-slate-800">{row.learner_name || row.admission_number}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatKES(row.outstanding)}</span>
              </label>
            ))}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Message</span>
            <textarea
              rows={4}
              className="input-field resize-none"
              value={reminderBody}
              onChange={(e) => setReminderBody(e.target.value)}
              maxLength={480}
            />
            <span className="mt-1 block text-xs text-slate-500">Sent as-is; avoid learner names and fee amounts in SMS.</span>
          </label>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white pt-4">
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={() => setReminderOpen(false)} disabled={sendingReminders}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void sendReminders()}
              disabled={sendingReminders || selectedLearners.length === 0}
            >
              {sendingReminders ? "Queuing…" : `Queue ${selectedLearners.length} reminder${selectedLearners.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog open={reportOpen} onClose={() => setReportOpen(false)} title="Generate report cards" className="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Generates report cards for the current term using <strong>{defaultTemplate?.name || "the default template"}</strong>.
            Existing results are used; marks are not changed.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Cards are created as drafts. Review them in Reports before publishing to guardians.
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white pt-4">
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={() => setReportOpen(false)} disabled={generating}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              onClick={() => void generateReports()}
              disabled={generating}
            >
              {generating ? "Starting…" : "Generate cards"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function Metric({
  label,
  value,
  footnote,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  footnote: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide">
          {label}
          <HelpTip text={hint} />
        </span>
        <span className={tone === "warning" ? "text-amber-700" : "text-slate-400"}>{icon}</span>
      </div>
      <div className={`mt-2 break-words text-xl font-semibold tabular-nums ${tone === "warning" ? "text-amber-900" : "text-slate-900"}`}>
        {value}
      </div>
      <p className="mt-1 text-xs text-slate-500">{footnote}</p>
    </div>
  );
}
