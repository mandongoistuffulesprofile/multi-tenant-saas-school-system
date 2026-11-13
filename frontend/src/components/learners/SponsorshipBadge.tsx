import React from 'react';
import { MpesaIcon, BankSlipIcon, GovShieldIcon } from '../icons/PaymentIcons';

export type SponsorshipType = 'GOVERNMENT_BURSARY' | 'CORPORATE_FOUNDATION' | 'INDIVIDUAL';

export interface SponsorshipBadgeProps {
  sponsorName?: string | null;
  grantCode?: string | null;
  splitRatio?: string;
  type?: SponsorshipType;
}

export const SponsorshipBadge: React.FC<SponsorshipBadgeProps> = ({
  sponsorName,
  grantCode,
  splitRatio = '80/20',
  type = 'INDIVIDUAL',
}) => {
  if (!sponsorName) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span>Self / Guardian</span>
      </span>
    );
  }

  const theme = type === 'GOVERNMENT_BURSARY'
    ? { badge: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700', icon: GovShieldIcon, labelColor: 'text-amber-800 dark:text-amber-300', codeColor: 'text-amber-700 dark:text-amber-400' }
    : type === 'CORPORATE_FOUNDATION'
      ? { badge: 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-700', icon: BankSlipIcon, labelColor: 'text-blue-800 dark:text-blue-300', codeColor: 'text-blue-700 dark:text-blue-400' }
      : { badge: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700', icon: MpesaIcon, labelColor: 'text-slate-700 dark:text-slate-300', codeColor: 'text-slate-600 dark:text-slate-400' };

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border shadow-2xs ${theme.badge}`}>
      <theme.icon size={14} className={`shrink-0 ${theme.labelColor}`} aria-hidden="true" />
      <span className={`font-semibold ${theme.labelColor}`}>{sponsorName}</span>
      <span className={`text-[10px] px-1 rounded font-mono ${theme.codeColor}`}>{splitRatio}</span>
      {grantCode && <span className={`text-[10px] font-mono ${theme.codeColor}`}>#{grantCode}</span>}
    </div>
  );
};
export default SponsorshipBadge;
