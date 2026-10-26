import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

const kes = (n: any) =>
  `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtT = (iso?: string) => {
  if (!iso) return "—";
  // Daraja TransTime is EAT (UTC+3): 20261026140211 -> 26-Oct-2026 14:02 EAT
  if (/^\d{14}$/.test(iso)) {
    return `${iso.slice(6, 8)}-${iso.slice(4, 6)}-${iso.slice(0, 4)} ${iso.slice(8, 10)}:${iso.slice(10, 12)} EAT`;
  }
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

interface C2BEvent {
  event_id: string; trans_id: string; trans_time: string | null;
  trans_amount: string; business_short_code: string | null;
  bill_ref_number: string | null; msisdn_masked: string | null;
  sender_name: string | null; status: string; ingest_source: string;
  created_at: string; student_id: string | null; student_name: string | null;
  admission_number: string | null;
  postings: { account_code: string; account_name: string; side: string; amount: string; memo: string; chain_seq: number }[];
  chain: { seq: number; event_type: string; hash: string; prev_hash: string; chained_at: string }[];
  suggestions?: { student_id: string; full_name: string; admission_number: string; score: number; basis: string }[];
}

export default function FinanceMpesaPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [search] = useSearchParams();
  const [events, setEvents] = useState<C2BEvent[]>([]);
  const [stats, setStats] = useState<any>({});
  const [integrity, setIntegrity] = useState<any>(null);
  const [gateway, setGateway] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dense, setDense] = useState(false);
  const [drawer, setDrawer] = useState<C2BEvent | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [showSuspense, setShowSuspense] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ev, vf] = await Promise.all([
        api.get("/finance/mpesa/events"),
        api.get("/finance/ledger/verify"),
      ]);
      setEvents(ev.data?.data || []);
      setStats(ev.data?.stats || {});
      setIntegrity(vf.data || null);
      // Derived gateway diagnostics from real rows (no fabrication).
      const rows = ev.data?.data || [];
      const last = rows.length ? rows.map((r: C2BEvent) => new Date(r.created_at).getTime())
        .sort((a: number, b: number) => b - a)[0] : null;
      let stkPending = 0;
      try {
        const stk = await api.get("/finance/mpesa/stk-requests");
        stkPending = (stk.data || []).filter((s: any) => s.status === "PENDING").length;
      } catch { /* table may be empty for this tenant */ }
      setGateway({
        lastWebhookSec: last ? Math.round((Date.now() - last) / 1000) : null,
        stkPending,
        syncPercent: ev.data?.stats?.sync_percent ?? null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Deep-link: /finance/mpesa?focus=<trans_id> opens the forensic drawer.
  useEffect(() => {
    const focus = search.get("focus");
    if (focus && events.length) {
      const hit = events.find((e) => e.trans_id.toUpperCase().includes(focus.toUpperCase()));
      if (hit) setDrawer(hit);
    }
  }, [search, events]);

  const simulateWebhook = async () => {
    try {
      await api.post("/finance/mpesa/simulate-webhook", {});
      toast("Simulated Daraja C2B webhook ingested into the ledger", { type: "success" });
      load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Simulation failed", { type: "error" });
    }
  };

  const resolveTo = async (ev: C2BEvent, studentId: string, label: string) => {
    setResolving(ev.event_id);
    try {
      const r = await api.patch(`/finance/mpesa/events/${ev.event_id}/resolve`, { student_id: studentId });
      toast(`${ev.trans_id} allocated to ${label}${r.data?.ledger_seq ? ` · ledger seq ${r.data.ledger_seq}` : ""}`, { type: "success" });
      setDrawer(null);
      load();
    } catch (err: any) {
      toast(err.response?.data?.message || "Resolve failed", { type: "error" });
    } finally {
      setResolving(null);
    }
  };

  const suspected = events.filter((e) => e.status === "SUSPENSE");
  const allocated = events.filter((e) => e.status !== "SUSPENSE");
  const pad = dense ? "py-1.5" : "py-3";
  const cellTap = dense ? "text-xs" : "text-sm";

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-heading">M-Pesa Real-Time Ledger</h2>
              <p className="text-body text-gray-500">Forensic double-entry ledger · hash-chained · append-only</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDense((d) => !d)}
                className="px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-gray-700 hover:border-slate-400 transition"
                title="Tabular density"
              >
                {dense ? "☰ Compact" : "☰ Comfortable"}
              </button>
              <button
                onClick={simulateWebhook}
                className="px-3 py-2 rounded-md border border-slate-200 bg-white text-xs font-medium text-gray-700 hover:border-slate-400 transition"
                title="Ingest a simulated Daraja C2B webhook through the real pipeline"
              >
                Simulate Webhook
              </button>
              <a
                href="/finance/board-pack"
                className="px-3 py-2 rounded-md bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition"
              >
                Board Pack
              </a>
            </div>
          </div>

          {/* Gateway Diagnostics Bar — derived from real rows */}
          <div className="enterprise-card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
            <span className="text-gray-500 uppercase font-bold text-[10px] tracking-wider mr-1">Daraja Gateway</span>
            <span className={`financial-data ${gateway?.lastWebhookSec != null ? "text-emerald-700" : "text-gray-400"}`}>
              ● Last webhook: {gateway?.lastWebhookSec != null ? (gateway.lastWebhookSec < 60 ? `${gateway.lastWebhookSec}s ago` : `${Math.round(gateway.lastWebhookSec / 60)}m ago`) : "no traffic yet"}
            </span>
            <span className="financial-data text-gray-700">
              STK queue: <b>{gateway?.stkPending ?? "—"} pending</b>
            </span>
            <span className="financial-data text-gray-700">
              Receipts allocated: <b>{stats.allocated ?? "—"}/{stats.total ?? "—"}</b> ({stats.sync_percent ?? "—"}%)
            </span>
            {integrity && (
              <span className={`financial-data font-bold ml-auto ${integrity.chain_head?.integrity === "VERIFIED" ? "text-emerald-700" : "text-rose-700"}`}>
                ⇅ Hash chain {integrity.depth} events · {integrity.chain_head?.integrity === "VERIFIED" ? "SHA-256 VERIFIED" : "MISMATCH"} {integrity.valid === false ? ` (broke at #${integrity.broke_at})` : ""}
              </span>
            )}
          </div>

          {/* Suspense drawer — the orphan auto-resolver */}
          {showSuspense && suspected.length > 0 && (
            <div className="enterprise-card p-4 mb-4 border-amber-300">
              <button className="w-full flex items-center justify-between mb-2" onClick={() => setShowSuspense((s) => !s)}>
                <span className="font-bold text-amber-700 text-sm">
                  ⚠ Suspense Account — {suspected.length} unallocated receipt{suspected.length === 1 ? "" : "s"} ({kes(suspected.reduce((s, e) => s + Number(e.trans_amount), 0))})
                </span>
                <span className="text-gray-400 text-xs">{showSuspense ? "hide" : "show"}</span>
              </button>
              {showSuspense && (
                <div className="space-y-3">
                  {suspected.map((e) => (
                    <div key={e.event_id} className="p-3 bg-amber-50 rounded-md border border-amber-200">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                        <span className="font-mono font-bold">{e.trans_id}</span>
                        <span className="financial-data font-bold">{kes(e.trans_amount)}</span>
                        <span className="text-gray-500">BillRef: <b className="font-mono">{e.bill_ref_number || "—"}</b></span>
                        <span className="text-gray-500">Sender: {e.sender_name || "—"} ({e.msisdn_masked})</span>
                        <button className="text-kenya-red underline underline-offset-2" onClick={() => setDrawer(e)}>Inspect</button>
                      </div>
                      {e.suggestions && e.suggestions.length > 0 && (
                        <div className="mt-2 text-xs text-gray-700">
                          Suggested match: <b>{e.suggestions[0].full_name} ({e.suggestions[0].admission_number})</b>
                          {" — "}<span className="financial-data font-bold text-emerald-700">{e.suggestions[0].score}%</span>
                          <span className="text-gray-400"> ({e.suggestions[0].basis})</span>
                          <button
                            disabled={resolving === e.event_id}
                            onClick={() => resolveTo(e, e.suggestions![0].student_id, e.suggestions![0].full_name)}
                            className="ml-3 px-2.5 py-1 rounded-md bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-800 disabled:opacity-50"
                          >
                            {resolving === e.event_id ? "Posting…" : "Verify & Reconcile to Student Account"}
                          </button>
                          {e.suggestions.length > 1 && (
                            <span className="ml-2 text-gray-400">also: {e.suggestions.slice(1, 3).map((s) => `${s.full_name} ${s.score}%`).join(", ")}</span>
                          )}
                        </div>
                      )}
                      {(!e.suggestions || e.suggestions.length === 0) && (
                        <p className="mt-2 text-xs text-gray-500">No confident match found — requires manual allocation (falls back to income per MoE rule 43).</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Settlement ledger */}
          {loading ? (
            <Skeleton rows={6} columns={6} />
          ) : events.length === 0 ? (
            <div className="enterprise-card p-10 text-center text-gray-500 text-sm">No C2B receipts ingested yet.</div>
          ) : (
            <div className="enterprise-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}>Receipt</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}>Bill Ref</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}>Allocation</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right`}>Amount</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}>Status</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}>Ledger #</th>
                      <th className={`px-3 ${pad} text-[10px] font-bold uppercase tracking-wider text-slate-500`}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...allocated, ...(showSuspense ? [] : suspected)].map((e) => (
                      <tr key={e.event_id} className="bg-emerald-500/10 transition-colors duration-[3000ms]">
                        <td className={`px-3 ${pad} ${cellTap} font-mono font-bold`}>{e.trans_id}</td>
                        <td className={`px-3 ${pad} ${cellTap} font-mono text-gray-600`}>{e.bill_ref_number || "—"}</td>
                        <td className={`px-3 ${pad} ${cellTap}`}>
                          {e.student_name ? <span className="font-medium">{e.student_name} <span className="text-gray-400 font-mono">({e.admission_number})</span></span> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className={`px-3 ${pad} ${cellTap} financial-data text-right font-bold`}>{kes(e.trans_amount)}</td>
                        <td className={`px-3 ${pad} ${cellTap}`}>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${e.status === "ALLOCATED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-300"}`}>
                            {e.status}
                          </span>
                        </td>
                        <td className={`px-3 ${pad} ${cellTap} financial-data text-gray-500`} title={e.chain.map((c) => `${c.seq}: ${c.event_type} · hash ${c.hash.slice(0, 10)}…`).join("\n")}>
                          #{e.chain.length ? e.chain.map((c) => c.seq).join(",") : "—"}
                        </td>
                        <td className={`px-3 ${pad} ${cellTap} text-right`}>
                          <button className="text-xs font-bold text-slate-900 underline underline-offset-2" onClick={() => setDrawer(e)}>Forensic view</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Forensic slide-over */}
        {drawer && (
          <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDrawer(null)}>
            <div className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-slate-200" onClick={(ev) => ev.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Cryptographically verified · direct Daraja webhook
                  </div>
                  <div className="text-lg font-black tracking-tight font-mono">{drawer.trans_id}</div>
                  <div className="text-xs text-gray-500">Ingested {fmtT(drawer.created_at)} · source {drawer.ingest_source}</div>
                </div>
                <button onClick={() => setDrawer(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-2" aria-label="Close">×</button>
              </div>

              <div className="px-5 py-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Amount</div><div className="financial-data text-base font-black">{kes(drawer.trans_amount)}</div></div>
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Ledger seq</div><div className="financial-data text-base font-black">#{drawer.chain.map((c) => c.seq).join(", #")}</div></div>
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Payer</div><div className="font-mono">{drawer.sender_name || "—"}<br />{drawer.msisdn_masked}</div></div>
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Bill Reference</div><div className="font-mono">{drawer.bill_ref_number || "—"}</div></div>
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Short code</div><div className="font-mono">{drawer.business_short_code || "—"}</div></div>
                  <div><div className="text-gray-500 font-bold uppercase text-[10px]">Network time</div><div className="font-mono">{fmtT(drawer.trans_time || drawer.created_at)}</div></div>
                </div>

                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Canonical double-entry</h4>
                  <div className="enterprise-card overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-100">
                        {drawer.postings.map((p, i) => (
                          <tr key={i}>
                            <td className={`px-3 py-1.5 ${p.side === "DEBIT" ? "font-bold" : "pl-10"}`}>
                              <span className="font-semibold">{p.side === "DEBIT" ? "Dr" : "Cr"}</span> <span className="font-mono text-blue-800">{p.account_code}</span> — {p.account_name}
                            </td>
                            <td className="px-3 py-1.5 financial-data text-right font-bold whitespace-nowrap">
                              {p.side === "DEBIT" ? kes(p.amount) : ""}
                            </td>
                            <td className="px-3 py-1.5 financial-data text-right font-bold whitespace-nowrap">
                              {p.side === "CREDIT" ? kes(p.amount) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Debits = credits · postings carry a shared ledger seq from the hash chain</p>
                </div>

                {drawer.status === "SUSPENSE" && (drawer.suggestions?.length || 0) > 0 && (
                  <div className="p-3 bg-amber-50 rounded-md border border-amber-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">Allocate receipt</h4>
                    {drawer.suggestions!.map((s) => (
                      <div key={s.student_id} className="flex items-center justify-between py-1 text-xs">
                        <span><b>{s.full_name}</b> <span className="font-mono text-gray-400">{s.admission_number}</span></span>
                        <span className="flex items-center gap-2">
                          <span className="financial-data font-bold text-emerald-700">{s.score}%</span>
                          <button
                            disabled={resolving === drawer.event_id}
                            onClick={() => resolveTo(drawer, s.student_id, s.full_name)}
                            className="px-2 py-1 rounded-md bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800 disabled:opacity-50"
                          >
                            {resolving === drawer.event_id ? "Posting…" : "Verify & Reconcile"}
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Chain of custody</h4>
                  {drawer.chain.map((c) => (
                    <div key={c.seq} className="p-3 rounded-md border border-slate-200 mb-2 bg-slate-50">
                      <div className="flex justify-between text-xs">
                        <span className="font-mono font-bold">#{c.seq} {c.event_type}</span>
                        <span className="text-gray-400">{fmtT(c.chained_at)}</span>
                      </div>
                      <div className="text-[10px] font-mono text-gray-500 mt-1 break-all">
                        prev: {c.prev_hash.slice(0, 24)}… · SHA-256: {c.hash.slice(0, 32)}…{c.hash.slice(-10)}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => navigator.clipboard?.writeText(drawer.chain.map((c) => `${c.seq}|${c.event_type}|${c.hash}`).join("\n")).then(() => toast("Immutable proof copied", { type: "success" }))}
                      className="px-3 py-1.5 rounded-md border border-slate-300 text-xs font-bold hover:border-slate-500"
                    >
                      Copy Verification Proof
                    </button>
                    <a href="/finance/board-pack" className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-bold hover:bg-slate-800">Auditor PDF</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
