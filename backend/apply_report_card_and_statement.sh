#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Working from: $(pwd)"

echo "📄 [1/3] Creating Printable CBC Progress Report Card..."
mkdir -p frontend/src/views

cat << 'JSX_EOF' > frontend/src/views/ReportCardView.jsx
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
JSX_EOF

echo "💳 [2/3] Creating Printable Fee Statement & Receipt View..."

cat << 'JSX_EOF' > frontend/src/views/FeeStatementView.jsx
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
JSX_EOF

echo "🌐 [3/3] Updating AppShell navigation and App.jsx tabs..."

cat << 'JSX_EOF' > frontend/src/layouts/AppShell.jsx
import React, { useState } from 'react';

export default function AppShell({ activeTab, onTabChange, user, onLogout, children }) {
  const [isOnline] = useState(navigator.onLine);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800">
      <header className="bg-white border-b sticky top-0 z-50 print:hidden">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-lg shadow-sm">
              K
            </div>
            <div>
              <h1 className="font-bold text-sm sm:text-base leading-tight">Hillcrest Academy (Demo)</h1>
              <p className="text-xs text-gray-400">Muhula wa 1, 2026 (Term 1) • CBC Active</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`hidden sm:inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${isOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {isOnline ? '● Mtandaoni' : '○ Nje ya Mtandao'}
            </span>

            {user && (
              <div className="flex items-center gap-2 border-l pl-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold leading-tight">{user.first_name} {user.last_name}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">{user.role}</p>
                </div>
                <button
                  onClick={onLogout}
                  className="bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-600 text-xs font-semibold py-1.5 px-3 rounded-lg border transition"
                >
                  Toka (Logout)
                </button>
              </div>
            )}
          </div>
        </div>

        <nav className="max-w-6xl mx-auto px-4 flex gap-1 sm:gap-4 overflow-x-auto border-t">
          {[
            { id: 'students', label: 'Wanafunzi (Admission)' },
            { id: 'attendance', label: 'Mahudhurio (Attendance)' },
            { id: 'cbc', label: 'Tathmini ya CBC (Rubrics)' },
            { id: 'report_card', label: 'Ripoti ya Matokeo (Report Card)' },
            { id: 'fees', label: 'Lipa Ada (M-Pesa)' },
            { id: 'statement', label: 'Taarifa ya Ada (Statement)' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 whitespace-nowrap transition ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 print:p-0 print:m-0">
        {children}
      </main>
    </div>
  );
}
JSX_EOF

cat << 'JSX_EOF' > frontend/src/App.jsx
import React, { useState } from 'react';
import AppShell from './layouts/AppShell';
import LoginForm from './views/LoginForm';
import AdmissionForm from './views/AdmissionForm';
import DailyAttendance from './views/DailyAttendance';
import AssessmentMatrix from './components/AssessmentMatrix';
import FeeCashiering from './views/FeeCashiering';
import ReportCardView from './views/ReportCardView';
import FeeStatementView from './views/FeeStatementView';

export default function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('shule_session');
    return saved ? JSON.parse(saved) : null;
  });

  const [activeTab, setActiveTab] = useState('attendance');

  const handleLoginSuccess = (sessionData) => {
    localStorage.setItem('shule_session', JSON.stringify(sessionData));
    setSession(sessionData);
  };

  const handleLogout = () => {
    localStorage.removeItem('shule_session');
    setSession(null);
  };

  if (!session) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  const sampleStudents = [
    { id: '11111111-1111-1111-1111-111111111111', first_name: 'Juma', last_name: 'Omondi', admission_number: 'ADM-001', upi_nemis: 'UPI789123' },
    { id: '22222222-2222-2222-2222-222222222222', first_name: 'Achieng', last_name: 'Nekesa', admission_number: 'ADM-002', upi_nemis: 'UPI456789' },
    { id: '33333333-3333-3333-3333-333333333333', first_name: 'Mwangi', last_name: 'Kamau', admission_number: 'ADM-003', upi_nemis: 'UPI123456' },
  ];

  const sampleStrand = {
    id: 'strand-sample-uuid',
    title: 'Hesabu: Sehemu na Desimali (Fractions & Decimals)',
  };

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab} user={session.user} onLogout={handleLogout}>
      {activeTab === 'students' && <AdmissionForm tenantID={session.user.tenant_id} />}
      {activeTab === 'attendance' && <DailyAttendance tenantID={session.user.tenant_id} />}
      {activeTab === 'cbc' && <AssessmentMatrix students={sampleStudents} strand={sampleStrand} tenantID={session.user.tenant_id} />}
      {activeTab === 'report_card' && <ReportCardView />}
      {activeTab === 'fees' && <FeeCashiering tenantID={session.user.tenant_id} />}
      {activeTab === 'statement' && <FeeStatementView />}
    </AppShell>
  );
}
JSX_EOF

echo "🚀 Committing and Pushing Printable Modules to GitHub..."
git add .
git commit -m "feat(reporting): add printable CBC progress report card and bursar fee statement views"
git push origin main || git push origin master

rm -f apply_report_card_and_statement.sh
echo "✅ Printable Report Card and Fee Statement views pushed to GitHub!"
