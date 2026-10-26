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
    setReceipts([
      { receipt_id: "rcp-1", receipt_number: "RCP-2024-0001", amount: 4000, date: "2024-01-20", status: "COMPLETED", method: "M-PESA" },
      { receipt_id: "rcp-2", receipt_number: "RCP-2024-0002", amount: 8000, date: "2024-02-10", status: "COMPLETED", method: "M-PESA" },
    ]);
    setState("content");
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (receipts.length === 0) return <ViewState state="empty" message={t("no_receipts", { defaultMessage: "No receipts" })} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.receipts")}</h1>
      <Card className="p-4">
        <DataTable
          data={receipts}
          columns={[
            { key: "receipt_number", header: t("receipt_number") },
            { key: "amount", header: t("amount"), render: (row: any) => `KES ${row.amount}` },
            { key: "date", header: t("date") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "method", header: t("method") },
          ]}
          emptyMessage={t("no_receipts", { defaultMessage: "No receipts" })}
          keyField="receipt_id"
        />
        <div className="mt-4 flex gap-2">
          <ButtonLink text={t("download_all", { defaultMessage: "Download All PDFs" })} />
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
