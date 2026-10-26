import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast, subscribe } from "../../lib/toast";
import type { Toast } from "../../lib/toast";

type ToastContextValue = {
  toast: (message: string, options?: { title?: string; type?: "success" | "error" | "info" | "warning"; duration?: number }) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { t } = useTranslation();

  const addToast = (message: string, options: { title?: string; type?: "success" | "error" | "info" | "warning"; duration?: number } = {}) => {
    const id = toast(message, {
      title: options.title,
      type: options.type,
      duration: options.duration,
    });
    return id;
  };

  useEffect(() => {
    const unsub = subscribe((t) => {
      if (t.duration === 0) {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        return;
      }
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.duration);
    });
    return () => {
      unsub();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

interface ToastContainerProps {
  toasts: Toast[];
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps & { onDismiss: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

interface ToastProps {
  toast: Toast;
}

function Toast({ toast: t, onDismiss }: ToastProps & { onDismiss: () => void }) {
  const { t: tr } = useTranslation();

  const typeConfig: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    success: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", icon: "✓" },
    error: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: "!" },
    warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "⚠" },
    info: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "i" },
  };

  const cfg = typeConfig[t.type] ?? typeConfig.info;

  return (
    <div
      data-toast-id={t.id}
      className={`pointer-events-auto flex items-start gap-3 w-full max-w-sm p-4 rounded-xl border ${cfg.bg} ${cfg.border} ${cfg.text} toast-animate toast-slide-in`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-shrink-0 mt-0.5 font-bold">{cfg.icon}</div>
      <div className="leading-none">
        {t.title ? (
          <>
            <h4 className="font-semibold">{t.title}</h4>
            <p className="text-sm mt-0.5">{t.message}</p>
          </>
        ) : (
          <p className="text-sm">{t.message}</p>
        )}
      </div>
      <button
        type="button"
        className="ml-auto flex-shrink-0 rounded p-1 hover:bg-black/5 transition"
        onClick={() => {
          onDismiss();
        }}
        aria-label={tr("common.dismiss") ?? "Dismiss"}
      >
        ×
      </button>
    </div>
  );
}
