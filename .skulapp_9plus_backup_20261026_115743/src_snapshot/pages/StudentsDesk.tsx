import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { StatutoryLearner, exportNEMISBatchCSV } from '../utils/nemisExportEngine';
import { maskPhoneNumber } from '../utils/kenyaFormatters';

const MANDONGOI_REGISTER: StatutoryLearner[] = [
  {
    admission_number: 'ADM-MND-0582',
    surname: 'Kasamba',
    first_name: 'Brian',
    other_names: 'Baraka',
    gender: 'M',
    dob: '2015-04-12',
    birth_cert_no: 'BC-2015-891024',
    nemis_upi: 'BBK521K',
    grade: 'Grade 5',
    father_name: 'Kasamba Kitheka',
    father_id: '24189021',
    mother_name: 'Mary Mwikali Kasamba',
    mother_id: '28901244',
    parent_phone: '0718786067',
    special_needs: 'NONE',
  },
  {
    admission_number: 'ADM-MND-0501',
    surname: 'Kamau',
    first_name: 'Wanjiku',
    other_names: 'Grace',
    gender: 'F',
    dob: '2013-09-21',
    birth_cert_no: 'BC-2013-441092',
    nemis_upi: 'WKG102M',
    grade: 'Grade 7',
    father_name: 'Kamau Njoroge',
    father_id: '21094123',
    mother_name: 'Hannah Wangari',
    mother_id: '24901233',
    parent_phone: '0722112233',
    special_needs: 'NONE',
  },
  {
    admission_number: 'ADM-MND-0589',
    surname: 'Mutua',
    first_name: 'Emmanuel',
    other_names: 'Kyalo',
    gender: 'M',
    dob: '2014-11-05',
    birth_cert_no: 'PENDING_REG',
    nemis_upi: undefined, // UNVERIFIED GAP
    grade: 'Grade 5',
    father_name: 'Mutua Maluki',
    father_id: '18902144',
    mother_name: 'Agnes Syokau',
    mother_id: '22194012',
    parent_phone: '0799887766',
    special_needs: 'NONE',
  },
];

