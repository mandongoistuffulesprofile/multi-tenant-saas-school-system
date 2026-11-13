const INSTALL_EVENT = "shule:beforeinstallprompt-ready";
const INSTALL_REQUEST_EVENT = "shule:install-requested";

export type InstallPromptState =
  | { ready: true; prompt: BeforeInstallPromptEvent }
  | { ready: false; reason: "no-support" | "already-installed" | "not-yet-available" };

export type BeforeInstallPromptEvent = Pick<
  BeforeInstallPromptEventInit,
  "prompt" | "userChoice" | "platforms"
> & {
  type: "beforeinstallprompt";
  preventedDefault: () => void;
};

let storedPrompt: InstallPromptEvent | null = null;

export function onInstallPromptReady(listener: (event: BeforeInstallPromptEvent) => void): () => void {
  const handler = (event: BeforeInstallPromptEvent) => listener(event);
  window.addEventListener(INSTALL_EVENT, handler);
  return () => window.removeEventListener(INSTALL_EVENT, handler);
}

export async function watchInstallPrompt(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("beforeinstallprompt" in window)) {
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, {
      detail: { type: "beforeinstallprompt", preventedDefault: () => {}, prompt: null as unknown as BeforeInstallPromptEvent, platforms: [] },
    }));
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    storedPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail: event as BeforeInstallPromptEvent }));
  }, { once: false });

  window.addEventListener("appinstalled", () => {
    storedPrompt = null;
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, {
      detail: { type: "beforeinstallprompt", preventedDefault: () => {}, prompt: null as unknown as BeforeInstallPromptEvent, platforms: [] },
    }));
  }, { once: false });

  if (storedPrompt) {
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail: storedPrompt }));
  }
}

export async function requestInstall(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("beforeinstallprompt" in window)) {
    return false;
  }

  window.dispatchEvent(new CustomEvent(INSTALL_REQUEST_EVENT));
  if (!storedPrompt) {
    return false;
  }
  try {
    storedPrompt.prompt();
    const choice = await storedPrompt.userChoice;
    if (choice.outcome === "accepted") {
      storedPrompt = null;
      window.dispatchEvent(new CustomEvent(INSTALL_EVENT, {
        detail: { type: "beforeinstallprompt", preventedDefault: () => {}, prompt: null as unknown as BeforeInstallPromptEvent, platforms: [] },
      }));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
