import React from "react";

interface StatusIndicatorProps {
  label: string;
  status: "idle" | "loading" | "saved" | "error";
  className?: string;
}

export function StatusIndicator({ label, status, className = "" }: StatusIndicatorProps) {
  const lastRefresh = typeof document !== "undefined"
    ? document.lastModified
    : "";

  if (status === "idle") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`} aria-live="polite">
        <span className="inline-block h-2 w-2 rounded-full bg-slate-300" />
        {label}
      </span>
    );
  }

  if (status === "loading") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`} aria-live="polite">
        <span className="inline-block h-2 w-2 rounded-full animate-pulse bg-amber-400" />
        Loading {label.toLowerCase()}...
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-kenyan-green font-medium ${className}`} aria-live="polite">
        <span className="inline-block h-2 w-2 rounded-full bg-kenyan-green" />
        Saved {label.toLowerCase()}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-red-600 font-medium ${className}`} aria-live="assertive">
      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
      Could not load {label.toLowerCase()}. Retrying...
    </span>
  );
}
