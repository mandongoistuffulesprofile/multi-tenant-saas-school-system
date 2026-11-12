import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import { useToast } from "../components/toast/ToastProvider";

interface MpesaEvent {
  event_id: string;
  trans_id: string;
  trans_time: string;
  amount: number;
  bill_ref?: string;
  msisdn_masked?: string;
  status: "ALLOCATED" | "SUSPENSE" | "FAILED";
  error?: string;
}

interface MpesaStats {
  total: number;
  allocated: number;
  suspense: number;
  failed: number;
  sync_percent: number;
}

const EMPTY_STATS: MpesaStats = { total: 0, allocated: 0, suspense: 0, failed: 0, sync_percent: 0 };

const statusStyle = (status: MpesaEvent["status"]) => {
  if (status === "ALLOCATED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "FAILED") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-800 border-amber-200";
};

export default function FinanceMpesaPage() {
  const [events, setEvents] = useState<MpesaEvent[]>([]);
  const [stats, setStats] = useState<MpesaStats>(EMPTY_STATS);
  const [learners, setLearners] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<MpesaEvent | null>(null);
  const [learnerID, setLearnerID] = useState("");
  const [resolving, setResolving] = useState(false);
  const { toast } = useToast();

  const load = () => {
    setLoading(true);
    // Reconciliation commits after the response is written, so a browser-cached
    // list would briefly show the previous status. Always take a fresh snapshot.
    api.get(`/finance/mpesa/events?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } })
      .then((res) => {
        setEvents(Array.isArray(res.data?.events) ? res.data.events : []);
        setStats(res.data?.stats || EMPTY_STATS);
      })
      .catch((err) => {
        toast(err.response?.data?.message || "Could not load the M-Pesa ledger", { type: "error" });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get("/learners").then((res) => {
      const rows: any[] = Array.isArray(res.data) ? res.data : [];
      setLearners(rows.map((l) => ({
        id: l.learner_id,
        label: `${l.first_name || ""} ${l.last_name || ""}${l.admission_number ? ` (${l.admission_number})` : ""}`.trim() || l.learner_id,
      })));
    }).catch(() => {});
    // load is stable for the lifetime of this page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      [e.trans_id, e.bill_ref, e.msisdn_masked].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [events, search]);

  const resolve = async () => {
    if (!selected || !learnerID) return;
    setResolving(true);
    try {
      const res = await api.patch(`/finance/mpesa/events/${selected.event_id}/resolve`, { learner_id: learnerID });
      const allocated = Number(res.data?.allocated_amount || 0);
      toast(
        allocated > 0
          ? `Reconciled ${selected.trans_id} to the learner's oldest invoice (KES ${allocated.toLocaleString()})`
          : `Reconciled ${selected.trans_id}; no unpaid invoice, so the receipt is on account`,
        { type: "success" }
      );
      setEvents((prev) => prev.map((e) => (e.event_id === selected.event_id ? { ...e, status: "ALLOCATED" } : e)));
      setStats((prev) => ({
        ...prev,
        allocated: prev.allocated + 1,
        suspense: Math.max(0, prev.suspense - 1),
        sync_percent: prev.total > 0 ? Math.round(((prev.allocated + 1) * 100) / prev.total) : 0,
      }));
      setSelected(null);
      setLearnerID("");
      // The tenant transaction commits after the handler writes its response.
      window.setTimeout(load, 300);
    } catch (err: any) {
      toast(err.response?.data?.message || "Failed to reconcile this receipt", { type: "error" });
    } finally {
      setResolving(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-heading">M-Pesa Ledger</h2>
              <p className="text-sm text-gray-500 mt-1">Bank-grade C2B receipts, including money that has not reached a learner yet.</p>
            </div>
            <button className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50" onClick={load}>
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Receipts</div>
              <div className="text-xl font-semibold mt-1">{stats.total}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs uppercase tracking-wide text-emerald-700">Allocated</div>
              <div className="text-xl font-semibold mt-1 text-emerald-800">{stats.allocated}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700">Needs review</div>
              <div className="text-xl font-semibold mt-1 text-amber-900">{stats.suspense + stats.failed}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Synced</div>
              <div className="text-xl font-semibold mt-1">{stats.sync_percent}%</div>
            </div>
          </div>

          <div className="mb-4">
            <input
              className="w-full sm:max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Search Trans ID, bill reference or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <Skeleton rows={5} columns={5} />
          ) : (
            <DataTable
              data={filtered}
              keyField="event_id"
              emptyMessage={events.length === 0 ? "No M-Pesa receipts yet" : "No receipts match this search"}
              columns={[
                { key: "trans_id", header: "Trans ID" },
                {
                  key: "trans_time",
                  header: "Received",
                  render: (e) => e.trans_time ? new Date(e.trans_time).toLocaleString() : "—",
                },
                { key: "amount", header: "Amount", render: (e) => `KES ${Number(e.amount).toLocaleString()}` },
                { key: "bill_ref", header: "Reference", render: (e) => e.bill_ref || "—" },
                { key: "msisdn_masked", header: "Phone", render: (e) => e.msisdn_masked || "—" },
                {
                  key: "status",
                  header: "Status",
                  render: (e) => (
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyle(e.status)}`}>
                      {e.status === "SUSPENSE" ? "NEEDS REVIEW" : e.status}
                    </span>
                  ),
                },
                {
                  key: "event_id",
                  header: "",
                  sortable: false,
                  render: (e) =>
                    e.status === "ALLOCATED" ? (
                      <span className="text-xs text-gray-400">Reconciled</span>
                    ) : (
                      <button
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
                        onClick={(ev) => { ev.stopPropagation(); setSelected(e); setLearnerID(""); }}
                      >
                        Reconcile
                      </button>
                    ),
                },
              ]}
            />
          )}

          <p className="text-xs text-gray-500 mt-4">
            Receipts are written by the Safaricom callback. Reconciling posts a completed M-Pesa payment and allocates it to the learner's oldest unpaid invoice; the Trans ID makes retries idempotent.
          </p>
        </div>
      </div>

      <Dialog open={Boolean(selected)} onClose={() => { setSelected(null); setLearnerID(""); }} title="Reconcile M-Pesa receipt">
        {selected && (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
              <div className="flex justify-between gap-3"><span className="text-gray-500">Trans ID</span><span className="font-mono">{selected.trans_id}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Amount</span><span className="font-medium">KES {Number(selected.amount).toLocaleString()}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Reference</span><span>{selected.bill_ref || "—"}</span></div>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Apply to learner</span>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={learnerID}
                onChange={(e) => setLearnerID(e.target.value)}
              >
                <option value="">Select a learner…</option>
                {learners.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <p className="text-xs text-gray-500">The receipt is allocated to this learner's oldest unpaid invoice. Any remainder stays as an unallocated payment.</p>
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
              <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm" onClick={() => { setSelected(null); setLearnerID(""); }} disabled={resolving}>
                Cancel
              </button>
              <button
                className="rounded-lg bg-kenyan-red px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={resolve}
                disabled={!learnerID || resolving}
              >
                {resolving ? "Posting…" : "Verify & Reconcile"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </ErrorBoundary>
  );
}
