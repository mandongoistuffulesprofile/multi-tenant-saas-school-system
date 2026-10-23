import { api } from "../../lib/api";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

interface Mark {
  date: string;
  status: string;
  learner: string;
  class_name: string;
}

export default function ParentAttendancePage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "empty" | "error">("loading");
  const [marks, setMarks] = useState<Mark[]>([]);

  useEffect(() => {
    setMarks([
      { date: "2024-01-15", status: "PRESENT", learner: "Brian Omondi", class_name: "Grade 4 East" },
      { date: "2024-01-16", status: "ABSENT", learner: "Brian Omondi", class_name: "Grade 4 East" },
      { date: "2024-01-17", status: "PRESENT", learner: "Brian Omondi", class_name: "Grade 4 East" },
    ]);
    setState("content");
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (marks.length === 0) return <ViewState state="empty" message={t("no_attendance", { defaultMessage: "No attendance records" })} />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("parent.attendance")}</h1>
      <Card className="p-4">
        <DataTable
          data={marks}
          columns={[
            { key: "date", header: t("date") },
            { key: "learner", header: t("learner") },
            { key: "class_name", header: t("class") },
            { key: "status", header: t("status"), render: (row: any) => <BadgeVariant row={row} /> },
          ]}
          emptyMessage={t("no_attendance", { defaultMessage: "No attendance records" })}
          keyField="date"
        />
      </Card>
    </div>
  );
}

function BadgeVariant({ row }: { row: any }) {
  const colors: Record<string, string> = {
    PRESENT: "bg-kenyan-green/20 text-kenyan-green border-kenyan-green",
    ABSENT: "bg-red-100 text-red-700 border-red-200",
    LATE: "bg-amber-100 text-amber-700 border-amber-200",
    EXCUSED: "bg-blue-100 text-blue-700 border-blue-200",
  };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${colors[row.status] || "bg-gray-100 text-gray-700"}`}>{row.status}</span>;
}
