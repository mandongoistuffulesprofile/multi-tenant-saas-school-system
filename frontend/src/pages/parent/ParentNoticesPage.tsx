import { useState } from "react";
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
  const [notices, setNotices] = useState<Notice[]>([
    { id: "n1", title: "Term 1 Opens", body: "School reopens on Monday 8th January.", date: "2024-01-05", read: false, channel: "SMS" },
    { id: "n2", title: "Sports Day", body: "Annual sports day on Saturday.", date: "2024-01-10", read: true, channel: "IN_APP" },
  ]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.notices")}</h1>
      <Card className="p-4">
        <DataTable
          data={notices}
          columns={[
            { key: "title", header: t("title") },
            { key: "body", header: t("message") },
            { key: "date", header: t("date") },
            { key: "read", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
            { key: "channel", header: t("channel") },
          ]}
          emptyMessage={t("no_notices", { defaultMessage: "No notices" })}
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
