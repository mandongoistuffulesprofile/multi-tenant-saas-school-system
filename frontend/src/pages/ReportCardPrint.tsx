import React from 'react';
import { OfficialDocumentWrapper } from '../components/OfficialDocumentWrapper';

export const ReportCardPrint: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200 shadow-sm print:hidden">
        <div>
          <h2 className="text-base font-bold text-slate-900">Hakikisho la Ripoti Rasmi ya Maendeleo ya CBC</h2>
          <p className="text-xs text-slate-500">Inajumuisha Watermark na Nambari ya Uthibitisho ya QR kuzuia ughushi.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-emerald-600 text-white font-semibold text-xs rounded hover:bg-emerald-700 shadow"
        >
          Chapisha Ripoti (Print / Save as PDF)
        </button>
      </div>

      <OfficialDocumentWrapper
        schoolName="MANDONGOI BOARDING PRIMARY & JUNIOR SCHOOL"
        moeRegNumber="MoE/PRI/2019/4021"
        poBox="S.L.P. 45 - 90200, Kitui, Kenya"
        verificationHash="9f83ab293e41c42f9b8a104f"
        title="RIPOTI YA TATHMINI YA MAENDELEO YA MWANAFUNZI (CBC REPORT FORM)"
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4 pb-3 border-b border-slate-200">
            <div>
              <p><strong>Jina la Mwanafunzi:</strong> Wanjiku Kamau</p>
              <p><strong>NEMIS UPI:</strong> K89J21</p>
              <p><strong>Nambari ya Usajili:</strong> ADM-4102</p>
            </div>
            <div>
              <p><strong>Darasa:</strong> Grade 7 B</p>
              <p><strong>Muhula (Term):</strong> Term 1, 2026</p>
              <p><strong>Mahudhurio:</strong> Siku 68 / 70</p>
            </div>
          </div>

          <table className="w-full text-left border border-slate-300">
            <thead className="bg-slate-100 border-b border-slate-300">
              <tr>
                <th className="p-2 border-r border-slate-300">Somo (Learning Area)</th>
                <th className="p-2 border-r border-slate-300">Kiwango cha Umahiri</th>
                <th className="p-2">Maoni ya Mwalimu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              <tr>
                <td className="p-2 border-r border-slate-300 font-semibold">Hisabati (Mathematics)</td>
                <td className="p-2 border-r border-slate-300 text-emerald-700 font-bold">ME (Kufikia Matarajio)</td>
                <td className="p-2">Ana uwezo mzuri wa kutatua milinganyo na jiometria.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-semibold">Sayansi ya Jamii (Social Studies)</td>
                <td className="p-2 border-r border-slate-300 text-emerald-800 font-bold">EE (Kuzidi Matarajio)</td>
                <td className="p-2">Kiongozi hodari katika mijadala na shughuli za jamii.</td>
              </tr>
              <tr>
                <td className="p-2 border-r border-slate-300 font-semibold">Kiingereza (English Language)</td>
                <td className="p-2 border-r border-slate-300 text-emerald-700 font-bold">ME (Kufikia Matarajio)</td>
                <td className="p-2">Uandishi mzuri wa insha na uelewa wa vitabu vya ziada.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </OfficialDocumentWrapper>
    </div>
  );
};
