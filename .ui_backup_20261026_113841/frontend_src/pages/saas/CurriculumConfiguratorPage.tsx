import { api } from "../../lib/api";
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
    let alive = true;
    // Platform curriculum register: seeded CBC versions, one source of truth
    // for the school-side Curriculum configurator too.
    api
      .get("/curriculum/versions")
      .then((r) => {
        if (!alive) return;
        setVersions(Array.isArray(r.data) ? r.data : []);
        setState("content");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") return <ViewState state="loading" />;
  if (state === "error") return <ViewState state="error" message={'Failed to load curriculum versions'} />;

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
          emptyMessage={'No curriculum versions'}
          keyField="version_id"
        />
      </Card>
    </div>
  );
}
