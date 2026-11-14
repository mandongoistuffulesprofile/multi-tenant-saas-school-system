const INSTALL_EVENT = "shule:beforeinstallprompt-ready";
const INSTALL_REQUEST_EVENT = "shule:install-requested";

/**
 * `beforeinstallprompt` is not in the TypeScript DOM lib, so the event shape is
 * declared here instead of leaning on `BeforeInstallPromptEventInit`.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

export type InstallPromptState =
  | { ready: true; prompt: BeforeInstallPromptEvent }
  | { ready: false; reason: "no-support" | "already-installed" | "not-yet-available" };

let storedPrompt: BeforeInstallPromptEvent | null = null;

/** Stand-in event for listeners when the browser has nothing to prompt with. */
function noPromptEvent(): BeforeInstallPromptEvent {
  return {
    type: "beforeinstallprompt",
    platforms: [],
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: "dismissed", platform: "" }),
  } as unknown as BeforeInstallPromptEvent;
}

function notify(detail: BeforeInstallPromptEvent | null): void {
  window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail }));
}

export function onInstallPromptReady(listener: (event: BeforeInstallPromptEvent) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<BeforeInstallPromptEvent | null>).detail;
    listener(detail ?? noPromptEvent());
  };
  window.addEventListener(INSTALL_EVENT, handler);
  return () => window.removeEventListener(INSTALL_EVENT, handler);
}

export async function watchInstallPrompt(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("beforeinstallprompt" in window)) {
    notify(null);
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    const promptEvent = event as BeforeInstallPromptEvent;
    promptEvent.preventDefault();
    storedPrompt = promptEvent;
    notify(promptEvent);
  });

  window.addEventListener("appinstalled", () => {
    storedPrompt = null;
    notify(null);
  });

  if (storedPrompt) {
    notify(storedPrompt);
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
    await storedPrompt.prompt();
    const choice = await storedPrompt.userChoice;
    if (choice.outcome === "accepted") {
      storedPrompt = null;
      notify(null);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
