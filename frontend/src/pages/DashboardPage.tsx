import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../lib/authStore";
import { api } from "../lib/api";
import Card from "../components/atoms/Card";
import { KPIStatCard } from "../components/atoms/Card";
import Badge from "../components/atoms/Badge";
import ViewState from "../components/organisms/ViewState";
import { Role } from "../lib/types";
import { User2, Megaphone, Puzzle, BarChart3, Plus, Users, Receipt, CreditCard, Clock } from "lucide-react";

export interface DashboardStat {
  label: string;
  value: string | number;
  role: Role[];
}

interface SchoolSnapshot {
  learners: number;
  staff: number;
  invoices: any[];
  payments: any[];
  registers: number;
  events: number;
  audit: any[];
}

const money = (n: number) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function DashboardPage() {
  const { t } = useTranslation();
  const { roles, tenantId } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [snap, setSnap] = useState<SchoolSnapshot | null>(null);
  const [subs, setSubs] = useState<number>(0);
  const [usage, setUsage] = useState<number>(0);

  const isSaasAdmin = roles.includes("SAAS_ADMIN");
  const isSchoolStaff = roles.includes("SCHOOL_ADMIN") || roles.includes("TEACHER") || roles.includes("ADMIN");
  const isParent = roles.includes("PARENT") || roles.includes("GUARDIAN");

  useEffect(() => {
    if (isSaasAdmin) {
      Promise.all([
        api.get("/platform/subscriptions").catch(() => ({ data: [] })),
        api.get("/platform/usage").catch(() => ({ data: [] })),
      ]).then(([s, u]) => {
        setSubs(Array.isArray(s.data) ? s.data.length : 0);
        setUsage(Array.isArray(u.data) ? u.data.length : 0);
        setLoading(false);
      });
      return;
    }
    if (!isSchoolStaff) { setLoading(false); return; }
    Promise.all([
      api.get("/learners"),
      api.get("/staff"),
      api.get("/finance/invoices"),
      api.get("/finance/payments"),
      api.get("/attendance/registers"),
      api.get("/assessment/events"),
      api.get("/compliance/access-logs"),
    ])
      .then(([le, st, inv, pay, reg, ev, au]) => {
        setSnap({
          learners: Array.isArray(le.data) ? le.data.length : 0,
          staff: Array.isArray(st.data) ? st.data.length : 0,
          invoices: Array.isArray(inv.data) ? inv.data : [],
          payments: Array.isArray(pay.data) ? pay.data : [],
          registers: Array.isArray(reg.data) ? reg.data.length : 0,
          events: Array.isArray(ev.data) ? ev.data.filter((e: any) => e.status === "OPEN").length : 0,
          audit: Array.isArray(au.data) ? au.data.slice(0, 6) : [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [roles, isSaasAdmin, isSchoolStaff]);

  if (loading) return <ViewState state="loading" />;

  // ---------- Parent variant ----------
  if (isParent) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-display">{t("dashboard")}</h1>
          <p className="text-body">Follow your children’s fees, attendance and progress.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a href="/parent" className="card p-6 text-center hover:border-kenyan-red transition block">
            <User2 className="w-10 h-10 mx-auto mb-2 stroke-[1.5]" />
            <div className="text-heading mt-2">{'My Children'}</div>
          </a>
          <a href="/parent/fees" className="card p-6 text-center hover:border-kenyan-red transition block">
            <CreditCard className="w-10 h-10 mx-auto mb-2 stroke-[1.5]" />
            <div className="text-heading mt-2">{'Fees'}</div>
          </a>
          <a href="/parent/notices" className="card p-6 text-center hover:border-kenyan-red transition block">
            <Megaphone className="w-10 h-10 mx-auto mb-2 stroke-[1.5]" />
            <div className="text-heading mt-2">{'Notices'}</div>
          </a>
        </div>
      </div>
    );
  }

  // ---------- SaaS admin variant ----------
  if (isSaasAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-display">{t("dashboard")}</h1>
          <p className="text-body">{'Platform overview'}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPIStatCard title={t("finance.subscriptions")} value={subs} />
          <KPIStatCard title={t("finance.usage_records")} value={usage} />
        </div>
        <Card className="p-6">
          <h3 className="text-heading mb-3">{'Quick actions'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <a href="/saas-admin" className="p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <Puzzle className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'SaaS Console'}</div>
            </a>
            <a href="/platform/operations" className="p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <BarChart3 className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Operations Centre'}</div>
            </a>
            <a href="/platform/tenants" className="p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <Users className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Tenants'}</div>
            </a>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- School staff / admin variant ----------
  const outstanding = (snap?.invoices || []).reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);
  const collected = (snap?.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const paidToday = (snap?.payments || []).filter((p) => {
    try { return new Date(p.created_at || p.payment_date || Date.now()).toDateString() === new Date().toDateString(); } catch { return false; }
  }).length;

  const kpis = [
    { label: 'Learners', value: snap?.learners ?? 0, accent: "text-kenyan-red" },
    { label: 'Staff', value: snap?.staff ?? 0, accent: "text-kenyan-green" },
    { label: 'Fees Outstanding', value: money(outstanding), accent: "text-kenyan-red" },
    { label: 'Collected to Date', value: money(collected), accent: "text-kenyan-green" },
  ];

  const activityLabel = (a: any) => {
    const action: string = String(a.action || "").replace(/_/g, " ").toLowerCase();
    const who: string = a.actor_email || "";
    return `${action} — ${who.split("@")[0]}${a.detail ? ` · ${a.detail}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-display">{t("dashboard")}</h1>
          <p className="text-body">{(() => { try { return localStorage.getItem("school_code") || tenantId || "—"; } catch { return tenantId || "—"; } })()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((c) => (
          <div key={c.label} className="card p-5">
            <h3 className="text-caption uppercase tracking-wide mb-1">{c.label}</h3>
            <p className={`text-2xl font-bold ${c.accent}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="text-heading mb-3">{'Today at a glance'}</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-gray-600"> {'Payments recorded today'}</span>
              <span className="font-bold text-gray-900">{paidToday}</span>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-gray-600"> {'Open assessment events'}</span>
              <span className="font-bold text-gray-900">{snap?.events ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600"> {'Attendance registers'}</span>
              <span className="font-bold text-gray-900">{snap?.registers ?? 0}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-heading mb-3">{'Quick actions'}</h3>
          <div className="space-y-2">
            <a href="/learners" className="block p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <Plus className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Add Learner'}</div>
            </a>
            <a href="/finance/invoices" className="block p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <Receipt className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Generate Invoice'}</div>
            </a>
            <a href="/finance/payments" className="block p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <CreditCard className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Record Payment'}</div>
            </a>
            <a href="/attendance" className="block p-3 bg-white border border-gray-200 rounded-xl hover:border-slate-900 transition text-center font-medium text-sm text-gray-800">
              <Clock className="w-5 h-5 mx-auto mb-1 stroke-[1.5]" />
              <div className="text-xs">{'Attendance Register'}</div>
            </a>
          </div>
        </Card>
      </div>

      {snap && snap.audit.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-heading">{'Recent activity'}</h3>
            <a href="/compliance" className="text-xs text-kenyan-red hover:underline font-medium">{'View all'}</a>
          </div>
          <div className="space-y-2">
            {snap.audit.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                <span className="text-gray-700 truncate pr-4">{activityLabel(a)}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="default">{(a.action || "").replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-gray-400">{a.accessed_at ? new Date(a.accessed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
