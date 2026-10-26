import React from 'react';
import { OfficialDocumentWrapper } from '../components/OfficialDocumentWrapper';

export const ReportCardPrint: React.FC = () => {
  return (
    <div className="space-y-4">
      {/* Action Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-xs print:hidden">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Ripoti Rasmi ya Maendeleo ya CBC (Learner Progress Form)
          </h2>
          <p className="text-xs text-slate-500">
            Mwanafunzi: <strong>Brian Baraka Kasamba</strong> &bull; ADM: <strong>ADM-MND-0582</strong> &bull; Darasa: <strong>Grade 5 Boarding</strong>
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm cursor-pointer"
        >
          Chapisha Ripoti (Print / PDF)
        </button>
      </div>

      <OfficialDocumentWrapper
        schoolName="MANDONGOI COMPREHENSIVE SCHOOL"
        moeRegNumber="MoE/PRI/2019/4021"
        poBox="S.L.P. 1 - 90401 Ngomeni, Kitui, Kenya"
        verificationHash="9f83ab293e41c42f9b8a104f"
        title="RIPOTI YA TATHMINI YA MAENDELEO YA CBC (GRADE 5 REPORT FORM)"
      >
        <div className="space-y-4 text-xs leading-relaxed">
          {/* Learner Demographics */}
          <div className="grid grid-cols-2 gap-4 pb-3 border-b border-slate-300">
            <div>
              <p><strong>Jina la Mwanafunzi:</strong> BRIAN BARAKA KASAMBA</p>
              <p><strong>NEMIS UPI:</strong> BBK521K</p>
              <p><strong>Nambari ya Usajili:</strong> ADM-MND-0582</p>
              <p><strong>Makazi:</strong> Mwanafunzi wa Bweni (Boarding - Mwingi North Wing)</p>
            </div>
            <div>
              <p><strong>Darasa:</strong> Grade 5 East</p>
              <p><strong>Muhula:</strong> Muhula wa 1 (Term 1, 2026)</p>
              <p><strong>Mzazi / Mlezi:</strong> KASAMBA KITHEKA (0718786067)</p>
              <p><strong>Mahudhurio:</strong> Siku 69 / 70</p>
            </div>
          </div>

          {/* CBC Learning Area Assessment Matrix */}
          <table className="w-full text-left border border-slate-400">
            <thead className="bg-slate-100 border-b border-slate-400 text-[11px] font-bold">
              <tr>
                <th className="p-2 border-r border-slate-400">Eneo la Kujifunza (Learning Area)</th>
                <th className="p-2 border-r border-slate-400">Kipengele (Strand)</th>
                <th className="p-2 border-r border-slate-400 text-center">Umahiri (Rubric)</th>
                <th className="p-2">Maoni ya Mwalimu wa Somo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              <tr>
                <td className="p-2 border-r border-slate-300 font-bold">Hisabati (Mathematics)</td>
                <td className="p-2 border-r border-slate-300">Fractions & Decimals</td>
                <td className="p-2 border-r border-slate-300 text-center font-bold text-emerald-800">EE (4/4)</td>
                <td className="p-2">Uelewa wa kina katika milinganyo na hisabati ya maisha halisi.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-bold">Sayansi na Teknolojia</td>
                <td className="p-2 border-r border-slate-300">Living Things & Environment</td>
                <td className="p-2 border-r border-slate-300 text-center font-bold text-blue-700">ME (3/4)</td>
                <td className="p-2">Anashiriki vizuri katika utafiti wa mimea na wanyama wa Kitui.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-bold">Kiingereza (English)</td>
                <td className="p-2 border-r border-slate-300">Debate & Comprehension</td>
                <td className="p-2 border-r border-slate-300 text-center font-bold text-emerald-800">EE (4/4)</td>
                <td className="p-2">Ufasaha mkubwa katika mawasiliano na uandishi wa ripoti.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-bold">Kiswahili</td>
                <td className="p-2 border-r border-slate-300">Kusikiliza na Sarufi</td>
                <td className="p-2 border-r border-slate-300 text-center font-bold text-blue-700">ME (3/4)</td>
                <td className="p-2">Uelewa mzuri wa misamiati na insha za kiubunifu.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-bold">Kilimo na Lishe (Agriculture)</td>
                <td className="p-2 border-r border-slate-300">Soil Conservation</td>
                <td className="p-2 border-r border-slate-300 text-center font-bold text-emerald-800">EE (4/4)</td>
                <td className="p-2">Vitendo bora katika mradi wa utunzaji wa mazingira ya shule.</td>
              </tr>
            </tbody>
          </table>

          {/* Core Values & Conduct */}
          <div className="p-3 bg-slate-50 border border-slate-300 rounded">
            <h4 className="font-bold text-slate-800 uppercase text-[11px] mb-1">Tathmini ya Maadili (Core Values):</h4>
            <p className="text-slate-700">
              Uzalendo, Heshima, Umoja, na Wajibu: <strong>Kiwango cha Juu (Exemplary Conduct)</strong>. Brian ni kiongozi mzuri bweni na darasani.
            </p>
          </div>

          {/* Official Signatures */}
          <div className="pt-6 grid grid-cols-2 gap-8 text-[11px]">
            <div>
              <p>Mwalimu wa Darasa (Class Teacher): _________________________</p>
              <p className="mt-1 text-slate-500">Saini & Tarehe</p>
            </div>
            <div>
              <p>Mwalimu Mkuu (Headteacher): <strong>Joel Maundu</strong></p>
              <div className="w-48 border-b border-slate-800 mt-4 pb-1 text-center font-serif text-[10px] italic">
                Joel Maundu - Headteacher & Secretary BOM
              </div>
            </div>
          </div>
        </div>
      </OfficialDocumentWrapper>
    </div>
  );
};
