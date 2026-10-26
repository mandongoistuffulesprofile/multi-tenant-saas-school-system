import React from "react";
import { Loader2, Inbox, AlertCircle, WifiOff, Lock } from "lucide-react";
import Button from "../atoms/Button";

export type ViewState = "loading" | "empty" | "error" | "offline" | "forbidden" | "content";

interface ViewStateProps {
  state: ViewState;
  message?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  children?: React.ReactNode;
}

const ICONS: Record<ViewState, React.ElementType | null> = {
  loading: Loader2,
  empty: Inbox,
  error: AlertCircle,
  offline: WifiOff,
  forbidden: Lock,
  content: null,
};

const MESSAGES: Record<ViewState, string> = {
  loading: "Loading data...",
  empty: "No data available",
  error: "Failed to load",
  offline: "Offline — using cached data",
  forbidden: "You don't have access to this.",
  content: "",
};

export default function ViewState({
  state,
  message,
  onRetry,
  onDismiss,
  className = "",
  children,
}: ViewStateProps) {
  if (state === "content") {
    return <div className={className}>{children}</div>;
  }

  const Icon = ICONS[state];

  return (
    <div className={`card p-12 text-center ${className}`}>
      <div className="text-4xl mb-3">
        {Icon && <Icon className="w-8 h-8 stroke-[1.5]" />}
      </div>
      <h3 className="text-heading mb-1">{message ?? MESSAGES[state]}</h3>
      {state === "error" && onRetry && (
        <Button variant="primary" onClick={onRetry} className="mt-4">
          Retry
        </Button>
      )}
      {state === "offline" && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="text-caption text-muted">Last synced {message ?? "—"}</span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Sync
            </Button>
          )}
        </div>
      )}
      {state === "forbidden" && onDismiss && (
        <Button variant="secondary" size="sm" onClick={onDismiss} className="mt-4">
          Back
        </Button>
      )}
    </div>
  );
}
