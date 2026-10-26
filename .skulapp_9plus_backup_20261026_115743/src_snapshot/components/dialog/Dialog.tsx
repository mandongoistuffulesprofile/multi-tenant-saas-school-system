import React, { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

export default function Dialog({ open, onClose, title, children, className }: DialogProps) {
  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed left-1/2 top-1/2 z-50 w-full max-w-md transform translate-x-[-50%] translate-y-[-50%] scale-100 bg-white rounded-2xl shadow-2xl border border-gray-200 p-6 focus:outline-none ${className ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {title && (
          <h2 id="dialog-title" className="text-lg font-bold text-gray-900 mb-3">
            {title}
          </h2>
        )}
        <div className="space-y-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2"></div>
      </div>
    </>
  );
}
