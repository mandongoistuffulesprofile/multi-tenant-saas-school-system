import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../../lib/authStore";
import Button from "../../components/atoms/Button";
import Card from "../../components/atoms/Card";
import Badge from "../../components/atoms/Badge";
import DataTable from "../../components/organisms/DataTable";
import { api } from "../../lib/api";
import { getQueue, queueCount, syncNow, isSyncing } from "../../lib/sync";
import { QueuedOp } from "../../lib/offline";

type Conflict = {
  conflict_id: string;
  entity_type: string;
  entity_id: string;
  client_version: number;
  server_version: number;
  resolved: boolean;
  created_at: string;
};

export default function SyncCentrePage() {
  const { t } = useTranslation();
  const { tenantId } = useAuthStore();
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [count, setCount] = useState(0);
  const syncing = isSyncing();

  const refresh = async () => {
    if (tenantId) {
      setQueue(await getQueue(tenantId));
      setCount(await queueCount());
    }
    try {
      const { data } = await api.get<Conflict[]>("/sync/conflicts");
      setConflicts(Array.isArray(data) ? data.filter((c) => !c.resolved) : []);
    } catch {
      // offline or forbidden; keep last known list
    }
  };

  useEffect(() => {
    void refresh();
  }, [tenantId]);

  const handleSync = async () => {
    const res = await syncNow();
    await refresh();
    return res;
  };

  const resolveConflict = async (id: string, resolution: "KEEP_MINE" | "KEEP_THEIRS") => {
    try {
      await api.post(`/sync/conflicts/${id}/resolve`, { resolution });
    } finally {
      await refresh();
    }
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
          <Button variant="primary" onClick={handleSync} disabled={syncing || (count === 0 && conflicts.length === 0)} loading={syncing}>
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

      <Card className="p-4">
        <h3 className="text-heading mb-3">Conflicts</h3>
        {conflicts.length === 0 ? (
          <p className="text-sm text-muted">No conflicts</p>
        ) : (
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div key={c.conflict_id} className="border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">{c.entity_type}</div>
                  <div className="text-muted">Client v{c.client_version} vs Server v{c.server_version}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void resolveConflict(c.conflict_id, "KEEP_MINE")}>Keep mine</Button>
                  <Button variant="secondary" size="sm" onClick={() => void resolveConflict(c.conflict_id, "KEEP_THEIRS")}>Keep server</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
