import { useState } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import Button from "../../components/atoms/Button";
import Input from "../../components/atoms/Input";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { LinkedLearner } from "../../lib/types";

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
  const [amount, setAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [lastStatus, setLastStatus] = useState<"idle" | "pending" | "success" | "failed" | null>(null);

  const invoices: Invoice[] = [
    { invoice_id: "inv-1", invoice_number: "INV-2024-001", status: "PARTIALLY_PAID", total_amount: 12000, amount_outstanding: 4000, due_date: "2024-02-15" },
    { invoice_id: "inv-2", invoice_number: "INV-2024-002", status: "ISSUED", total_amount: 8000, amount_outstanding: 8000, due_date: "2024-03-01" },
  ];

  const totalOutstanding = invoices.reduce((s, i) => s + i.amount_outstanding, 0);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    setLastStatus("pending");
    // Mocked STK push (no live Daraja in backend)
    await new Promise((r) => setTimeout(r, 2500));
    setProcessing(false);
    setLastStatus("success");
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.fees_pay")}</h1>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-heading">{t("parent.total_outstanding", { defaultMessage: "Total Outstanding" })}</h2>
            <div className="text-3xl font-bold text-kenyan-red">KES {totalOutstanding}</div>
          </div>
        </div>
        <DataTable
          data={invoices}
          columns={[
            { key: "invoice_number", header: t("invoice_number") },
            { key: "status", header: t("status"), render: (row: any) => <Badge variant="default">{row.status}</Badge> },
            { key: "total_amount", header: t("total_amount"), render: (row: any) => `KES ${row.total_amount}` },
            { key: "amount_outstanding", header: t("amount_outstanding"), render: (row: any) => `KES ${row.amount_outstanding}` },
            { key: "due_date", header: t("due_date") },
          ]}
          emptyMessage={t("no_invoices", { defaultMessage: "No invoices" })}
          keyField="invoice_id"
        />
      </Card>

      <Card className="p-4">
        <h3 className="text-heading mb-3">{t("parent.pay_now", { defaultMessage: "Pay Now (M-Pesa STK Push)" })}</h3>
        <form onSubmit={handlePay} className="space-y-4">
          <Input
            label={t("parent.amount", { defaultMessage: "Amount (KES)" })}
            type="number"
            value={amount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
            placeholder={String(totalOutstanding)}
          />
          <Button variant="primary" type="submit" fullWidth loading={processing} disabled={processing || !amount}>
            {processing ? t("sending", { defaultMessage: "Sending STK PIN…" }) : t("parent.initiate_mpesa", { defaultMessage: "Initiate M-Pesa Payment" })}
          </Button>
          {lastStatus === "pending" && (
            <div className="text-sm text-amber-600 flex items-center gap-2">⏳ {t("parent.stk_sent", { defaultMessage: "STK PIN sent to your phone. Enter it to complete." })}</div>
          )}
          {lastStatus === "success" && (
            <div className="text-sm text-green-600 flex items-center gap-2">✓ {t("parent.payment_success", { defaultMessage: "Payment successful. Receipt available." })}</div>
          )}
          {lastStatus === "failed" && (
            <div className="text-sm text-red-600">{t("parent.payment_failed", { defaultMessage: "Payment failed or cancelled." })}</div>
          )}
          <p className="text-caption text-muted">{t("parent.stk_mocked", { defaultMessage: "STK push mocked in dev. Live M-Pesa requires Daraja credentials." })}</p>
        </form>
      </Card>
    </div>
  );
}
