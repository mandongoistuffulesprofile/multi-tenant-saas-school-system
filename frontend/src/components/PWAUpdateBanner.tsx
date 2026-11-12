import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { applyServiceWorkerUpdate, onServiceWorkerUpdate } from "../serviceWorkerRegistration";

/**
 * Deliberate update prompt. The service worker installs into `waiting`; the
 * user decides when to swap builds, so in-progress forms are never interrupted.
 */
export default function PWAUpdateBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => onServiceWorkerUpdate(() => setAvailable(true)), []);

  if (!available || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[70] flex flex-wrap items-center justify-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
    >
      <RefreshCw className="h-4 w-4 text-amber-300" aria-hidden="true" />
      <span>A newer version of Shule Yetu is ready.</span>
      <button
        type="button"
        className="rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-60"
        disabled={applying}
        onClick={async () => {
          setApplying(true);
          await applyServiceWorkerUpdate();
        }}
      >
        {applying ? "Updating…" : "Reload to update"}
      </button>
      <button
        type="button"
        className="rounded-md p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
        aria-label="Dismiss update notice"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
