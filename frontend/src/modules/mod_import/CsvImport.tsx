import React, { useState } from 'react';

export const CsvImport: React.FC<{ endpoint: string }> = ({ endpoint }) => {
  const [rows, setRows] = useState<string[][]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = text.split('\n').map((l) => l.split(',').map((c) => c.trim()));
      setRows(parsed);
      setErrors([]);
      setStatus(`Parsed ${parsed.length} rows`);
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    setStatus('Uploading...');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('Import complete');
    } catch (err: any) {
      setStatus('Failed: ' + err.message);
    }
  };

  return (
    <div className="p-4">
      <input type="file" accept=".csv" onChange={handleFile} />
      <button onClick={submit} className="ml-2 px-4 py-2 bg-blue-600 text-white rounded" disabled={!rows.length}>
        Import
      </button>
      <p className="mt-2 text-sm text-gray-600">{status}</p>
      {errors.length > 0 && (
        <ul className="mt-2 text-red-600 text-sm">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <table className="mt-4 border text-sm">
          <tbody>
            {rows.slice(0, 5).map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className="border px-2">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
