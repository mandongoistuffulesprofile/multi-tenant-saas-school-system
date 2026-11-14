const INSTALL_EVENT = "shule:beforeinstallprompt-ready";
const INSTALL_REQUEST_EVENT = "shule:install-requested";

/**
 * The BeforeInstallPromptEvent is non-standard and not in lib.dom, so the
 * subset of the API this module relies on is declared here.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  platforms: string[];
}

const emptyPromptDetail = () => ({
  type: "beforeinstallprompt",
  preventedDefault: () => {},
  prompt: () => Promise.resolve(),
  userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "" }),
  platforms: [] as string[],
});

let seenPrompt: BeforeInstallPromptEvent | null = null;

export async function watchInstallPrompt(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("beforeinstallprompt" in window)) {
    return;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    const installEvent = event as BeforeInstallPromptEvent;
    installEvent.preventDefault();
    seenPrompt = installEvent;
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail: installEvent }));
  });

  window.addEventListener("appinstalled", () => {
    seenPrompt = null;
    window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail: emptyPromptDetail() }));
  });
}

export function onInstallPromptReady(
  listener: (event: BeforeInstallPromptEvent) => void,
): () => void {
  const handler = (event: Event) => listener(event as BeforeInstallPromptEvent);
  window.addEventListener(INSTALL_EVENT, handler);
  return () => window.removeEventListener(INSTALL_EVENT, handler);
}

export async function requestInstall(): Promise<boolean> {
  if (!seenPrompt) {
    window.dispatchEvent(new CustomEvent(INSTALL_REQUEST_EVENT));
    return false;
  }
  try {
    await seenPrompt.prompt();
    const choice = await seenPrompt.userChoice;
    if (choice.outcome === "accepted") {
      seenPrompt = null;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
