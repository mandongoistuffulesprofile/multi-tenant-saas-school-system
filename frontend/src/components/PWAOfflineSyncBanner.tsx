import React from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { onSyncChange, queueCount } from "../lib/sync";

/**
 * Connection and queue status for staffroom networks.
 *
 * Offline is explicit; queued writes are stated separately from connectivity so
 * a teacher can tell whether work is waiting or already delivered. The banner
 * announces the restored connection briefly, then disappears.
 */
export const PWAOfflineSyncBanner: React.FC = () => {
  const [isOffline, setIsOffline] = React.useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [pending, setPending] = React.useState(0);
  const [reconnected, setReconnected] = React.useState(false);

  React.useEffect(() => {
    let alive = true;

    const refresh = () => {
      queueCount()
        .then((n) => { if (alive) setPending(n); })
        .catch(() => undefined);
    };
    refresh();
    const unsubscribe = onSyncChange(refresh);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const goOnline = () => {
      setIsOffline(false);
      setReconnected(true);
      refresh();
      timer = setTimeout(() => setReconnected(false), 4000);
    };
    const goOffline = () => {
      setIsOffline(true);
      setReconnected(false);
      refresh();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!isOffline && pending === 0 && !reconnected) return null;

  const copy = isOffline
    ? pending > 0
      ? `Offline. ${pending} change${pending === 1 ? "" : "s"} saved on this device and waiting to sync.`
      : "Offline. Read-only data may be unavailable; new changes will be saved on this device."
    : reconnected
      ? "Connection restored. Syncing queued changes…"
      : `${pending} change${pending === 1 ? "" : "s"} queued for sync.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 border-b px-4 py-2 text-xs font-medium ${
        isOffline
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-teal-200 bg-teal-50 text-teal-900"
      }`}
    >
      {isOffline ? (
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{copy}</span>
    </div>
  );
};

export default PWAOfflineSyncBanner;
