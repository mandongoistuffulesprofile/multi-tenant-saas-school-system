import React, { useState } from 'react';

export default function FeeCashiering({ tenantID = 'default' }) {
  const [phone, setPhone] = useState('2547');
  const [amount, setAmount] = useState('5000');
  const [studentAdm, setStudentAdm] = useState('ADM-001');
  const [status, setStatus] = useState(null);

  const handleSTKPush = async (e) => {
    e.preventDefault();
    setStatus({ type: 'loading', text: 'Inatuma arifa ya M-Pesa STK kwa simu ya mzazi...' });

    setTimeout(() => {
      setStatus({
        type: 'success',
        text: `Arifa ya Lipa na M-Pesa (KES ${amount}) imetumwa kwa ${phone}. Subiri uthibitisho kutoka kwa Safaricom.`,
      });
    }, 1200);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold">
          KES
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-800">Ulipaji wa Ada (Fee Collection & M-Pesa)</h2>
          <p className="text-sm text-gray-500">Safaricom Daraja STK Push & Cashiering</p>
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-xl mb-6 border">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-semibold text-gray-500">Mwanafunzi (Learner)</span>
          <span className="text-sm font-bold text-gray-800">Juma Omondi (ADM-001)</span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-semibold text-gray-500">Baki la Ada (Balance Due)</span>
          <span className="text-sm font-bold text-rose-600">KES 12,500.00</span>
        </div>
      </div>

      <form onSubmit={handleSTKPush} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Nambari ya M-Pesa ya Mzazi (Safaricom)</label>
          <input
            required
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
            placeholder="254712345678"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Kiasi cha Kulipa (Amount KES)</label>
          <input
            required
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm font-semibold"
          />
        </div>

        {status && (
          <div className={`p-3 rounded-lg text-sm ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
            {status.text}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition shadow-sm"
        >
          📱 Tuma Ombi la M-Pesa (Trigger STK Push)
        </button>
      </form>
    </div>
  );
}
