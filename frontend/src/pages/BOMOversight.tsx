import React from 'react';
import { formatKES } from '../utils/kenyaFormatters';

export const BOMOversight: React.FC = () => {
  return (
    <div className="space-y-4">
      {/* Executive Header */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Dashibodi ya Bodi ya Usimamizi (BOM Oversight & QASO Compliance)
          </h2>
          <p className="text-xs text-slate-500">
            Mandongoi Comprehensive School &bull; Mwongozo wa Fedha wa Wizara ya Elimu (MoE Financial Regulations)
          </p>
        </div>
        <div className="text-right">
          <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-1 rounded font-bold border">
            Term 1, 2026 Audit Cycle
          </span>
        </div>
      </div>

      {/* Statutory Account 1 (SIMBA) vs Account 2 (GP) KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Akaunti 1: Masomo (SIMBA/Tuition)</span>
          <div className="text-xl font-black text-blue-700 font-mono mt-1">{formatKES(724200)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Inalindwa kisheria kwa vitabu na mitihani pekee.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Akaunti 2: Uendeshaji (General Purpose)</span>
          <div className="text-xl font-black text-emerald-700 font-mono mt-1">{formatKES(1195800)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Maji, umeme, ukarabati na wafanyakazi wasio wa walimu.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Pengo la Capitation (NEMIS Gap)</span>
          <div className="text-xl font-black text-rose-600 font-mono mt-1">{formatKES(127800)}</div>
          <p className="text-[10px] text-rose-700 font-semibold mt-1">Hasara ya ruzuku kutokana na wanafunzi wasio na UPI.</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] text-slate-500 uppercase font-bold">Mishahara ya Walimu wa BOM</span>
          <div className="text-xl font-black text-purple-700 font-mono mt-1">{formatKES(480000)}</div>
          <p className="text-[10px] text-slate-500 mt-1">Walimu 6 wa mkataba (Inayolipwa kutoka mfuko wa PTA).</p>
        </div>
      </div>

      {/* QASO Audit & Institutional Health Indicators */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs text-xs space-y-4">
        <h3 className="font-bold text-slate-900 text-sm">Vipimo Muhimu vya Ukaguzi wa Wizara (QASO Statutory Compliance)</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Uwiano wa Mwalimu kwa Mwanafunzi (TLR):</span>
            <div className="text-base font-black text-slate-900 mt-1">1 : 42</div>
            <p className="text-[10px] text-emerald-700 font-medium mt-0.5">Inakidhi vigezo vya TSC (Chini ya kiwango cha 1:45).</p>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Kiwango cha Usawa wa Jinsia (Gender Parity):</span>
            <div className="text-base font-black text-slate-900 mt-1">48% Wasichana &bull; 52% Wavulana</div>
            <p className="text-[10px] text-blue-700 font-medium mt-0.5">Uwiano thabiti katika bweni na madarasa ya kawaida.</p>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-700">Kiwango cha Mahudhurio ya Shule (Attendance):</span>
            <div className="text-base font-black text-slate-900 mt-1">97.4%</div>
            <p className="text-[10px] text-emerald-700 font-medium mt-0.5">Programu ya chakula cha mchana inadumisha mahudhurio.</p>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
          <p className="text-slate-500">
            Ripoti hii inazalishwa kwa mujibu wa kifungu cha 56 cha Sheria ya Elimu ya Msingi (Basic Education Act 2013).
          </p>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg cursor-pointer"
          >
            Pakua Ripoti Kamili ya Ukaguzi wa BOM (PDF)
          </button>
        </div>
      </div>
    </div>
  );
};
