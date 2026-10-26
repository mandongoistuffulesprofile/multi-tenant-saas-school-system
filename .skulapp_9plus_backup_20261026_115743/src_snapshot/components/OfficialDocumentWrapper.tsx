import React from 'react';

interface OfficialPrintDocProps {
  schoolName: string;
  moeRegNumber: string;
  poBox: string;
  watermarkText?: string;
  verificationHash: string;
  title: string;
  children: React.ReactNode;
}

export const OfficialDocumentWrapper: React.FC<OfficialPrintDocProps> = ({
  schoolName,
  moeRegNumber,
  poBox,
  watermarkText = 'STAMPED & VERIFIED',
  verificationHash,
  title,
  children,
}) => {
  return (
    <div className="relative bg-white p-8 max-w-4xl mx-auto border border-slate-200 shadow-md text-slate-900 print:border-none print:shadow-none print:p-0">
      {/* Background Anti-Tamper Diagonal Watermark */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-5 select-none rotate-[-30deg] text-6xl font-black uppercase tracking-wider text-slate-900"
      >
        {watermarkText}
      </div>

      {/* Official MoE Standard Header */}
      <header className="border-b-2 border-slate-900 pb-3 mb-6 text-center">
        <h1 className="text-xl font-black tracking-tight uppercase text-slate-900">{schoolName}</h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Usajili wa Wizara (MoE Reg): <strong>{moeRegNumber}</strong> &bull; {poBox}
        </p>
        <div className="inline-block mt-3 px-4 py-0.5 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest">
          {title}
        </div>
      </header>

      {/* Document Content */}
      <main className="relative z-10">{children}</main>

      {/* Signature & Verification Block */}
      <footer className="mt-12 pt-4 border-t border-slate-300 flex justify-between items-end text-xs">
        <div className="space-y-6">
          <div className="w-52 border-b border-dashed border-slate-600 pb-1 text-center text-slate-500 italic">
            Saini ya Mwalimu Mkuu & Muhuri Rasmi
          </div>
          <p className="text-[10px] text-slate-400">Mfumo Salama wa EduKe SaaS &bull; Hati Rasmi</p>
        </div>

        <div className="text-right">
          <div className="p-1 border border-slate-300 inline-block bg-slate-50">
            <div className="w-14 h-14 bg-slate-200 flex items-center justify-center text-[7px] text-center font-mono font-bold leading-tight">
              QR<br/>VERIFIED
            </div>
          </div>
          <p className="text-[9px] font-mono mt-1 text-slate-500">HASH: {verificationHash.substring(0, 16)}...</p>
        </div>
      </footer>
    </div>
  );
};
