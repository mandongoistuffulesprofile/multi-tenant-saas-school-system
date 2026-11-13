import React, { useState, useEffect } from 'react';
import { StatusIndicator } from '../components/StatusIndicator';

interface StudentRow {
  admissionNumber: string;
  studentName: string;
  math: string;
  english: string;
  kiswahili: string;
}

const FIELDS = ['math', 'english', 'kiswahili'] as const;

const isInvalid = (v: string) => {
  if (v === '') return false;
  const n = Number(v);
  return Number.isNaN(n) || n < 0 || n > 100;
};

const invalidMessage = (v: string) => {
  if (v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return 'Enter a number';
  if (n < 0) return 'Mark cannot be negative';
  if (n > 100) return 'Mark cannot be above 100';
  return '';
};

export const BroadsheetGrid: React.FC<{ classId: string }> = ({ classId }) => {
  const [rows, setRows] = useState<StudentRow[]>([
    { admissionNumber: '1042', studentName: 'J. Njoroge', math: '78', english: 'ME1', kiswahili: 'EE2' },
    { admissionNumber: '1043', studentName: 'A. Otieno', math: '82', english: 'EE1', kiswahili: 'ME2' },
  ]);
  const [dirty, setIsDirty] = useState(false);

  useEffect(() => {
    const savedDraft = sessionStorage.getItem(`draft_broadsheet_${classId}`);
    const savedDirty = sessionStorage.getItem(`draft_broadsheet_${classId}_dirty`);
    if (savedDraft) {
      try { setRows(JSON.parse(savedDraft)); } catch (e) { console.error(e); }
    }
    if (savedDirty === 'true') setIsDirty(true);
  }, [classId]);

  const handleChange = (index: number, field: keyof StudentRow, value: string) => {
    const updated = [...rows];
    updated[index][field] = value;
    setRows(updated);
    sessionStorage.setItem(`draft_broadsheet_${classId}`, JSON.stringify(updated));
    sessionStorage.setItem(`draft_broadsheet_${classId}_dirty`, 'true');
    setIsDirty(true);
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
        <StatusIndicator
          label={dirty ? "Broadsheet draft has unsaved changes" : "Broadsheet draft auto-saved locally"}
          status={dirty ? "idle" : "saved"}
        />
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
              {FIELDS.map((field, cIdx) => {
                const value = row[field];
                const invalid = isInvalid(value);
                const message = invalid ? invalidMessage(value) : '';
                return (
                  <td key={field} className="border p-1">
                    <label className="sr-only" htmlFor={`row-${rIdx}-col-${cIdx}`}>
                      {field.charAt(0).toUpperCase() + field.slice(1)}
                    </label>
                    <input
                      id={`row-${rIdx}-col-${cIdx}`}
                      type="text"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => handleChange(rIdx, field, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, rIdx, cIdx)}
                      className={`w-full p-1 border rounded focus:ring-2 text-center uppercase ${
                        invalid ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'focus:ring-blue-500'
                      }`}
                      aria-invalid={invalid}
                      aria-describedby={invalid ? `row-${rIdx}-col-${cIdx}-error` : undefined}
                    />
                    {invalid && (
                      <span id={`row-${rIdx}-col-${cIdx}-error`} className="block text-[11px] text-red-700 mt-0.5" role="alert">
                        {message}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
