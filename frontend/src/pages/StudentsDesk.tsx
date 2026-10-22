import React, { useState } from 'react';
import { EnterpriseDataTable, Column } from '../components/EnterpriseDataTable';
import { KenyaValidators } from '../utils/kenyaValidators';
import { maskPhoneNumber } from '../utils/kenyaFormatters';

interface StudentProfile {
  admission_number: string;
  nemis_upi: string;
  full_name: string;
  grade: string;
  guardian_phone: string;
  knec_number: string;
}

const INITIAL_STUDENTS: StudentProfile[] = [
  { admission_number: 'ADM-4102', nemis_upi: 'K89J21', full_name: 'Wanjiku Kamau', grade: 'Grade 7', guardian_phone: '0712345678', knec_number: '40100101-001' },
  { admission_number: 'ADM-4109', nemis_upi: 'P10B45', full_name: 'Brian Kiprop', grade: 'Grade 8', guardian_phone: '0722334455', knec_number: '40100101-002' },
  { admission_number: 'ADM-4115', nemis_upi: 'Z33L90', full_name: 'Faith Achieng', grade: 'Grade 7', guardian_phone: '0733445566', knec_number: '40100101-003' },
  { admission_number: 'ADM-4120', nemis_upi: 'M55T12', full_name: 'Emmanuel Mutua', grade: 'Grade 9', guardian_phone: '0799887766', knec_number: '40100101-004' },
];

export const StudentsDesk: React.FC = () => {
  const [students, setStudents] = useState<StudentProfile[]>(INITIAL_STUDENTS);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({
    admission_number: '',
    nemis_upi: '',
    full_name: '',
    grade: 'Grade 7',
    guardian_phone: '',
    knec_number: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!KenyaValidators.nemisUPI(formData.nemis_upi)) {
      setValidationError('Nambari ya NEMIS UPI lazima iwe herufi au nambari 6 hadi 10 (Mfano: K89J21).');
      return;
    }
    if (!KenyaValidators.kenyanPhone(formData.guardian_phone)) {
      setValidationError('Nambari ya simu ya mzazi sio sahihi. Tumia fomati ya Kenya: 07XX... au 01XX...');
      return;
    }
    setStudents([...students, { ...formData, guardian_phone: KenyaValidators.normalizePhone(formData.guardian_phone) }]);
    setIsFormOpen(false);
    setValidationError(null);
    setFormData({ admission_number: '', nemis_upi: '', full_name: '', grade: 'Grade 7', guardian_phone: '', knec_number: '' });
  };

  const columns: Column<StudentProfile>[] = [
    { key: 'admission_number', header: 'Nambari ya Usajili' },
    {
      key: 'nemis_upi',
      header: 'NEMIS UPI',
      render: (r) => <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">{r.nemis_upi}</span>,
    },
    { key: 'full_name', header: 'Jina Kamili la Mwanafunzi' },
    { key: 'grade', header: 'Darasa' },
    {
      key: 'guardian_phone',
      header: 'Simu ya Mzazi (KDPA Masked)',
      render: (r) => <span className="font-mono text-slate-600">{maskPhoneNumber(r.guardian_phone)}</span>,
    },
    { key: 'knec_number', header: 'Nambari ya KNEC' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Sajili ya Wanafunzi & NEMIS UPI</h2>
          <p className="text-xs text-slate-500">Usimamizi wa Vitambulisho Rasmi vya Wizara ya Elimu (MoE) & KDPA 2019</p>
        </div>
        <button
          onClick={() => setIsFormOpen(true)}
          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-sm"
        >
          + Sajili Mwanafunzi Mpya
        </button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleRegister} className="bg-white p-4 rounded-lg border border-emerald-200 shadow space-y-3">
          <h3 className="text-xs font-bold text-slate-800 uppercase">Fomu ya Usajili wa Mwanafunzi (MoE NEMIS)</h3>
          {validationError && (
            <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded">{validationError}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-600 mb-1">Nambari ya Usajili (Adm No)</label>
              <input
                required
                value={formData.admission_number}
                onChange={(e) => setFormData({ ...formData, admission_number: e.target.value })}
                placeholder="ADM-4125"
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">NEMIS UPI</label>
              <input
                required
                value={formData.nemis_upi}
                onChange={(e) => setFormData({ ...formData, nemis_upi: e.target.value.toUpperCase() })}
                placeholder="K89J21"
                className="w-full p-2 border rounded uppercase font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Jina Kamili</label>
              <input
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="Jina la Kwanza na Pili"
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Simu ya Mzazi (Safaricom/Airtel)</label>
              <input
                required
                value={formData.guardian_phone}
                onChange={(e) => setFormData({ ...formData, guardian_phone: e.target.value })}
                placeholder="0712345678"
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">KNEC Assessment No.</label>
              <input
                value={formData.knec_number}
                onChange={(e) => setFormData({ ...formData, knec_number: e.target.value })}
                placeholder="40100101-005"
                className="w-full p-2 border rounded font-mono"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">Darasa</label>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                className="w-full p-2 border rounded bg-white"
              >
                <option value="Grade 7">Grade 7</option>
                <option value="Grade 8">Grade 8</option>
                <option value="Grade 9">Grade 9</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
            >
              Ghairi
            </button>
            <button type="submit" className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded">
              Hifadhi (Submit)
            </button>
          </div>
        </form>
      )}

      <EnterpriseDataTable data={students} columns={columns} filenameExport="Orodha_Wanafunzi_NEMIS.csv" />
    </div>
  );
};
