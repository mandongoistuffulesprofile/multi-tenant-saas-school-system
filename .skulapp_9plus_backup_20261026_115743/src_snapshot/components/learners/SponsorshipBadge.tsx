import React from 'react';
import { Landmark, User } from 'lucide-react';

export interface SponsorshipBadgeProps {
  sponsorName?: string | null;
  grantCode?: string | null;
  splitRatio?: string;
}

export const SponsorshipBadge: React.FC<SponsorshipBadgeProps> = ({
  sponsorName,
  grantCode,
  splitRatio = "80/20"
}) => {
  if (!sponsorName) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
        <User className="w-3 h-3 text-slate-400" />
        <span>Self / Guardian</span>
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 shadow-2xs">
      <Landmark className="w-3 h-3 text-indigo-600 dark:text-indigo-400 stroke-[1.75]" />
      <span className="font-semibold">{sponsorName}</span>
      <span className="text-[10px] px-1 rounded bg-indigo-100 dark:bg-indigo-900/60 font-mono text-indigo-800 dark:text-indigo-200">
        {splitRatio}
      </span>
      {grantCode && <span className="text-[10px] font-mono text-indigo-500">#{grantCode}</span>}
    </div>
  );
};
export default SponsorshipBadge;
