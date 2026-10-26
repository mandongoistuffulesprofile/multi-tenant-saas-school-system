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
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastStatus, setLastStatus] = useState<"idle" | "pending" | "failed" | "rejected" | null>(null);

  useEffect(() => {
    let alive = true;
    // Persona-scoped server-side: parents receive invoices for their children.
    api
      .get("/finance/invoices")
      .then((r) => {
        if (!alive) return;
        setInvoices(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  const totalOutstanding = invoices.reduce((s, i) => s + Number(i.amount_outstanding || 0), 0);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^0[17]\d{8}$/.test(phone.trim().replace(/\s|\+/g, "").replace(/^254/, "0"))) {
      toast("Enter a valid Safaricom number (07XXXXXXXX)", { type: "error" });
      return;
    }
    setProcessing(true);
    setLastStatus("pending");
    try {
      const amountValue = Number(amount) || totalOutstanding;
      const r = await api.post("/finance/mpesa/stk-requests", {
        phone: phone.trim(),
        amount: amountValue > 0 ? amountValue : 1,
      });
      setLastStatus((r.data?.status === "DISABLED" || r.data?.status === "REJECTED") ? "rejected" : "pending");
      toast("STK push initiated — check your phone", { type: "success" });
    } catch (err: any) {
      setLastStatus("failed");
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
            placeholder={String(totalOutstanding)}
          />
          <Button variant="primary" type="submit" fullWidth loading={processing} disabled={processing || !phone}>
            {processing ? 'Sending STK PIN…' : 'Initiate M-Pesa Payment'}
          </Button>
          {lastStatus === "pending" && (
            <div className="text-sm text-amber-600 flex items-center gap-2">⏳ {'STK PIN sent to your phone. Enter it to complete — your receipt will appear under Receipts.'}</div>
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
