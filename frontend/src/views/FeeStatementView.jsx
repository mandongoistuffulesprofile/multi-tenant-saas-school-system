import React from 'react';

export default function FeeStatementView({
  student = {
    name: 'Juma Omondi',
    admission: 'ADM-001',
    grade: 'Grade 3 East',
    parent: 'Mary Wanjiku (+254712345678)',
  },
  invoices = [
    { title: 'Ada ya Masomo (Tuition Fee) - Term 1, 2026', amount: 10000 },
    { title: 'Chakula cha Mchana (Feeding/Lunch Program)', amount: 4500 },
    { title: 'Shughuli za Ziada (Activity & Sports Fee)', amount: 1500 },
  ],
  payments = [
    { transId: 'RKA789123Q', date: '2026-01-10', method: 'M-PESA', amount: 10000 },
    { transId: 'RKB456789W', date: '2026-02-05', method: 'M-PESA', amount: 3500 },
  ],
}) {
  const totalBilled = invoices.reduce((sum, item) => sum + item.amount, 0);
  const totalPaid = payments.reduce((sum, item) => sum + item.amount, 0);
  const balanceDue = totalBilled - totalPaid;

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8 bg-white border rounded-2xl shadow-sm print:border-none print:shadow-none print:p-0 font-sans">
      <div className="flex justify-between items-center mb-6 print:hidden">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Taarifa ya Ada (Fee Statement Preview)</h2>
          <p className="text-xs text-gray-500">Leja rasmi ya fedha na stakabadhi za M-Pesa</p>
        </div>
        <button
          onClick={() => window.print()}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl shadow-sm text-sm"
        >
          🖨️ Chapisha Leja (Print Statement)
        </button>
      </div>

      <div className="border border-gray-800 p-6 rounded-lg">
        {/* School Header */}
        <div className="border-b-2 border-gray-800 pb-3 mb-4 text-center">
          <h1 className="text-2xl font-black uppercase text-gray-900">Hillcrest Academy</h1>
          <p className="text-xs text-gray-600 font-medium">OFISI YA MHASIBU WA SHULE (BURSAR'S OFFICE) • NAIROBI</p>
          <div className="mt-2 py-1 bg-gray-100 border rounded font-bold text-xs uppercase">
            Taarifa Rasmi ya Ada za Shule (Official Student Fee Statement)
          </div>
        </div>

        {/* Student & Guardian Info */}
        <div className="grid grid-cols-2 text-xs mb-4 p-3 bg-gray-50 rounded border">
          <div>
            <p><strong className="text-gray-500">Mwanafunzi:</strong> {student.name} ({student.admission})</p>
            <p><strong className="text-gray-500">Darasa:</strong> {student.grade}</p>
          </div>
          <div className="text-right">
            <p><strong className="text-gray-500">Mzazi/Mlezi:</strong> {student.parent}</p>
            <p><strong className="text-gray-500">Tarehe ya Kutoa:</strong> {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        {/* Invoiced Vote Heads */}
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">1. Ada Zilizotozwa (Invoiced Vote Heads)</h3>
        <table className="w-full text-xs border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="p-2 text-left">Maelezo (Description)</th>
              <th className="p-2 text-right">Kiasi (KES)</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="p-2">{inv.title}</td>
                <td className="p-2 text-right font-mono font-medium">{inv.amount.toLocaleString()}.00</td>
              </tr>
            ))}
            <tr className="font-bold bg-gray-50">
              <td className="p-2">Jumla ya Ada (Total Invoiced):</td>
              <td className="p-2 text-right font-mono">KES {totalBilled.toLocaleString()}.00</td>
            </tr>
          </tbody>
        </table>

        {/* Payments Made */}
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">2. Malipo Yaliyopokelewa (Payments & Receipts)</h3>
        <table className="w-full text-xs border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="p-2 text-left">Tarehe</th>
              <th className="p-2 text-left">Nambari ya M-Pesa (TransID)</th>
              <th className="p-2 text-left">Njia</th>
              <th className="p-2 text-right">Kiasi (KES)</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="p-2">{p.date}</td>
                <td className="p-2 font-mono font-bold text-blue-700">{p.transId}</td>
                <td className="p-2">{p.method}</td>
                <td className="p-2 text-right font-mono text-emerald-700 font-bold">{p.amount.toLocaleString()}.00</td>
              </tr>
            ))}
            <tr className="font-bold bg-gray-50">
              <td colSpan="3" className="p-2">Jumla Iliyolipwa (Total Paid):</td>
              <td className="p-2 text-right font-mono text-emerald-700">KES {totalPaid.toLocaleString()}.00</td>
            </tr>
          </tbody>
        </table>

        {/* Balance Due Banner */}
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-lg flex justify-between items-center text-sm font-bold text-rose-900 mb-6">
          <span>Baki Linalodaiwa (Current Outstanding Arrears):</span>
          <span className="font-mono text-base">KES {balanceDue.toLocaleString()}.00</span>
        </div>

        {/* Bursar Stamp Footer */}
        <div className="flex justify-between items-end pt-4 border-t text-xs">
          <div>
            <p className="font-bold">Mhasibu wa Shule: James Mwita</p>
            <p className="text-gray-400 text-[10px]">Imetolewa kiotomatiki kupitia Mfumo wa Shule Yetu SaaS</p>
          </div>
          <div className="border border-dashed border-gray-400 p-2 text-center text-[10px] text-gray-400 font-bold w-40">
            STAHIKI YA MHASIBU<br />(BURSAR SIGN & STAMP)
          </div>
        </div>
      </div>
    </div>
  );
}
