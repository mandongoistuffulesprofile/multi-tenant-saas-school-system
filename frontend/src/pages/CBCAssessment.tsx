import React, { useState } from 'react';
import { CBCRubricSelector } from '../components/CBCRubricSelector';
import { CBCLevel, CBC_RUBRIC_CONFIG } from '../utils/kenyaFormatters';
// @ts-ignore
import CBCRubricAssessment from '../components/CBCRubricAssessment';

interface LearnerAssessment {
  id: string;
  upi: string;
  student_name: string;
  grade: string;
  strand: string;
  substrand: string;
  rubric: CBCLevel | null;
}

const INITIAL_LEARNERS: LearnerAssessment[] = [
  { id: '1', upi: 'K89J21', student_name: 'Wanjiku Kamau', grade: 'Grade 7', strand: 'Integrated Science', substrand: 'Living Things', rubric: 'ME' },
  { id: '2', upi: 'P10B45', student_name: 'Brian Kiprop', grade: 'Grade 7', strand: 'Integrated Science', substrand: 'Living Things', rubric: 'EE' },
  { id: '3', upi: 'Z33L90', student_name: 'Faith Achieng', grade: 'Grade 7', strand: 'Integrated Science', substrand: 'Living Things', rubric: 'AE' },
  { id: '4', upi: 'M55T12', student_name: 'Emmanuel Mutua', grade: 'Grade 7', strand: 'Integrated Science', substrand: 'Living Things', rubric: 'BE' },
];

export const CBCAssessment: React.FC = () => {
  const [assessments, setAssessments] = useState<LearnerAssessment[]>(INITIAL_LEARNERS);

  const handleUpdateRubric = (id: string, newLevel: CBCLevel) => {
    setAssessments((prev) =>
      prev.map((item) => (item.id === id ? { ...item, rubric: newLevel } : item))
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center">
        <div>
          <h2 className="text-base font-bold text-slate-900">Tathmini ya CBC (Competency-Based Curriculum)</h2>
          <p className="text-xs text-slate-500">Miongozo ya MoE/KNEC: EE (Kuzidi Matarajio), ME (Kufikia Matarajio), AE (Kukaribia), BE (Chini ya Matarajio)</p>
        </div>
        <div className="flex gap-2 text-xs">
          {Object.entries(CBC_RUBRIC_CONFIG).map(([key, cfg]) => (
            <span key={key} className={`px-2 py-0.5 rounded font-bold border ${cfg.badgeClass}`}>
              {key}: {cfg.score}/4
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-semibold border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">UPI ya NEMIS</th>
              <th className="px-4 py-3">Jina la Mwanafunzi</th>
              <th className="px-4 py-3">Darasa</th>
              <th className="px-4 py-3">Eneo la Kujifunza (Strand)</th>
              <th className="px-4 py-3">Kipengele (Sub-strand)</th>
              <th className="px-4 py-3">Kiwango cha Umahiri (Rubric Level)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assessments.map((learner) => (
              <tr key={learner.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono font-semibold text-slate-700">{learner.upi}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{learner.student_name}</td>
                <td className="px-4 py-3 text-slate-600">{learner.grade}</td>
                <td className="px-4 py-3 text-slate-600">{learner.strand}</td>
                <td className="px-4 py-3 text-slate-600">{learner.substrand}</td>
                <td className="px-4 py-3">
                  <CBCRubricSelector
                    value={learner.rubric}
                    onChange={(level) => handleUpdateRubric(learner.id, level)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Offline-first CBC rubric engine (IndexedDB -> /assessments/cbc/bulk-sync).
          Mounted here so the feature lives inside the existing routed view. */}
      <CBCRubricAssessment
        tenantId={(() => {
          try { return localStorage.getItem('tenant_id') || 'demo'; } catch { return 'demo'; }
        })()}
        subStrand={{ id: `${assessments[0]?.strand ?? 'General'}_${assessments[0]?.substrand ?? 'Competency'}`, name: `${assessments[0]?.strand ?? 'General'} — ${assessments[0]?.substrand ?? 'Living Things'}` }}
        learners={assessments.map((s) => ({
          id: s.id,
          name: s.student_name,
          admissionNumber: s.upi,
          initialScoreCode: s.rubric || undefined
        }))}
      />
    </div>
  );
};
