import React, { useState } from 'react';

interface AuditConfirmationModalProps {
  isOpen: boolean;
  title: string;
  warningMessage: string;
  actionButtonLabel: string;
  onConfirm: (justification: string) => void;
  onClose: () => void;
}

export const AuditConfirmationModal: React.FC<AuditConfirmationModalProps> = ({
  isOpen,
  title,
  warningMessage,
  actionButtonLabel,
  onConfirm,
  onClose,
}) => {
  const [justification, setJustification] = useState('');
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const REQUIRED_KEYWORD = 'THIBITISHA';

  if (!isOpen) return null;

  const isActionAllowed = justification.trim().length >= 10 && confirmKeyword === REQUIRED_KEYWORD;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-rose-200 overflow-hidden animate-in fade-in">
        <div className="bg-rose-50 border-b border-rose-100 p-4">
          <h3 className="text-sm font-bold text-rose-900 uppercase tracking-wide">{title}</h3>
          <p className="text-xs text-rose-700 mt-1">{warningMessage}</p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Sababu ya Kisheria (Audit Justification &bull; Min 10 Herufi):
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Mfano: Idhini ya Mkutano wa BOM Tarehe 12/03/2026..."
              className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Andika <span className="font-mono text-rose-600 bg-rose-50 px-1 py-0.5 rounded font-bold">THIBITISHA</span> kuendelea:
            </label>
            <input
              type="text"
              value={confirmKeyword}
              onChange={(e) => setConfirmKeyword(e.target.value)}
              className="w-full text-xs p-2 border border-slate-300 rounded uppercase font-mono focus:ring-1 focus:ring-rose-500"
              placeholder="THIBITISHA"
            />
          </div>
        </div>

        <div className="bg-slate-50 p-3 flex justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded"
          >
            Ghairi (Cancel)
          </button>
          <button
            type="button"
            disabled={!isActionAllowed}
            onClick={() => onConfirm(justification)}
            className={`px-3 py-1.5 text-xs font-semibold rounded text-white transition-all ${
              isActionAllowed ? 'bg-rose-600 hover:bg-rose-700 shadow' : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            {actionButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
