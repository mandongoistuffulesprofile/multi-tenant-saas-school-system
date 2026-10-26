import React from 'react';
import { Receipt, FileSpreadsheet, Send, X } from 'lucide-react';

interface Props {
  selectedCount: number;
  onClear: () => void;
  onBatchInvoice?: () => void;
  onExportCsv?: () => void;
}

export const FloatingBulkDock: React.FC<Props> = ({ selectedCount, onClear, onBatchInvoice, onExportCsv }) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 inset-x-0 mx-auto max-w-xl z-50 transition-all duration-200 transform animate-in fade-in slide-in-from-bottom-4">
      <div className="bg-slate-900/95 dark:bg-zinc-900/95 backdrop-blur-md text-white rounded-xl px-4 py-3 shadow-2xl border border-slate-700/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 text-xs font-mono">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600 text-white font-bold text-[11px]">
            {selectedCount}
          </span>
          <span className="text-slate-300">selected</span>
        </div>
        <div className="h-4 w-px bg-slate-700" />
        <div className="flex items-center gap-2">
          {onBatchInvoice && (
            <button onClick={onBatchInvoice} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/80 transition text-slate-100">
              <Receipt className="w-3.5 h-3.5 text-indigo-400" />
              Batch Invoice
            </button>
          )}
          {onExportCsv && (
            <button onClick={onExportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/80 transition text-slate-100">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Export Selected
            </button>
          )}
        </div>
        <button onClick={onClear} className="text-slate-400 hover:text-white text-xs p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
