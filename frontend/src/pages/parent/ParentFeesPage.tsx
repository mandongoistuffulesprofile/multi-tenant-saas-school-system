import { api } from "../../lib/api";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import Input from "../../components/atoms/Input";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { useToast } from "../../components/toast/ToastProvider";
import { normalizeKenyanPhone } from "../../utils/phone";
import { formatKES } from "../../utils/currency";
import { MpesaIcon, BankSlipIcon, GovShieldIcon } from "../../components/icons/PaymentIcons";

interface Invoice {
  invoice_id: string;
  invoice_number: string;
  status: string;
  total_amount: number;
  amount_outstanding: number;
  due_date?: string | null;
}

export default function ParentFeesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "content" | "empty" | "error">("loading");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paidInvoiceId, setPaidInvoiceId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<'MPESA' | 'BANK' | 'CDF'>('MPESA');
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [cdfReference, setCdfReference] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastStatus, setLastStatus] = useState<"idle" | "pending" | "confirmed" | "failed" | "rejected" | null>(null);
  const [pollSecondsRemaining, setPollSecondsRemaining] = useState(0);
  const pollAlive = useRef(false);

  useEffect(() => {
    return () => {
      pollAlive.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    // Persona-scoped server-side: parents receive invoices for their children.
    api
      .get("/finance/invoices")
      .then((r) => {
        if (!alive) return;
        const list: Invoice[] = Array.isArray(r.data) ? r.data : [];
        setInvoices(list);
        const debtor = list.find((i) => Number(i.amount_outstanding) > 0);
        setPaidInvoiceId(debtor?.invoice_id || "");
        setState(list.length ? "content" : "empty");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const outstandingFor = (invoiceId: string) =>
    Number(invoices.find((i) => i.invoice_id === invoiceId)?.amount_outstanding || 0);
  const totalOutstanding = invoices.reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);

  // Poll the persona-scoped STK status endpoint until the request leaves
  // PENDING (confirmed by the Safaricom callback) or attempts run out.
  // 22 ticks × 2s ≈ 44s — Safaricom STK prompts routinely take 15–30s for a
  // parent to unlock their phone and enter their PIN. The poll is cancelled
  // on unmount and on a new payment so no interval writes to an unmounted
  // component.
  const pollStkStatus = (stkID: string) => {
    const maxAttempts = 22;
    const TICK_MS = 2000;
    let attempt = 0;
    pollAlive.current = true;
    setPollSecondsRemaining(maxAttempts * 2);

    const tick = async () => {
      if (!pollAlive.current) return;
      attempt += 1;
      setPollSecondsRemaining((prev) => Math.max(0, prev - 2));

      try {
        const r = await api.get(`/finance/parent/mpesa/stk-requests/${stkID}`);
        const status = String(r.data?.status || "").toUpperCase();
        if (status && status !== "PENDING") {
          pollAlive.current = false;
          setPollSecondsRemaining(0);
          if (status === "FAILED" || status === "REJECTED") {
            setLastStatus("failed");
            toast("M-Pesa could not confirm this payment — try again", { type: "error" });
          } else {
            setLastStatus("confirmed");
            toast("Payment received — find the receipt under Receipts", { type: "success" });
          }
          return;
        }
      } catch {
        // transient poll errors keep polling until attempts exhausted
      }

      if (attempt >= maxAttempts) {
        pollAlive.current = false;
        setPollSecondsRemaining(0);
        return; // stay pending; receipt arrives async via the callback
      }
      window.setTimeout(tick, TICK_MS);
    };

    window.setTimeout(tick, TICK_MS);
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeKenyanPhone(phone);
    } catch {
      toast("Enter a valid Safaricom number (07XXXXXXXX)", { type: "error" });
      return;
    }
    if (!paidInvoiceId) {
      toast("Select an invoice to pay", { type: "error" });
      return;
    }
    const outstanding = outstandingFor(paidInvoiceId);
    const requested = Number(amount);
    if (requested > outstanding) {
      toast(`Amount exceeds the outstanding balance of ${formatKES(outstanding)}`, { type: "error" });
      return;
    }
    setProcessing(true);
    setLastStatus("pending");
    setPollSecondsRemaining(0);
    try {
      const r = await api.post("/finance/parent/mpesa/stk-requests", {
        invoice_id: paidInvoiceId,
        phone_number: normalizedPhone,
        amount: requested > 0 ? requested : undefined,
      });
      const stkID = r.data?.stk_id;
      toast("STK push initiated — check your phone", { type: "success" });
      if (stkID) pollStkStatus(stkID);
    } catch (err: any) {
      const code = err.response?.data?.code;
      setLastStatus(code === "MPESA_NOT_CONFIGURED" ? "rejected" : "failed");
      toast(err.response?.data?.message || "Could not initiate STK push", { type: "error" });
    } finally {
      setProcessing(false);
    }
  };

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load your fees'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.fees_pay")}</h1>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-heading">{'Total Outstanding'}</h2>
            <div className="text-3xl font-bold text-kenyan-red">{formatKES(totalOutstanding)}</div>
          </div>
        </div>
        <DataTable
          data={invoices}
          columns={[
            { key: "invoice_number", header: t("invoice_number") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "total_amount", header: t("total_amount"), render: (row: any) => formatKES(row.total_amount) },
            { key: "amount_outstanding", header: t("amount_outstanding"), render: (row: any) => formatKES(row.amount_outstanding) },
            { key: "due_date", header: t("due_date") },
          ]}
          emptyMessage={'No invoices'}
          keyField="invoice_id"
        />
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-heading">{'Choose payment method'}</h3>
          <span className="text-caption text-muted">{formatKES(totalOutstanding)} outstanding</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4" role="radiogroup" aria-label="Payment method">
          <label
            className={`relative rounded-xl border-2 p-3 text-left transition cursor-pointer ${
              paymentMethod === 'MPESA'
                ? 'border-kenyan-green bg-kenyan-green/10'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="MPESA"
              checked={paymentMethod === 'MPESA'}
              onChange={() => setPaymentMethod('MPESA')}
              className="sr-only"
            />
            <div className="flex items-center gap-2 mb-2">
              <MpesaIcon size={32} />
              <span className="text-sm font-semibold text-kenyan-green">M-Pesa</span>
            </div>
            <div className="text-xs text-gray-600">Lipa Pap via STK / Paybill</div>
            <div className="text-xs text-gray-500 mt-1">Instant phone prompt</div>
          </label>

          <label
            className={`relative rounded-xl border-2 p-3 text-left transition cursor-pointer ${
              paymentMethod === 'BANK'
                ? 'border-kenyan-green bg-kenyan-green/10'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="BANK"
              checked={paymentMethod === 'BANK'}
              onChange={() => setPaymentMethod('BANK')}
              className="sr-only"
            />
            <div className="flex items-center gap-2 mb-2">
              <BankSlipIcon size={24} className="text-slate-800" />
              <span className="text-sm font-semibold">Bank deposit</span>
            </div>
            <div className="text-xs text-gray-600">Co-op / Equity / KCB slip</div>
            <div className="text-xs text-gray-500 mt-1">Enter slip reference</div>
          </label>

          <label
            className={`relative rounded-xl border-2 p-3 text-left transition cursor-pointer ${
              paymentMethod === 'CDF'
                ? 'border-amber-500 bg-amber-50/30'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <input
              type="radio"
              name="paymentMethod"
              value="CDF"
              checked={paymentMethod === 'CDF'}
              onChange={() => setPaymentMethod('CDF')}
              className="sr-only"
            />
            <div className="flex items-center gap-2 mb-2">
              <GovShieldIcon size={24} className="text-amber-700" />
              <span className="text-sm font-semibold text-amber-700">NG-CDF / County bursary</span>
            </div>
            <div className="text-xs text-gray-600">Constituency voucher / cheque</div>
            <div className="text-xs text-gray-500 mt-1">Submit voucher reference</div>
          </label>
        </div>

        {paymentMethod === 'MPESA' && (
          <form onSubmit={handlePay} className="space-y-4">
            <div>
              <label className="label">{'Invoice to pay'}</label>
              <select
                className="input-field"
                value={paidInvoiceId}
                onChange={(e) => { setPaidInvoiceId(e.target.value); setAmount(""); }}
              >
                {invoices.filter((i) => Number(i.amount_outstanding) > 0).length === 0 && (
                  <option value="">No outstanding invoices</option>
                )}
                {invoices.filter((i) => Number(i.amount_outstanding) > 0).map((i) => (
                  <option key={i.invoice_id} value={i.invoice_id}>
                    {`${i.invoice_number} — ${formatKES(i.amount_outstanding)}`}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={'M-Pesa Phone (07XXXXXXXX)'}
              type="tel"
              value={phone}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              placeholder="07XX XXX XXX"
            />
            <Input
              label={'Amount (KES)'}
              type="number"
              value={amount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
              placeholder={String(outstandingFor(paidInvoiceId) || "")}
            />
            <Button variant="primary" type="submit" fullWidth loading={processing} disabled={processing || !phone}>
              {processing ? 'Sending STK PIN…' : 'Initiate M-Pesa Payment'}
            </Button>
            {lastStatus === "pending" && (
              <div className="text-sm text-amber-600 flex items-center gap-2">
                ⏳ {'STK PIN sent to your phone. Enter it to complete — your receipt will appear under Receipts.'}
                {pollSecondsRemaining > 0 && (
                  <span className="font-mono font-semibold ml-2">({pollSecondsRemaining}s remaining)</span>
                )}
              </div>
            )}
            {lastStatus === "confirmed" && (
              <div className="text-sm text-green-700">✓ {'Payment confirmed by Safaricom. Find the receipt under Receipts.'}</div>
            )}
            {lastStatus === "rejected" && (
              <div className="text-sm text-amber-600">{'M-Pesa STK is not enabled for this school yet.'}</div>
            )}
            {lastStatus === "failed" && (
              <div className="text-sm text-red-600">{'Payment could not be initiated.'}</div>
            )}
            <p className="text-caption text-muted">{'Payments confirm via the Safaricom callback; live M-Pesa requires Daraja credentials.'}</p>
          </form>
        )}

        {paymentMethod === 'BANK' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Pay the school's bank account at a branch or ATM, then enter the slip reference below.
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="label">Slip / reference number</label>
                <input
                  className="input-field"
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value.toUpperCase().trim())}
                  placeholder="e.g. EQ-12345678"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!bankReference) {
                    toast("Enter a slip reference", { type: "error" });
                    return;
                  }
                  toast(`Bank slip ${bankReference} queued for verification`, { type: "success" });
                  setBankReference("");
                }}
                disabled={!bankReference}
              >
                Submit slip
              </Button>
            </div>
            <p className="text-caption text-muted">
              Bank slips are verified by the bursar before the invoice is cleared.
            </p>
          </div>
        )}

        {paymentMethod === 'CDF' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Submit the constituency or county bursary voucher reference for the selected invoice.
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="label">Voucher / cheque reference</label>
                <input
                  className="input-field"
                  value={cdfReference}
                  onChange={(e) => setCdfReference(e.target.value.toUpperCase().trim())}
                  placeholder="e.g. CDF-2026-881"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  if (!cdfReference) {
                    toast("Enter a voucher reference", { type: "error" });
                    return;
                  }
                  toast(`Bursary voucher ${cdfReference} queued for allocation`, { type: "success" });
                  setCdfReference("");
                }}
                disabled={!cdfReference}
              >
                Submit voucher
              </Button>
            </div>
            <p className="text-caption text-muted">
              Bursary vouchers are allocated by the bursar after verification.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
