/**
 * Production-only service-worker lifecycle.
 *
 * - The SW installs into the waiting state; it never activates over a live tab.
 * - The UI listens for `shule:sw-update-available` and offers a controlled
 *   reload, which posts SKIP_WAITING.
 * - controllerchange reloads once, and only if the page was already controlled
 *   (the first install must not reload the page under the user).
 */

const UPDATE_EVENT = "shule:sw-update-available";

let hadController = false;
let refreshing = false;

function announceUpdate(reg: ServiceWorkerRegistration) {
  if (!reg.waiting) return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

export function onServiceWorkerUpdate(listener: () => void): () => void {
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

export async function applyServiceWorkerUpdate(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg?.waiting) {
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
  } else {
    // No waiting worker (e.g. an update already activated): reload cleanly.
    window.location.reload();
  }
}

export function registerServiceWorker() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !import.meta.env.PROD
  ) {
    return;
  }

  hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // A worker may already be waiting from a previous visit.
        announceUpdate(reg);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              announceUpdate(reg);
            }
          });
        });

        // Check for a new deployment when the app returns to the foreground.
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) reg.update().catch(() => undefined);
        });
      })
      .catch((err) => {
        console.error("Service worker registration failed:", err);
      });
  });
}
