import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/atoms/Button";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import ViewState from "../../components/organisms/ViewState";
import DataTable from "../../components/organisms/DataTable";
import { getQueue, queueCount, syncNow, isSyncing } from "../../lib/sync";
import { QueuedOp } from "../../lib/offline";

export default function SyncCentrePage() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [count, setCount] = useState(0);
  const syncing = isSyncing();

  useEffect(() => {
    (async () => {
      setQueue(await getQueue());
      setCount(await queueCount());
    })();
  }, []);

  const handleSync = async () => {
    const res = await syncNow();
    setQueue(await getQueue());
    setCount(await queueCount());
    return res;
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-display font-display">{t("teacher.sync_centre")}</h1>
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-heading mb-1">{t("teacher.pending_sync")}</h2>
            <p className="text-caption text-muted">{t("teacher.changes_waiting", { defaultMessage: "Changes waiting to sync to the server" })}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-kenyan-red">{count}</div>
            <div className="text-caption text-muted">{t("teacher.items", { defaultMessage: "items" })}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Badge variant={syncing ? "warning" : "default"}>{syncing ? t("teacher.syncing", { defaultMessage: "Syncing…" }) : t("teacher.online", { defaultMessage: "Online" })}</Badge>
          <Button variant="primary" onClick={handleSync} disabled={syncing || count === 0} loading={syncing}>
            {t("teacher.sync_now", { defaultMessage: "Sync Now" })}
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-heading mb-3">{t("queue")}</h3>
        <DataTable
          data={queue}
          columns={[
            { key: "type", header: t("type") },
            { key: "endpoint", header: t("endpoint") },
            { key: "method", header: t("method") },
            { key: "retries", header: t("retries") },
            { key: "created_at", header: t("created_at") },
          ]}
          emptyMessage={t("no_pending_changes", { defaultMessage: "No pending changes" })}
          keyField="id"
        />
      </Card>
    </div>
  );
}
