import React from 'react';
import { formatKES } from '../utils/kenyaFormatters';

export const BOMOversight: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Dashibodi ya Bodi ya Usimamizi wa Shule (BOM Oversight)</h2>
        <p className="text-xs text-slate-500">Uchambuzi wa Mapato, Capitation ya Serikali (FDSE/FPE) na Mishahara ya Walimu wa BOM</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 uppercase font-semibold">Ada Iliyokusanywa (Term 1)</span>
          <div className="text-xl font-bold text-emerald-600 font-mono mt-1">{formatKES(4850000)}</div>
          <p className="text-[11px] text-slate-500 mt-1">78% ya makisio ya bajeti</p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 uppercase font-semibold">Capitation ya Wizara (MoE)</span>
          <div className="text-xl font-bold text-blue-600 font-mono mt-1">{formatKES(1920000)}</div>
          <p className="text-[11px] text-slate-500 mt-1">Kulingana na data ya NEMIS</p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 uppercase font-semibold">M-Pesa Isiyotambuliwa (Pool)</span>
          <div className="text-xl font-bold text-amber-600 font-mono mt-1">{formatKES(42500)}</div>
          <p className="text-[11px] text-slate-500 mt-1">Miamala 4 inasubiri kuwekwa</p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 uppercase font-semibold">Mishahara ya Walimu wa BOM</span>
          <div className="text-xl font-bold text-purple-600 font-mono mt-1">{formatKES(620000)}</div>
          <p className="text-[11px] text-slate-500 mt-1">Walimu 8 wa mkataba</p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm text-xs">
        <h3 className="font-bold text-slate-800 text-sm mb-3">Muhtasari wa Ukaguzi wa Robo Mwaka (Quarterly Audit Pack)</h3>
        <p className="text-slate-600 mb-4">
          Ripoti hii inakidhi viwango vya Ukaguzi wa Hesabu za Umma na Maafisa wa Ukaguzi wa Ubora wa Wizara (QASO).
        </p>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-slate-900 text-white font-semibold rounded hover:bg-slate-800"
        >
          Pakua Pakiti Kamili ya Mkutano wa BOM (PDF)
        </button>
      </div>
    </div>
  );
};
