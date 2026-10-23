import React from "react";

interface PWAOfflineSyncBannerProps {
  /** Number of mutations waiting in the offline queue. */
  pendingCount?: number;
  /** Force the banner even when the browser reports connectivity. */
  offline?: boolean;
}

/**
 * Thin status strip shown above the app shell.
 *
 * It uses the browser's online/offline events plus the pending sync count so
 * teachers on intermittent connections can see whether work is safely queued.
 */
export const PWAOfflineSyncBanner: React.FC<PWAOfflineSyncBannerProps> = ({
  pendingCount = 0,
  offline,
}) => {
  const [isOffline, setIsOffline] = React.useState(
    offline ?? (typeof navigator !== "undefined" ? !navigator.onLine : false)
  );

  React.useEffect(() => {
    if (offline !== undefined) {
      setIsOffline(offline);
      return;
    }
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [offline]);

  if (!isOffline && pendingCount === 0) return null;

  return (
    <div
      role="status"
      className={`px-4 py-1.5 text-[11px] font-semibold text-center ${
        isOffline
          ? "bg-amber-100 text-amber-900 border-b border-amber-300"
          : "bg-blue-100 text-blue-900 border-b border-blue-300"
      }`}
    >
      {isOffline
        ? "Hakuna mtandao — kazi yako inahifadhiwa kwenye kifaa."
        : `${pendingCount} kumbukumbu zinasubiri kusawazishwa.`}
      {pendingCount > 0 && isOffline ? ` (${pendingCount} zinasubiri)` : ""}
    </div>
  );
};

export default PWAOfflineSyncBanner;
