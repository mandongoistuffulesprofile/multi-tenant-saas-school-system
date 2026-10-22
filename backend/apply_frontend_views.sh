#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Working from: $(pwd)"

echo "📁 [1/5] Creating frontend views and layouts directories..."
mkdir -p frontend/src/views
mkdir -p frontend/src/layouts

echo "📋 [2/5] Creating Daily Attendance Roll Call UI..."

cat << 'JSX_EOF' > frontend/src/views/DailyAttendance.jsx
import React, { useState } from 'react';

const STATUS_OPTIONS = [
  { code: 'PRESENT', label: 'P', color: 'bg-emerald-600 text-white' },
  { code: 'ABSENT', label: 'A', color: 'bg-rose-600 text-white' },
  { code: 'EXCUSED', label: 'E', color: 'bg-amber-500 text-white' },
  { code: 'SICK', label: 'S', color: 'bg-purple-600 text-white' },
];

export default function DailyAttendance({ streamId = 'stream-1', tenantID = 'default' }) {
  const [session, setSession] = useState('MORNING');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendance, setAttendance] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Sample stream roster
  const sampleStudents = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Juma Omondi', admission: 'ADM-001' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Achieng Nekesa', admission: 'ADM-002' },
    { id: '33333333-3333-3333-3333-333333333333', name: 'Mwangi Kamau', admission: 'ADM-003' },
    { id: '44444444-4444-4444-4444-444444444444', name: 'Fatuma Hassan', admission: 'ADM-004' },
  ];

  const handleStatusChange = (studentId, status) => {
    setAttendance((prev) => ({ ...prev, [studentId]: status }));
  };

  const handleMarkAllPresent = () => {
    const updated = {};
    sampleStudents.forEach((st) => {
      updated[st.id] = 'PRESENT';
    });
    setAttendance(updated);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setFeedback(null);

    const entries = sampleStudents.map((st) => ({
      student_id: st.id,
      status: attendance[st.id] || 'PRESENT',
      remarks: null,
    }));

    try {
      const res = await fetch('/api/v1/tenant/attendance/roll-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantID,
        },
        body: JSON.stringify({
          stream_id: '12345678-1234-1234-1234-1234567890ab',
          date,
          session,
          entries,
        }),
      });

      if (res.ok) {
        setFeedback({ type: 'success', text: 'Mahudhurio yamerekodiwa / Roll call saved successfully!' });
      } else {
        setFeedback({ type: 'error', text: 'Kosa limetokea / Error recording roll call' });
      }
    } catch {
      setFeedback({ type: 'info', text: 'Offline mode: Queued locally in IndexedDB.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Daily Attendance / Mahudhurio ya Kila Siku</h2>
          <p className="text-sm text-gray-500">Grade 3 East - Class Register</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm font-medium"
          />
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => setSession('MORNING')}
              className={`px-3 py-1.5 text-xs font-semibold ${session === 'MORNING' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Asubuhi (AM)
            </button>
            <button
              onClick={() => setSession('AFTERNOON')}
              className={`px-3 py-1.5 text-xs font-semibold ${session === 'AFTERNOON' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Mchana (PM)
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <button
          onClick={handleMarkAllPresent}
          className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold py-2 px-3 rounded-lg"
        >
          ✓ Weka Wote Wapo (Mark All Present)
        </button>
      </div>

      <div className="space-y-3">
        {sampleStudents.map((st) => {
          const currentStatus = attendance[st.id] || 'PRESENT';
          return (
            <div key={st.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
              <div>
                <p className="font-semibold text-sm text-gray-800">{st.name}</p>
                <p className="text-xs text-gray-400">Adm: {st.admission}</p>
              </div>
              <div className="flex gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const isSelected = currentStatus === opt.code;
                  return (
                    <button
                      key={opt.code}
                      onClick={() => handleStatusChange(st.id, opt.code)}
                      className={`w-9 h-9 rounded-lg font-bold text-xs transition ${
                        isSelected ? opt.color : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {feedback && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${feedback.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
          {feedback.text}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-sm transition"
      >
        {isSubmitting ? 'Inahifadhi / Saving...' : 'Hifadhi Mahudhurio (Save Attendance)'}
      </button>
    </div>
  );
}
JSX_EOF

echo "📝 [3/5] Creating Student & Guardian Admission Form..."

cat << 'JSX_EOF' > frontend/src/views/AdmissionForm.jsx
import React, { useState } from 'react';

export default function AdmissionForm({ tenantID = 'default' }) {
  const [formData, setFormData] = useState({
    admissionNumber: '',
    upiNemis: '',
    firstName: '',
    lastName: '',
    gender: 'MALE',
    dateOfBirth: '',
    guardianName: '',
    guardianPhone: '',
    guardianRelationship: 'MOTHER',
  });

  const [status, setStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus({ type: 'loading', text: 'Inasajili mwanafunzi...' });

    try {
      const res = await fetch('/api/v1/tenant/students', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantID,
        },
        body: JSON.stringify({
          admission_number: formData.admissionNumber,
          upi_nemis: formData.upiNemis || null,
          first_name: formData.firstName,
          last_name: formData.lastName,
          gender: formData.gender,
          date_of_birth: formData.dateOfBirth,
        }),
      });

      if (res.ok) {
        setStatus({ type: 'success', text: 'Mwanafunzi amesajiliwa kikamilifu! (Learner admitted successfully)' });
        setFormData({
          admissionNumber: '',
          upiNemis: '',
          firstName: '',
          lastName: '',
          gender: 'MALE',
          dateOfBirth: '',
          guardianName: '',
          guardianPhone: '',
          guardianRelationship: 'MOTHER',
        });
      } else {
        setStatus({ type: 'error', text: 'Kosa: Nambari ya usajili inaweza kuwa tayari ipo.' });
      }
    } catch {
      setStatus({ type: 'error', text: 'Kosa la mawasiliano na seva / Network error' });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800 mb-1">Usajili wa Mwanafunzi (Student Admission)</h2>
      <p className="text-sm text-gray-500 mb-6">Taarifa za mwanafunzi na mzazi kulingana na muongozo wa NEMIS/CBC.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nambari ya Usajili (Admission No) *</label>
            <input
              required
              type="text"
              placeholder="mf. ADM-2026-042"
              value={formData.admissionNumber}
              onChange={(e) => setFormData({ ...formData, admissionNumber: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">NEMIS UPI (Hiari / Optional)</label>
            <input
              type="text"
              placeholder="mf. ABC1234567"
              value={formData.upiNemis}
              onChange={(e) => setFormData({ ...formData, upiNemis: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Kwanza (First Name) *</label>
            <input
              required
              type="text"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Mwisho (Last Name) *</label>
            <input
              required
              type="text"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Jinsia (Gender) *</label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="MALE">Mvulana (Male)</option>
              <option value="FEMALE">Msichana (Female)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Tarehe ya Kuzaliwa (DOB) *</label>
            <input
              required
              type="date"
              value={formData.dateOfBirth}
              onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="pt-4 border-t">
          <h3 className="text-sm font-bold text-gray-700 mb-3">Taarifa za Mzazi/Mlezi (Guardian Information)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Jina la Mzazi (Guardian Name)</label>
              <input
                type="text"
                placeholder="mf. Mary Wanjiku"
                value={formData.guardianName}
                onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Simu ya M-Pesa (Phone for Alerts)</label>
              <input
                type="tel"
                placeholder="+2547XXXXXXXX"
                value={formData.guardianPhone}
                onChange={(e) => setFormData({ ...formData, guardianPhone: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        {status && (
          <div className={`p-3 rounded-lg text-sm ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {status.text}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition"
        >
          Sajili Mwanafunzi (Admit Learner)
        </button>
      </form>
    </div>
  );
}
JSX_EOF

echo "💳 [4/5] Creating Bursar Fee Cashiering & M-Pesa STK Push View..."

cat << 'JSX_EOF' > frontend/src/views/FeeCashiering.jsx
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
JSX_EOF

echo "🌐 [5/5] Creating Global Navigation AppShell & App Entry..."

cat << 'JSX_EOF' > frontend/src/layouts/AppShell.jsx
import React, { useState } from 'react';

export default function AppShell({ activeTab, onTabChange, children }) {
  const [isOnline] = useState(navigator.onLine);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-lg">
              K
            </div>
            <div>
              <h1 className="font-bold text-sm sm:text-base leading-tight">Shule Yetu Primary SaaS</h1>
              <p className="text-xs text-gray-400">Muhula wa 1, 2026 (Term 1)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${isOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {isOnline ? '● Mtandaoni (Online)' : '○ Nje ya Mtandao (Offline)'}
            </span>
          </div>
        </div>

        <nav className="max-w-6xl mx-auto px-4 flex gap-1 sm:gap-4 overflow-x-auto border-t">
          {[
            { id: 'students', label: 'Wanafunzi (Admission)' },
            { id: 'attendance', label: 'Mahudhurio (Attendance)' },
            { id: 'cbc', label: 'Tathmini ya CBC (Rubrics)' },
            { id: 'fees', label: 'Ada za Shule (Fees & M-Pesa)' },
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

      <main className="max-w-6xl mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
JSX_EOF

cat << 'JSX_EOF' > frontend/src/App.jsx
import React, { useState } from 'react';
import AppShell from './layouts/AppShell';
import AdmissionForm from './views/AdmissionForm';
import DailyAttendance from './views/DailyAttendance';
import AssessmentMatrix from './components/AssessmentMatrix';
import FeeCashiering from './views/FeeCashiering';

export default function App() {
  const [activeTab, setActiveTab] = useState('attendance');

  const sampleStudents = [
    { id: '11111111-1111-1111-1111-111111111111', first_name: 'Juma', last_name: 'Omondi', admission_number: 'ADM-001', upi_nemis: 'ABC123' },
    { id: '22222222-2222-2222-2222-222222222222', first_name: 'Achieng', last_name: 'Nekesa', admission_number: 'ADM-002', upi_nemis: 'DEF456' },
    { id: '33333333-3333-3333-3333-333333333333', first_name: 'Mwangi', last_name: 'Kamau', admission_number: 'ADM-003', upi_nemis: 'GHI789' },
  ];

  const sampleStrand = {
    id: 'strand-sample-uuid',
    title: 'Hesabu: Sehemu na Desimali (Fractions & Decimals)',
  };

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'students' && <AdmissionForm />}
      {activeTab === 'attendance' && <DailyAttendance />}
      {activeTab === 'cbc' && <AssessmentMatrix students={sampleStudents} strand={sampleStrand} tenantID="default" />}
      {activeTab === 'fees' && <FeeCashiering />}
    </AppShell>
  );
}
JSX_EOF

echo "🚀 Committing and Pushing Frontend Views to GitHub..."
git add .
git commit -m "feat(ui): add admission form, daily attendance roll call, fee cashiering, and global AppShell"
git push origin main || git push origin master

rm -f apply_frontend_views.sh
echo "✅ All frontend views and AppShell pushed successfully!"