export const StudentsDesk: React.FC = () => {
  const [learners, setLearners] = useState<StatutoryLearner[]>(MANDONGOI_REGISTER);
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [capitationStatusFilter, setCapitationStatusFilter] = useState<'ALL' | 'VERIFIED' | 'AT_RISK'>('ALL');

  // Multi-Vector Search Resolver
  const filteredLearners = useMemo(() => {
    return learners.filter(l => {
      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        l.admission_number.toLowerCase().includes(q) ||
        l.surname.toLowerCase().includes(q) ||
        l.first_name.toLowerCase().includes(q) ||
        (l.other_names && l.other_names.toLowerCase().includes(q)) ||
        (l.nemis_upi && l.nemis_upi.toLowerCase().includes(q)) ||
        l.parent_phone.includes(q) ||
        l.birth_cert_no.toLowerCase().includes(q);

      const matchGrade = gradeFilter ? l.grade === gradeFilter : true;
      const matchCapitation =
        capitationStatusFilter === 'ALL'
          ? true
          : capitationStatusFilter === 'VERIFIED'
          ? !!l.nemis_upi
          : !l.nemis_upi;

      return matchSearch && matchGrade && matchCapitation;
    });
  }, [learners, searchQuery, gradeFilter, capitationStatusFilter]);

  const verifiedCount = learners.filter(l => !!l.nemis_upi).length;
  const atRiskCount = learners.length - verifiedCount;

  return (
    <div className="space-y-4">
      {/* Top Census & Capitation Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            Sajili ya Wanafunzi & Ukaguzi wa NEMIS (National Enrollment Register)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Mandongoi Comprehensive School &bull; Kituo cha Mtihani: <strong>40105102</strong> &bull; Usajili wa MoE: <strong>MoE/PRI/2019/4021</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/learners"
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span className="text-base leading-none">＋</span>
            <span>Sajili Mwanafunzi Mpya (Onboard Learner)</span>
          </Link>
          <button
            onClick={() => exportNEMISBatchCSV(learners)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span>Pakua NEMIS Batch Template (MoE Format)</span>
          </button>
        </div>
      </div>

      {/* Capitation Risk Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-emerald-800 font-semibold">Wanafunzi Wenye NEMIS UPI:</span>
            <div className="text-lg font-black text-emerald-900">{verifiedCount} / {learners.length}</div>
          </div>
          <span className="text-[10px] font-bold bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
            Capitation Imethibitishwa
          </span>
        </div>

        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-amber-800 font-semibold">Pengo la Capitation (At Risk):</span>
            <div className="text-lg font-black text-amber-900">{atRiskCount} Learners</div>
          </div>
          <span className="text-[10px] font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
            Kukosa Ruzuku ya Serikali
          </span>
        </div>

        <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg flex justify-between items-center">
          <div>
            <span className="text-blue-800 font-semibold">Makadirio ya Ruzuku ya FPE/FDSE:</span>
            <div className="text-lg font-black text-blue-900 font-mono">KES {(verifiedCount * 1420).toLocaleString()}</div>
          </div>
          <span className="text-[10px] text-blue-700">Ruzuku ya Muhula 1</span>
        </div>
      </div>

      {/* Multi-Vector Search Controls */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs flex flex-wrap gap-2 items-center justify-between text-xs">
        <div className="flex gap-2 items-center flex-1 min-w-[320px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tafuta kwa: Jina, Nambari ya Simu (0718...), Birth Cert, UPI, au Adm..."
            className="w-full sm:w-96 px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
          >
            <option value="">Madarasa Yote (All Grades)</option>
            <option value="Grade 5">Grade 5</option>
            <option value="Grade 7">Grade 7</option>
            <option value="Grade 8">Grade 8</option>
          </select>
          <select
            value={capitationStatusFilter}
            onChange={(e) => setCapitationStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white"
          >
            <option value="ALL">Hali Zote za Capitation</option>
            <option value="VERIFIED">Wenye UPI Pekee</option>
            <option value="AT_RISK">Wasio na UPI (Pengo)</option>
          </select>
        </div>
      </div>

      {/* Institutional Learner Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 text-slate-800 uppercase font-bold border-b border-slate-200 text-[11px]">
            <tr>
              <th className="p-3">Adm No</th>
              <th className="p-3">Jina la Mwanafunzi</th>
              <th className="p-3">NEMIS UPI / Hali</th>
              <th className="p-3">Cheti cha Kuzaliwa (Birth Cert)</th>
              <th className="p-3">Mzazi & Simu</th>
              <th className="p-3 text-center">Hali ya Capitation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredLearners.length > 0 ? (
              filteredLearners.map((learner) => (
                <tr key={learner.admission_number} className="hover:bg-slate-50 transition-colors">
                  <td className="p-3 font-mono font-bold text-slate-900">{learner.admission_number}</td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">
                      {learner.surname}, {learner.first_name} {learner.other_names || ''}
                    </div>
                    <div className="text-[10px] text-slate-500">{learner.grade} &bull; Jinsia: {learner.gender}</div>
                  </td>
                  <td className="p-3">
                    {learner.nemis_upi ? (
                      <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                        {learner.nemis_upi}
                      </span>
                    ) : (
                      <span className="font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                        BILA UPI (PENGO)
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-mono text-slate-600">{learner.birth_cert_no}</td>
                  <td className="p-3">
                    <div>{learner.father_name}</div>
                    <div className="font-mono text-slate-500 text-[10px]">{maskPhoneNumber(learner.parent_phone)}</div>
                  </td>
                  <td className="p-3 text-center">
                    {learner.nemis_upi ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold text-[10px]">
                        Inalipiwa na Serikali
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full font-bold text-[10px]">
                        Ruzuku Imesimamishwa
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-8 text-slate-400">
                  Hakuna mwanafunzi aliyepatikana kwa kigezo hicho.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
