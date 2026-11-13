import React, { useEffect, useRef, useState } from "react";
import { onInstallPromptReady } from "../lib/installPrompt";

type InstallState =
  | { kind: "ready"; prompt: unknown }
  | { kind: "pending" }
  | { kind: "none" };

export default function PWAInstallCard({
  canInstall,
  onInstallRequest,
}: {
  canInstall: boolean | null;
  onInstallRequest: () => Promise<boolean>;
}) {
  const [state, setState] = useState<InstallState>({ kind: "pending" });
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    if (canInstall === null) {
      setState({ kind: "pending" });
      return;
    }

    if (canInstall === false) {
      setState({ kind: "none" });
      mounted = false;
      return;
    }

    const ready = (event: unknown) => {
      if (!mounted) return;
      setState({ kind: "ready", prompt: event });
    };

    onInstallPromptReady(ready);
    return () => {
      mounted = false;
    };
  }, [canInstall, onInstallRequest]);

  if (state.kind === "none") {
    return null;
  }

  if (state.kind === "pending") {
    return (
      <div
        ref={cardRef}
        className="fixed bottom-4 right-4 z-50 pointer-events-none"
      >
        <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 backdrop-blur shadow-md max-w-xs text-sm text-slate-700">
          <p className="font-medium text-slate-900">Shule Yetu</p>
          <p className="mt-1 text-slate-600 text-[13px]">
            Add to Home Screen to get quick access to roll call, fees and reports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 pointer-events-none"
    >
      <button
        type="button"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-4 py-2 backdrop-blur shadow-md text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-40"
        onClick={() => onInstallRequest().then((accepted) => {
          if (accepted) {
            // The browser takes over; the card can hide after install if
            // the app handles the appinstalled event elsewhere.
          }
        })}
      >
        <svg className="w-5 h-5 text-kenyan-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Add Shule Yetu
      </button>
    </div>
  );
}
