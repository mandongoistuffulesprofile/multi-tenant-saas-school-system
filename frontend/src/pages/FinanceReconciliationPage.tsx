import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import DataTable from "../components/organisms/DataTable";
import Dialog from "../components/dialog/Dialog";
import Skeleton from "../components/atoms/Skeleton";
import { ErrorBoundary } from "../components/organisms/ErrorBoundary";
import Button from "../components/atoms/Button";
import { useToast } from "../components/toast/ToastProvider";
import { formatMoney, isPositiveMoney } from "../lib/money";

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
type Invoice = {
  invoice_id: string;
  invoice_number?: string;
  learner_id?: string;
  amount_outstanding?: number;
  total_amount?: number;
  status?: string;
};

export default function FinanceReconciliationPage() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<any[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [matchInvoice, setMatchInvoice] = useState<Record<string, string>>({});
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundTxn, setRefundTxn] = useState<Txn | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [flagging, setFlagging] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [rRes, tRes, iRes] = await Promise.all([
        api.get("/finance/reconciliation/runs").catch(() => ({ data: [] })),
        api.get("/finance/mpesa/transactions", { params: { limit: 100, offset: 0 } }).catch(() => ({ data: [] })),
        api.get("/finance/invoices", { params: { limit: 200, offset: 0 } }).catch(() => ({ data: [] })),
      ]);
      setRuns(Array.isArray(rRes.data) ? rRes.data : []);
      const allTxns: Txn[] = Array.isArray(tRes.data) ? tRes.data : [];
      setTxns(allTxns.filter((t) => String(t.status || "").toUpperCase() !== "MATCHED"));
      const invs: Invoice[] = Array.isArray(iRes.data) ? iRes.data : [];
      setInvoices(invs.filter((i) => isPositiveMoney(i.amount_outstanding) && String(i.status || "").toUpperCase() !== "PAID"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doMatch = async (txn: Txn) => {
    const invoiceId = matchInvoice[txn.trans_id];
    if (!invoiceId) { toast(t("reconciliation_page.select_invoice_error"), { type: "error" }); return; }
    setActing(txn.trans_id);
    try {
      await api.post(`/finance/reconciliation/transactions/${txn.trans_id}/match`, {
        invoice_id: invoiceId,
        amount: txn.amount || 0,
      });
      toast(t("reconciliation_page.matched", { ref: txn.external_trans_id || txn.trans_id }), { type: "success" });
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || t("reconciliation_page.match_failed"), { type: "error" });
    } finally {
      setActing(null);
    }
  };

  const openRefundFlag = (txn: Txn) => {
    setRefundTxn(txn);
    setRefundReason(t("reconciliation_page.reason_default"));
    setRefundModalOpen(true);
  };

  const doFlagRefund = async () => {
    if (!refundTxn || !refundReason.trim()) return;
    setFlagging(true);
    try {
      await api.post(`/finance/reconciliation/transactions/${refundTxn.trans_id}/flag-refund`, { reason: refundReason.trim() });
      toast(t("reconciliation_page.flagged", { ref: refundTxn.external_trans_id || refundTxn.trans_id }), { type: "success" });
      setRefundModalOpen(false);
      setRefundTxn(null);
      setRefundReason("");
      await load();
    } catch (e: any) {
      toast(e?.response?.data?.message || t("reconciliation_page.flag_failed"), { type: "error" });
    } finally {
      setFlagging(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-heading">{t("reconciliation_page.title")}</h2>
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>{t("reconciliation_page.refresh")}</Button>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t("reconciliation_page.unmatched")}</h3>
            {loading ? <Skeleton rows={4} columns={6} /> : (
              <DataTable
                data={txns}
                emptyMessage={t("reconciliation_page.no_unmatched")}
                columns={[
                  { key: "external_trans_id", header: t("reconciliation_page.receipt"), render: (r) => r.external_trans_id || r.trans_id },
                  { key: "amount", header: t("reconciliation_page.amount"), render: (r) => r.amount != null ? `KES ${formatMoney(r.amount)}` : "—" },
                  { key: "bill_ref", header: t("reconciliation_page.bill_ref") },
                  { key: "msisdn_masked", header: t("reconciliation_page.phone") },
                  { key: "status", header: t("reconciliation_page.status") },
                  { key: "transaction_date", header: t("reconciliation_page.date"), render: (r) => r.transaction_date || r.created_at || "—" },
                  {
                    key: "action", header: t("reconciliation_page.action"), sortable: false, render: (r) => (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="text-xs border border-gray-300 rounded px-2 py-1 max-w-[220px]"
                          value={matchInvoice[r.trans_id] || ""}
                          onChange={(e) => setMatchInvoice((s) => ({ ...s, [r.trans_id]: e.target.value }))}
                        >
                          <option value="">{t("reconciliation_page.select_invoice")}</option>
                          {invoices.map((inv) => (
                            <option key={inv.invoice_id} value={inv.invoice_id}>
                              {inv.invoice_number || inv.invoice_id} · KES {formatMoney(inv.amount_outstanding)}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" variant="secondary" loading={acting === r.trans_id} disabled={!matchInvoice[r.trans_id] || acting === r.trans_id} onClick={() => doMatch(r)}>
                          {t("reconciliation_page.match")}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={acting === r.trans_id} onClick={() => openRefundFlag(r)}>
                          {t("reconciliation_page.flag_refund")}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">{t("reconciliation_page.runs")}</h3>
            {loading ? <Skeleton rows={3} columns={6} /> : (
              <DataTable
                data={runs}
                emptyMessage={t("reconciliation_page.no_runs")}
                columns={[
                  { key: "run_id", header: t("reconciliation_page.run_id") },
                  { key: "run_date", header: t("reconciliation_page.date"), render: (r) => r.run_date || r.period || "—" },
                  { key: "status", header: t("reconciliation_page.status") },
                  { key: "total_expected", header: t("reconciliation_page.expected"), render: (r) => r.total_expected != null ? `KES ${formatMoney(r.total_expected)}` : "—" },
                  { key: "total_received", header: t("reconciliation_page.received"), render: (r) => r.total_received != null ? `KES ${formatMoney(r.total_received)}` : "—" },
                  { key: "unmatched_transactions", header: t("reconciliation_page.unmatched_count"), render: (r) => r.unmatched_transactions ?? r.unmatched_count ?? "—" },
                ]}
              />
            )}
          </section>

          {/* Flag Refund Modal */}
          <Dialog open={refundModalOpen} onClose={() => { setRefundModalOpen(false); setRefundTxn(null); setRefundReason(""); }} title={t("reconciliation_page.refund_title")} className="max-w-md">
            {refundTxn && (
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  {t("reconciliation_page.refund_confirm", {
                    ref: refundTxn.external_trans_id || refundTxn.trans_id,
                    amount: formatMoney(refundTxn.amount),
                  })}
                </p>
                <label style={{ display: "block", marginBottom: "0.75rem" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>{t("reconciliation_page.reason")}</span>
                  <textarea
                    required
                    rows={3}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder={t("reconciliation_page.reason_placeholder")}
                    style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 6 }}
                  />
                </label>
                <div className="sticky bottom-0 flex justify-end gap-2 border-t border-gray-100 bg-white pt-4 pb-1">
                  <button type="button" onClick={() => { setRefundModalOpen(false); setRefundTxn(null); setRefundReason(""); }} style={{ padding: "0.5rem 1rem" }}>{t("reconciliation_page.cancel")}</button>
                  <button type="button" className="btn-primary" disabled={flagging} onClick={doFlagRefund}>
                    {flagging ? t("reconciliation_page.flagging") : t("reconciliation_page.submit_flag")}
                  </button>
                </div>
              </div>
            )}
          </Dialog>
        </div>
      </div>
    </ErrorBoundary>
  );
}
