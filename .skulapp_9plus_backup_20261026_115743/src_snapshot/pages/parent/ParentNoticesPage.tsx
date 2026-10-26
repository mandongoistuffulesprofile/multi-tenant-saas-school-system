import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

interface Notice {
  id: string;
  title: string;
  body: string;
  date: string;
  read: boolean;
  channel: string;
}

export default function ParentNoticesPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "empty" | "error">("loading");
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .get("/notices/parent")
      .then((r) => {
        if (!alive) return;
        setNotices(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load notices'} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.notices")}</h1>
      <Card className="p-4">
        <DataTable
          data={notices}
          columns={[
            { key: "title", header: t("title") },
            { key: "body", header: t("message") },
            { key: "date", header: t("date"), render: (row: any) => String(row.date || "").slice(0, 10) },
            { key: "read", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "channel", header: t("channel") },
          ]}
          emptyMessage={'No notices'}
          keyField="id"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${
      row.read ? "bg-kenyan-green/20 text-kenyan-green border-kenyan-green" : "bg-amber-100 text-amber-700 border-amber-200"
    }`}>
      {row.read ? t("read") : t("unread")}
    </span>
  );
}
