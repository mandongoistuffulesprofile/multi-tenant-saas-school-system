import React from 'react';
import { LucideIcon, FileSpreadsheet, Plus } from 'lucide-react';

export interface InstitutionalEmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}

export const InstitutionalEmptyState: React.FC<InstitutionalEmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = FileSpreadsheet
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-xl my-4 bg-slate-50/50 dark:bg-zinc-900/30">
      <div className="p-3 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-xs mb-3 text-slate-600 dark:text-zinc-400">
        <Icon className="w-6 h-6 stroke-[1.5]" />
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 tracking-tight">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-sm mt-1.5 mb-5 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-lg transition shadow-xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};
export default InstitutionalEmptyState;
