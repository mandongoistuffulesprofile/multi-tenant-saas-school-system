import React, { useState } from 'react';

export const BoardPack: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);

  const load = async () => {
    const res = await fetch('/api/v1/value-ledger/metrics');
    setMetrics(await res.json());
  };

  const print = () => window.print();

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Board Pack</h2>
      <button onClick={load} className="px-3 py-1 bg-blue-600 text-white rounded mr-2">Load Metrics</button>
      <button onClick={print} className="px-3 py-1 bg-gray-600 text-white rounded">Print / Save PDF</button>
      {metrics && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div>Revenue: {metrics.total_revenue}</div>
          <div>Expenses: {metrics.total_expenses}</div>
          <div>Net: {metrics.net_position}</div>
          <div>Outstanding: {metrics.outstanding_fees}</div>
          <div>Inventory: {metrics.inventory_value}</div>
          <div>Students: {metrics.student_count}</div>
        </div>
      )}
    </div>
  );
};
