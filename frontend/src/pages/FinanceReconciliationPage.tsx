import { useEffect, useState } from "react";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import Button from "../components/atoms/Button";
import { useToast } from "../components/toast/ToastProvider";

type Txn = {
  trans_id: string;
  external_trans_id?: string;
  amount?: number;
  bill_ref?: string;
  msisdn_masked?: string;
  status?: string;
  transaction_date?: string;
  created_at?: string;
};
type AllocationFinding = {
  kind: string;
  subject_id?: string;
  learner_id?: string;
  expected?: number;
  actual?: number;
  delta?: number;
  detail?: string;
  detected_at?: string;
};
type Invoice = {
  invoice_id: string;
  invoice_number?: string;
  learner_id?: string;
  amount_outstanding?: number;
  total_amount?: number;
  status?: string;
};

export default function FinanceReconciliationPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // The nightly invariant check's findings: proofs that money and lines
  // disagree, not heuristics.
  const [allocation, setAllocation] = useState<{ findings: AllocationFinding[]; counts: Record<string, number> }>({
    findings: [],
    counts: {},
  });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [matchInvoice, setMatchInvoice] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [rRes, tRes, iRes, aRes] = await Promise.all([
        api.get("/finance/reconciliation/runs").catch(() => ({ data: [] })),
        api.get("/finance/mpesa/transactions", { params: { limit: 100, offset: 0 } }).catch(() => ({ data: [] })),
        api.get("/finance/invoices", { params: { limit: 200, offset: 0 } }).catch(() => ({ data: [] })),
        api.get("/finance/reconciliation/allocation-findings").catch(() => ({ data: null })),
      ]);
      if (aRes.data && Array.isArray(aRes.data.findings)) {
        setAllocation({ findings: aRes.data.findings, counts: aRes.data.counts || {} });
      }
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);
      const allTxns: Txn[] = Array.isArray(tRes.data) ? tRes.data : [];
      setTxns(allTxns.filter((t) => String(t.status || "").toUpperCase() !== "MATCHED"));
      const invs: Invoice[] = Array.isArray(iRes.data) ? iRes.data : [];
      setInvoices(invs.filter((i) => Number(i.amount_outstanding || 0) > 0 && String(i.status || "").toUpperCase() !== "PAID"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doMatch = async (txn: Txn) => {
    const invoiceId = matchInvoice[txn.trans_id];
    if (!invoiceId) { toast("Select an invoice to match", { type: "error" }); return; }
    setActing(txn.trans_id);
    try {
      await api.post(`/finance/reconciliation/transactions/${txn.trans_id}/match`, {
        invoice_id: invoiceId,
        amount: txn.amount || 0,
      });
      toast(`Matched ${txn.external_trans_id || txn.trans_id}`, { type: "success" });
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || "Match failed", { type: "error" });
    } finally {
      setActing(null);
    }
  };

  const doFlagRefund = async (txn: Txn) => {
    const reason = window.prompt("Reason for refund flag", "Unmatched / wrong bill reference");
    if (!reason) return;
    setActing(txn.trans_id);
    try {
      await api.post(`/finance/reconciliation/transactions/${txn.trans_id}/flag-refund`, { reason });
      toast(`Flagged ${txn.external_trans_id || txn.trans_id} for refund`, { type: "success" });
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || "Failed to flag refund", { type: "error" });
    } finally {
      setActing(null);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-heading">Reconciliation</h2>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>Refresh</Button>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Unmatched M-Pesa Transactions</h3>
            {loading ? <Skeleton rows={4} columns={6} /> : (
              <DataTable
                data={txns}
                emptyMessage="No unmatched transactions"
                columns={[
                  { key: "external_trans_id", header: "Receipt", render: (r) => r.external_trans_id || r.trans_id },
                  { key: "amount", header: "Amount", render: (r) => r.amount != null ? `KES ${Number(r.amount).toLocaleString()}` : "—" },
                  { key: "bill_ref", header: "Bill Ref" },
                  { key: "msisdn_masked", header: "Phone" },
                  { key: "status", header: "Status" },
                  { key: "transaction_date", header: "Date", render: (r) => r.transaction_date || r.created_at || "—" },
                  {
                    key: "action", header: "Action", sortable: false, render: (r) => (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="text-xs border border-gray-300 rounded px-2 py-1 max-w-[220px]"
                          value={matchInvoice[r.trans_id] || ""}
                          onChange={(e) => setMatchInvoice((s) => ({ ...s, [r.trans_id]: e.target.value }))}
                        >
                          <option value="">Select invoice…</option>
                          {invoices.map((inv) => (
                            <option key={inv.invoice_id} value={inv.invoice_id}>
                              {inv.invoice_number || inv.invoice_id} · KES {Number(inv.amount_outstanding || 0).toLocaleString()}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" variant="secondary" loading={acting === r.trans_id} disabled={!matchInvoice[r.trans_id] || acting === r.trans_id} onClick={() => doMatch(r)}>
                          Match
                        </Button>
                        <Button size="sm" variant="ghost" disabled={acting === r.trans_id} onClick={() => doFlagRefund(r)}>
                          Flag refund
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Allocation Integrity</h3>
              <span className="text-xs text-gray-500">
                Checked nightly. A finding here means receipts, credits or line balances do not agree.
              </span>
            </div>
            {loading ? <Skeleton rows={3} columns={5} /> : (
              <DataTable
                data={allocation.findings}
                emptyMessage="Every receipt, credit and line balance reconciles"
                columns={[
                  { key: "kind", header: "Problem" },
                  { key: "subject_id", header: "Invoice / Receipt", render: (f) => f.subject_id || "—" },
                  { key: "expected", header: "Expected", render: (f) => f.expected != null ? `KES ${Number(f.expected).toFixed(2)}` : "—" },
                  { key: "actual", header: "Actual", render: (f) => f.actual != null ? `KES ${Number(f.actual).toFixed(2)}` : "—" },
                  {
                    key: "delta",
                    header: "Difference",
                    render: (f) => {
                      const delta = Number(f.delta || 0);
                      return (
                        <span className={Math.abs(delta) > 0 ? "font-medium text-kenyan-red" : "text-gray-500"}>
                          {delta.toFixed(2)}
                        </span>
                      );
                    },
                  },
                  { key: "detail", header: "Detail", render: (f) => f.detail || "—" },
                  {
                    key: "detected_at",
                    header: "Detected",
                    render: (f) => (f.detected_at ? new Date(f.detected_at).toLocaleString() : "—"),
                  },
                ]}
              />
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reconciliation Runs</h3>
            {loading ? <Skeleton rows={3} columns={6} /> : (
              <DataTable
                data={runs}
                emptyMessage="No reconciliation runs"
                columns={[
                  { key: "run_id", header: "Run ID" },
                  { key: "run_date", header: "Date", render: (r) => r.run_date || r.period || "—" },
                  { key: "status", header: "Status" },
                  { key: "total_expected", header: "Expected", render: (r) => r.total_expected != null ? `KES ${Number(r.total_expected).toLocaleString()}` : "—" },
                  { key: "total_received", header: "Received", render: (r) => r.total_received != null ? `KES ${Number(r.total_received).toLocaleString()}` : "—" },
                  { key: "unmatched_transactions", header: "Unmatched", render: (r) => r.unmatched_transactions ?? r.unmatched_count ?? "—" },
                ]}
              />
            )}
          </section>
        </div>
      </div>
    </ErrorBoundary>
  );
}
