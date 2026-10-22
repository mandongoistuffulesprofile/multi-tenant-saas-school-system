import React from 'react';

export default function ReportCardView({
  student = {
    name: 'Juma Omondi',
    admission: 'ADM-001',
    upi: 'UPI789123',
    grade: 'Grade 3 East',
    term: 'Term 1, 2026',
  },
  evaluations = [
    { area: 'Mathematics Activities', strand: 'Numbers (Addition & Subtraction)', rating: 'EE', comments: 'Demonstrates outstanding mastery of number concepts.' },
    { area: 'Mathematics Activities', strand: 'Measurement (Length & Mass)', rating: 'ME', comments: 'Accurately estimates and measures using standard units.' },
    { area: 'English Language', strand: 'Listening & Speaking', rating: 'ME', comments: 'Expresses ideas clearly and listens attentively.' },
    { area: 'English Language', strand: 'Reading Comprehension', rating: 'EE', comments: 'Reads grade-level texts with high fluency and comprehension.' },
    { area: 'Kiswahili Shughuli za Lugha', strand: 'Kusikiliza na Kuzungumza', rating: 'ME', comments: 'Anatumia lugha ya heshima na kujieleza vyema.' },
    { area: 'Kiswahili Shughuli za Lugha', strand: 'Kusoma kwa Ufahamu', rating: 'AE', comments: 'Anahitaji mazoezi zaidi ya kusoma hadithi fupi.' },
    { area: 'Environmental Activities', strand: 'Cleanliness & Hygiene', rating: 'EE', comments: 'Consistently demonstrates personal and classroom cleanliness.' },
  ],
}) {
  const getRatingBadge = (rating) => {
    switch (rating) {
      case 'EE': return 'bg-emerald-100 text-emerald-800 font-bold border-emerald-300';
      case 'ME': return 'bg-blue-100 text-blue-800 font-bold border-blue-300';
      case 'AE': return 'bg-amber-100 text-amber-800 font-bold border-amber-300';
      case 'BE': return 'bg-rose-100 text-rose-800 font-bold border-rose-300';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8 bg-white border rounded-2xl shadow-sm print:border-none print:shadow-none print:p-0 font-sans">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Hakiki Ripoti ya Matokeo (Report Card Preview)</h2>
          <p className="text-xs text-gray-500">Imebuniwa kulingana na muundo rasmi wa KICD / KNEC</p>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow-sm flex items-center gap-2 text-sm"
        >
          🖨️ Chapisha Ripoti (Print / Save PDF)
        </button>
      </div>

      {/* Printable Report Document Body */}
      <div className="border-2 border-gray-800 p-6 rounded-lg">
        {/* Header */}
        <div className="text-center border-b-2 border-gray-800 pb-4 mb-4">
          <h1 className="text-2xl font-black uppercase tracking-wider text-gray-900">Hillcrest Academy</h1>
          <p className="text-xs text-gray-600 font-medium">P.O. BOX 1042 - 00100, NAIROBI • SIMU: +254 712 345 678</p>
          <p className="text-xs text-gray-500 font-semibold uppercase mt-0.5">MOE/KNEC Code: HA-2026 • Kikoa: demo.schools.ke</p>
          <div className="mt-3 py-1 bg-gray-100 border border-gray-300 rounded font-bold text-sm tracking-wide uppercase">
            Ripoti ya Maendeleo ya Mwanafunzi (CBC Learner Progress Report)
          </div>
        </div>

        {/* Student Biodata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4 bg-gray-50 p-3 rounded border">
          <div><span className="font-bold text-gray-500">Jina la Mwanafunzi:</span> <p className="font-bold text-sm text-gray-900">{student.name}</p></div>
          <div><span className="font-bold text-gray-500">Nambari ya Usajili (Adm):</span> <p className="font-bold text-sm text-gray-900">{student.admission}</p></div>
          <div><span className="font-bold text-gray-500">NEMIS UPI:</span> <p className="font-bold text-sm text-gray-900">{student.upi}</p></div>
          <div><span className="font-bold text-gray-500">Darasa na Muhula:</span> <p className="font-bold text-sm text-gray-900">{student.grade} - {student.term}</p></div>
        </div>

        {/* Rubrics Explanation */}
        <div className="grid grid-cols-4 gap-2 text-[10px] text-center mb-4 p-2 border rounded bg-slate-50 font-medium">
          <div className="border rounded p-1 bg-emerald-50 border-emerald-200"><strong>EE (4):</strong> Exceeding Expectations (Kuzidisha)</div>
          <div className="border rounded p-1 bg-blue-50 border-blue-200"><strong>ME (3):</strong> Meeting Expectations (Kufikia)</div>
          <div className="border rounded p-1 bg-amber-50 border-amber-200"><strong>AE (2):</strong> Approaching Expectations (Kukaribia)</div>
          <div className="border rounded p-1 bg-rose-50 border-rose-200"><strong>BE (1):</strong> Below Expectations (Mbali)</div>
        </div>

        {/* Assessment Matrix Table */}
        <table className="w-full text-left text-xs border-collapse mb-6">
          <thead>
            <tr className="bg-gray-800 text-white font-bold">
              <th className="p-2 border border-gray-800">Eneo la Kujifunza (Learning Area)</th>
              <th className="p-2 border border-gray-800">Mada / Nyanja (Strand)</th>
              <th className="p-2 border border-gray-800 text-center w-20">Kiwango (Rating)</th>
              <th className="p-2 border border-gray-800">Maoni ya Mwalimu (Teacher Remarks)</th>
            </tr>
          </thead>
          <tbody>
            {evaluations.map((ev, idx) => (
              <tr key={idx} className="border-b border-gray-300 hover:bg-gray-50">
                <td className="p-2 border font-bold text-gray-800">{ev.area}</td>
                <td className="p-2 border">{ev.strand}</td>
                <td className="p-2 border text-center">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs border ${getRatingBadge(ev.rating)}`}>
                    {ev.rating}
                  </span>
                </td>
                <td className="p-2 border text-gray-600 italic text-[11px]">{ev.comments}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Signatures & School Stamp Block */}
        <div className="grid grid-cols-3 gap-4 pt-4 border-t-2 border-gray-800 text-xs mt-6">
          <div className="border-t border-dashed border-gray-400 pt-2 text-center">
            <p className="font-bold">Mwalimu wa Darasa (Class Teacher)</p>
            <p className="text-[10px] text-gray-400 mt-6">Sahihi na Tarehe: _______________</p>
          </div>
          <div className="border-2 border-dashed border-gray-300 rounded p-2 text-center flex items-center justify-center text-gray-400 font-bold text-[10px]">
            MUHURI WA SHULE<br />(OFFICIAL SCHOOL STAMP)
          </div>
          <div className="border-t border-dashed border-gray-400 pt-2 text-center">
            <p className="font-bold">Mwalimu Mkuu (Head Teacher)</p>
            <p className="text-[10px] text-gray-400 mt-6">Sahihi na Tarehe: _______________</p>
          </div>
        </div>
      </div>
    </div>
  );
}
