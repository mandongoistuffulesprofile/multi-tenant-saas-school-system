import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import { KPIStatCard } from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";
import { Tenant, TenantUsage, Plan, Subscription } from "../../lib/types";
import { SharpShield } from "../../components/icons";

interface AssistanceRequest {
  request_id: string;
  user_id: string;
  identifier: string;
  email: string;
  phone: string;
  tenant_id: string;
  school_name: string;
  note: string;
  status: "PENDING" | "RESOLVED" | string;
  created_at: string;
  resolved_at?: string;
  resolution_method?: string;
}

interface IssuedCode {
  code: string;
  expires_at: string;
  expires_in_minutes: number;
  identifier: string;
  user_id: string;
  message: string;
}

export default function OperationsCentrePage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [usage, setUsage] = useState<TenantUsage[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [health, setHealth] = useState<any[]>([]);

  // SaaS-admin last resort: password help queue.
  const [assistance, setAssistance] = useState<AssistanceRequest[]>([]);
  const [pendingHelp, setPendingHelp] = useState(0);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [assistError, setAssistError] = useState("");
  const [copied, setCopied] = useState(false);

  const refreshAssistance = async () => {
    try {
      const response = await api.get("/platform/password-assistance");
      setAssistance(Array.isArray(response.data?.requests) ? response.data.requests : []);
      setPendingHelp(Number(response.data?.pending) || 0);
    } catch {
      // Best effort: the rest of the operations centre stays usable.
    }
  };

  useEffect(() => {
    apiGet<Tenant[]>("/platform/tenants").then((d) => setTenants(Array.isArray(d) ? d : []));
    apiGet<TenantUsage[]>("/platform/usage").then((d) => setUsage(Array.isArray(d) ? d : []));
    apiGet<Plan[]>("/platform/plans").then((d) => setPlans(Array.isArray(d) ? d : []));
    apiGet<Subscription[]>("/platform/subscriptions").then((d) => setSubs(Array.isArray(d) ? d : []));
    apiGet<any[]>("/platform/integrations").then((d) => setHealth(Array.isArray(d) ? d : []));
    setState("content");
    // Safety net for any silently-hung fetch: the KPIs render with defaults.
    const safety = setTimeout(() => setState((s) => (s === "loading" ? "content" : s)), 2500);
    // Notification: poll the help queue so new requests surface without a reload.
    refreshAssistance();
    const poll = setInterval(refreshAssistance, 30000);
    return () => {
      clearTimeout(safety);
      clearInterval(poll);
    };
  }, []);

  const issueForRequest = async (requestID: string) => {
    setAssistError("");
    setIssuing(requestID);
    try {
      const response = await api.post(`/platform/password-assistance/${requestID}/code`);
      setIssued(response.data as IssuedCode);
      setCopied(false);
      await refreshAssistance();
    } catch (err: any) {
      setAssistError(err.response?.data?.message || "Could not issue a reset code.");
    } finally {
      setIssuing(null);
    }
  };

  const issueForIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setAssistError("");
    if (!lookup.trim()) {
      setAssistError("Enter the user's email address or phone number.");
      return;
    }
    setIssuing("lookup");
    try {
      const response = await api.post("/platform/password-reset-codes", {
        identifier: lookup.trim(),
      });
      setIssued(response.data as IssuedCode);
      setCopied(false);
      setLookup("");
      await refreshAssistance();
    } catch (err: any) {
      setAssistError(err.response?.data?.message || "Could not issue a reset code.");
    } finally {
      setIssuing(null);
    }
  };

  const copyCode = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable; the code stays visible for manual copy.
    }
  };

  if (state === "loading") return <ViewState state="loading" />;

  // Logical fix: "Active Tenants" counts tenants, and MRR is derived from what
  // tenants actually subscribe to — never from the plan catalog.
  const activeTenants = tenants.filter((t) => t.status === "ACTIVE").length;
  const mrr = subs.reduce((sum, s) => {
    const plan = plans.find((p) => p.plan_id === s.plan_id);
    return sum + (s.status === "CANCELLED" ? 0 : plan?.price_monthly ?? 0);
  }, 0);
  // Derived from the real platform/integrations rows — no made-up numbers.
  const healthy = health.filter((h) => h.status === "healthy").length;
  const alerts = health.filter((h) => h.status === "down" || h.status === "degraded").length;
  const apiSuccess = healthy + alerts > 0 ? Math.round((healthy / (healthy + alerts)) * 100) : null;
  const latest = usage[0];
  const pendingRequests = assistance.filter((r) => r.status === "PENDING");
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-display font-display">{t("saas.operations")}</h1>

      {pendingHelp > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 text-xs font-bold text-white">
            {pendingHelp}
          </span>
          <div>
            <strong>
              {pendingHelp} user{pendingHelp === 1 ? "" : "s"} need password help.
            </strong>{" "}
            Verify their identity, then issue a one-time reset code in the Password assistance
            section below.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPIStatCard title={'Active Tenants'} value={activeTenants} />
        <KPIStatCard title={'API Success Rate'} value={apiSuccess != null ? `${apiSuccess}%` : "—"} />
        <KPIStatCard title={'MRR'} value={`KES ${mrr.toLocaleString()}`} />
        <KPIStatCard title={'Alerts'} value={alerts} trend={alerts > 0 ? { label: "providers degraded", value: alerts, positive: false } : undefined} icon={SharpShield} />
        <KPIStatCard
          title={'Password Help'}
          value={pendingHelp}
          trend={pendingHelp > 0 ? { label: "waiting for a reset code", value: pendingHelp, positive: false } : undefined}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-heading">Password assistance</h3>
            <p className="text-sm text-gray-600 mt-1">
              Last resort when a user cannot answer their security questions. Verify the user
              out-of-band (call the school's registered number) before issuing a code.
            </p>
          </div>
          <Badge variant={pendingHelp > 0 ? "warning" : "success"}>
            {pendingHelp > 0 ? `${pendingHelp} pending` : "Queue clear"}
          </Badge>
        </div>

        {assistError && (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {assistError}
          </p>
        )}

        {issued && (
          <div className="mb-4 rounded-xl border border-kenyan-green/40 bg-kenyan-green/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  One-time reset code for {issued.identifier}
                </p>
                <p className="mt-1 font-mono text-2xl tracking-[0.2em] text-kenyan-green">
                  {issued.code}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={copyCode}>
                  {copied ? "Copied" : "Copy code"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setIssued(null)}>
                  Done
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-600">
              Give this code to the user over a verified channel. It expires in{" "}
              {issued.expires_in_minutes} minutes ({new Date(issued.expires_at).toLocaleTimeString()})
              and works once. The user enters it on the forgot-password page under "Support code".
            </p>
          </div>
        )}

        <form onSubmit={issueForIdentifier} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            className="input-field sm:flex-1"
            placeholder="Issue a code directly: user email or phone number"
            aria-label="User email or phone number"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={issuing === "lookup"}>
            {issuing === "lookup" ? "Issuing…" : "Issue code"}
          </button>
        </form>

        <DataTable
          data={assistance.map((r) => ({ ...r })) as any}
          columns={[
            { key: "identifier", header: "User" },
            {
              key: "school_name",
              header: "School",
              render: (row: AssistanceRequest) => row.school_name || row.tenant_id || "—",
            },
            {
              key: "note",
              header: "Request",
              render: (row: AssistanceRequest) => (
                <span className="line-clamp-2 max-w-xs">{row.note || "—"}</span>
              ),
            },
            {
              key: "status",
              header: t("status"),
              render: (row: AssistanceRequest) => (
                <Badge variant={row.status === "PENDING" ? "warning" : "success"}>
                  {row.status}
                </Badge>
              ),
            },
            {
              key: "created_at",
              header: "Requested",
              render: (row: AssistanceRequest) => new Date(row.created_at).toLocaleString(),
            },
            {
              key: "action",
              header: "",
              render: (row: AssistanceRequest) =>
                row.status === "PENDING" ? (
                  <button
                    type="button"
                    className="btn-primary px-3 py-1 text-xs"
                    disabled={issuing === row.request_id}
                    onClick={() => issueForRequest(row.request_id)}
                  >
                    {issuing === row.request_id ? "Issuing…" : "Issue code"}
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">{row.resolution_method || "resolved"}</span>
                ),
            },
          ]}
          emptyMessage={'No password help requests'}
          keyField="request_id"
        />
        {pendingRequests.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {pendingRequests.length} pending request{pendingRequests.length === 1 ? "" : "s"}. The
            queue refreshes every 30 seconds.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-heading mb-3">{'Integration Health'}</h3>
        <DataTable
          data={health.map((h) => ({ name: h.name, status: h.status, rate: h.success_rate != null ? `${h.success_rate}%` : "—", lag: h.callback_lag ?? "—" })) as any}
          columns={[
            { key: "name", header: t("name") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "rate", header: t("saas.success_rate") },
            { key: "lag", header: t("saas.callback_lag") },
          ]}
          emptyMessage={'No data'}
          keyField="name"
        />
      </Card>
    </div>
  );
}

function apiGet<T>(path: string): Promise<T> {
  return api.get<T>(path).then((r) => r.data);
}
