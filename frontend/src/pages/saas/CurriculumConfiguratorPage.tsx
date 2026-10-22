import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";

export default function SaaSCurriculumPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<"loading" | "content" | "error">("loading");
  const [versions, setVersions] = useState<any[]>([]);

  useEffect(() => {
    setVersions([
      { version_id: "v1", version_label: "CBC 2024", is_published: true, effective_from: "2024-01-01", description: "Competency Based Curriculum 2024" },
      { version_id: "v2", version_label: "CBC 2025 Draft", is_published: false, effective_from: "2025-01-01", description: "Draft for review" },
    ]);
    setState("content");
  }, []);

  if (state === "loading") return <ViewState state="loading" />;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("saas.curriculum")}</h1>
      <Card className="p-4">
        <DataTable
          data={versions}
          columns={[
            { key: "version_label", header: t("version") },
            { key: "description", header: t("description") },
            { key: "effective_from", header: t("saas.effective_from") },
            { key: "is_published", header: t("status"), render: (row: any) => <Badge variant="default">{row.is_published ? t("published") : t("draft")}</Badge> },
            { key: "actions", header: t("actions"), render: () => <></> },
          ]}
          emptyMessage={t("no_curriculum", { defaultMessage: "No curriculum versions" })}
          keyField="version_id"
        />
      </Card>
    </div>
  );
}
