import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import Input from "../../components/atoms/Input";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { useToast } from "../../components/toast/ToastProvider";

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
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastStatus, setLastStatus] = useState<"idle" | "pending" | "confirmed" | "failed" | "rejected" | null>(null);

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
  const pollStkStatus = (stkID: string) => {
    const maxAttempts = 15;
    let attempt = 0;
    const tick = async () => {
      attempt += 1;
      try {
        const r = await api.get(`/finance/parent/mpesa/stk-requests/${stkID}`);
        const status = String(r.data?.status || "").toUpperCase();
        if (status && status !== "PENDING") {
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
      if (attempt >= maxAttempts) return; // stay pending; receipt arrives async
      window.setTimeout(tick, 4000);
    };
    window.setTimeout(tick, 4000);
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.trim().replace(/[\s+]/g, "");
    if (!/^(\+?254|0)?[17]\d{8}$/.test(cleaned)) {
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
      toast(`Amount exceeds the outstanding balance of KES ${outstanding.toLocaleString()}`, { type: "error" });
      return;
    }
    setProcessing(true);
    setLastStatus("pending");
    try {
      const r = await api.post("/finance/parent/mpesa/stk-requests", {
        invoice_id: paidInvoiceId,
        phone_number: phone.trim(),
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
            <div className="text-3xl font-bold text-kenyan-red">KES {totalOutstanding.toLocaleString()}</div>
          </div>
        </div>
        <DataTable
          data={invoices}
          columns={[
            { key: "invoice_number", header: t("invoice_number") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "total_amount", header: t("total_amount"), render: (row: any) => `KES ${Number(row.total_amount).toLocaleString()}` },
            { key: "amount_outstanding", header: t("amount_outstanding"), render: (row: any) => `KES ${Number(row.amount_outstanding).toLocaleString()}` },
            { key: "due_date", header: t("due_date") },
          ]}
          emptyMessage={'No invoices'}
          keyField="invoice_id"
        />
      </Card>

      <Card className="p-4">
        <h3 className="text-heading mb-3">{'Pay Now (M-Pesa STK Push)'}</h3>
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
                  {`${i.invoice_number} — KES ${Number(i.amount_outstanding).toLocaleString()}`}
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
            <div className="text-sm text-amber-600 flex items-center gap-2">⏳ {'STK PIN sent to your phone. Enter it to complete — your receipt will appear under Receipts.'}</div>
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
      </Card>
    </div>
  );
}
