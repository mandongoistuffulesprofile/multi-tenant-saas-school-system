import React, { useState, useEffect } from 'react';

interface StudentRow {
  admissionNumber: string;
  studentName: string;
  math: string;
  english: string;
  kiswahili: string;
}

export const BroadsheetGrid: React.FC<{ classId: string }> = ({ classId }) => {
  const [rows, setRows] = useState<StudentRow[]>([
    { admissionNumber: '1042', studentName: 'J. Njoroge', math: '78', english: 'ME1', kiswahili: 'EE2' },
    { admissionNumber: '1043', studentName: 'A. Otieno', math: '82', english: 'EE1', kiswahili: 'ME2' },
  ]);

  useEffect(() => {
    const savedDraft = sessionStorage.getItem(`draft_broadsheet_${classId}`);
    if (savedDraft) {
      try { setRows(JSON.parse(savedDraft)); } catch (e) { console.error(e); }
    }
  }, [classId]);

  const handleChange = (index: number, field: keyof StudentRow, value: string) => {
    const updated = [...rows];
    updated[index][field] = value;
    setRows(updated);
    sessionStorage.setItem(`draft_broadsheet_${classId}`, JSON.stringify(updated));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextRowInput = document.getElementById(`row-${rowIndex + 1}-col-${colIndex}`);
      if (nextRowInput) nextRowInput.focus();
    }
  };

  return (
    <div className="p-4 bg-white shadow rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-slate-800">Broadsheet Data Desk: {classId}</h2>
        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-medium">
          DRAFT AUTO-SAVED LOCALLY
        </span>
      </div>
      <table className="w-full border-collapse border border-slate-300 text-sm">
        <thead>
          <tr className="bg-slate-100 text-slate-700">
            <th className="border p-2 text-left">Adm & Name</th>
            <th className="border p-2">Mathematics</th>
            <th className="border p-2">English</th>
            <th className="border p-2">Kiswahili</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={row.admissionNumber} className="hover:bg-slate-50">
              <td className="border p-2 font-medium">{row.admissionNumber} - {row.studentName}</td>
              {(['math', 'english', 'kiswahili'] as const).map((field, cIdx) => (
                <td key={field} className="border p-1">
                  <input
                    id={`row-${rIdx}-col-${cIdx}`}
                    type="text"
                    value={row[field]}
                    onChange={(e) => handleChange(rIdx, field, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, cIdx)}
                    className="w-full p-1 border rounded focus:ring-2 focus:ring-blue-500 text-center uppercase"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
