import React, { useState, useEffect } from 'react';

export const AdminConfig: React.FC = () => {
  const [rates, setRates] = useState<any[]>([]);
  const [newRate, setNewRate] = useState({ item_type: '', unit: '', rate_per_unit: 0 });

  useEffect(() => {
    fetch('/api/v1/inkind/rates').then((r) => r.json()).then(setRates).catch(() => {});
  }, []);

  const addRate = async () => {
    await fetch('/api/v1/inkind/rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRate),
    });
    const res = await fetch('/api/v1/inkind/rates');
    setRates(await res.json());
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Admin Configuration</h2>
      <div className="mb-6">
        <h3 className="font-semibold mb-2">In-Kind Rates</h3>
        <div className="flex gap-2 mb-2">
          <input placeholder="Item type" value={newRate.item_type} onChange={(e) => setNewRate({ ...newRate, item_type: e.target.value })} className="border px-2" />
          <input placeholder="Unit" value={newRate.unit} onChange={(e) => setNewRate({ ...newRate, unit: e.target.value })} className="border px-2" />
          <input type="number" placeholder="Rate" value={newRate.rate_per_unit} onChange={(e) => setNewRate({ ...newRate, rate_per_unit: Number(e.target.value) })} className="border px-2" />
          <button onClick={addRate} className="px-3 py-1 bg-green-600 text-white rounded">Add</button>
        </div>
        <ul>
          {rates.map((r: any) => (
            <li key={r.id} className="text-sm">{r.item_type} — {r.rate_per_unit}/{r.unit}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
