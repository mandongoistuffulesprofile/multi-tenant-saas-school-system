import React, { useState, useEffect, useRef } from 'react';

interface StudentRow {
  admissionNumber: string;
  studentName: string;
  math: string;
  english: string;
  kiswahili: string;
}

const FIELDS = ['math', 'english', 'kiswahili'] as const;
const isInvalid = (v: string) => {
  const n = Number(v);
  return v !== '' && (isNaN(n) || n < 0 || n > 100);
};

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

  const focusCell = (r: number, c: number) => {
    const el = document.getElementById(`row-${r}-col-${c}`) as HTMLInputElement | null;
    if (el) el.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusCell(rowIndex + 1, colIndex);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const nextCol = colIndex + 1;
      if (nextCol < FIELDS.length) focusCell(rowIndex, nextCol);
      else focusCell(rowIndex + 1, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusCell(rowIndex + 1, colIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusCell(rowIndex - 1, colIndex);
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
              {FIELDS.map((field, cIdx) => (
                <td key={field} className="border p-1">
                  <input
                    id={`row-${rIdx}-col-${cIdx}`}
                    type="text"
                    value={row[field]}
                    onChange={(e) => handleChange(rIdx, field, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, cIdx)}
                    className={`w-full p-1 border rounded focus:ring-2 text-center uppercase ${
                      isInvalid(row[field]) ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'focus:ring-blue-500'
                    }`}
                    aria-invalid={isInvalid(row[field])}
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
