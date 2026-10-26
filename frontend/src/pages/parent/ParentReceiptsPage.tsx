import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

interface Receipt {
  receipt_id: string;
  receipt_number: string;
  amount: number;
  date: string;
  status: string;
  method: string;
}

export default function ParentReceiptsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "empty" | "error">("loading");
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  useEffect(() => {
    let alive = true;
    // Payments are persona-scoped server-side: parents see only their
    // children's receipts. payment rows carry payment_reference/source/recorded_at.
    api
      .get("/finance/payments")
      .then((r) => {
        if (!alive) return;
        const rows = Array.isArray(r.data) ? r.data : [];
        setReceipts(rows.map((p: any) => ({
          receipt_id: p.payment_id || p.receipt_id,
          receipt_number: p.payment_reference || p.receipt_number,
          amount: Number(p.amount) || 0,
          date: String(p.recorded_at || p.date || "").slice(0, 10),
          status: p.status || "COMPLETED",
          method: p.source || p.method || "CASH",
        })));
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load receipts'} />;
  if (receipts.length === 0) return <ViewState state="empty" message={'No receipts'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.receipts")}</h1>
      <Card className="p-4">
        <DataTable
          data={receipts}
          columns={[
            { key: "receipt_number", header: t("receipt_number") },
            { key: "amount", header: t("amount"), render: (row: any) => `KES ${row.amount.toLocaleString()}` },
            { key: "date", header: t("date") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "method", header: t("method") },
          ]}
          emptyMessage={'No receipts'}
          keyField="receipt_id"
        />
        <div className="mt-4 flex gap-2">
          <ButtonLink text={'Download All PDFs'} />
        </div>
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = { COMPLETED: "bg-kenyan-green/20 text-kenyan-green", PENDING: "bg-amber-100 text-amber-700", FAILED: "bg-red-100 text-red-700" };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}

function ButtonLink({ text }: { text: string }) {
  return (
    <button type="button" className="text-sm text-kenyan-red hover:underline font-medium">
      {text}
    </button>
  );
}
