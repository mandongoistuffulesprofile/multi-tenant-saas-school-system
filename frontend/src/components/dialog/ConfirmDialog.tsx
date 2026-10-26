import React, { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md transform translate-x-[-50%] translate-y-[-50%] scale-100 bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-bold text-gray-900 mb-2">
          {title ?? t("confirm")}
        </h2>
        {message && <p className="text-gray-600 mb-6">{message}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            {cancelLabel ?? t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`btn-primary ${destructive ? "bg-slate-900 hover:bg-slate-900 focus:ring-red-600" : ""}`}
          >
            {confirmLabel ?? t("save")}
          </button>
        </div>
      </div>
    </>
  );
}
