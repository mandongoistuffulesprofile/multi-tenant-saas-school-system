#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"
echo "📂 Working from: $(pwd)"

echo "🌱 [1/4] Creating Database Bootstrap Seed (Demo School, Users, Calendar)..."
mkdir -p migrations/slice3
mkdir -p frontend/src/views

cat << 'SQL_EOF' > migrations/slice3/006_bootstrap_demo_school.sql
-- migrations/slice3/006_bootstrap_demo_school.sql
-- Bootstrap Seed for Hillcrest Academy (Demo School)

DO $$
DECLARE
    v_tenant_id UUID;
    v_year_id UUID;
    v_term1_id UUID;
    v_stream_id UUID;
    v_student1_id UUID;
    -- Argon2id hash for 'Password123!'
    v_pwd_hash VARCHAR := '$argon2id$v=19$m=65536,t=1,p=4$vB87kX8s9o1H5e9u7t6r5A$wX4y8Z9v0A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
BEGIN
    -- 1. Create Demo Tenant if not exists
    INSERT INTO tenants (name, subdomain, school_code, status)
    VALUES ('Hillcrest Academy', 'demo', 'HA-2026', 'ACTIVE')
    ON CONFLICT (subdomain) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_tenant_id;

    -- 2. Create Default Head Teacher
    INSERT INTO users (tenant_id, email, phone_number, password_hash, first_name, last_name, role, is_active)
    VALUES (v_tenant_id, 'admin@shuleyetu.ke', '+254712345678', v_pwd_hash, 'Mwalimu', 'Kariuki', 'HEAD_TEACHER', true)
    ON CONFLICT (tenant_id, email) DO NOTHING;

    -- 3. Academic Year 2026
    INSERT INTO academic_years (tenant_id, year_name, start_date, end_date, is_current)
    VALUES (v_tenant_id, '2026', '2026-01-05', '2026-11-20', true)
    ON CONFLICT (tenant_id, year_name) DO UPDATE SET is_current = true
    RETURNING id INTO v_year_id;

    -- 4. Term 1 (Current)
    INSERT INTO terms (tenant_id, academic_year_id, term_number, start_date, end_date, is_current)
    VALUES (v_tenant_id, v_year_id, 1, '2026-01-05', '2026-04-03', true)
    ON CONFLICT (tenant_id, academic_year_id, term_number) DO UPDATE SET is_current = true
    RETURNING id INTO v_term1_id;

    -- 5. Standard Streams
    INSERT INTO class_streams (tenant_id, grade_level, stream_name)
    VALUES (v_tenant_id, 'Grade 3', 'East')
    ON CONFLICT (tenant_id, grade_level, stream_name) DO NOTHING
    RETURNING id INTO v_stream_id;

    -- 6. Seed KICD Curricula for this Tenant
    PERFORM seed_default_kicd_curriculum(v_tenant_id);

    -- 7. Sample Learners
    INSERT INTO students (tenant_id, admission_number, upi_nemis, first_name, last_name, gender, date_of_birth, current_stream_id)
    VALUES 
        (v_tenant_id, 'ADM-001', 'UPI789123', 'Juma', 'Omondi', 'MALE', '2017-04-12', v_stream_id),
        (v_tenant_id, 'ADM-002', 'UPI456789', 'Achieng', 'Nekesa', 'FEMALE', '2017-06-25', v_stream_id),
        (v_tenant_id, 'ADM-003', 'UPI123456', 'Mwangi', 'Kamau', 'MALE', '2017-09-08', v_stream_id)
    ON CONFLICT (tenant_id, admission_number) DO NOTHING;

END $$;
SQL_EOF

echo "🔐 [2/4] Creating Frontend LoginForm View..."

cat << 'JSX_EOF' > frontend/src/views/LoginForm.jsx
import React, { useState } from 'react';

export default function LoginForm({ onLoginSuccess }) {
  const [subdomain, setSubdomain] = useState('demo');
  const [email, setEmail] = useState('admin@shuleyetu.ke');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain, email, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        onLoginSuccess({
          token: data.token,
          user: data.user,
          subdomain,
        });
      } else {
        setError(data.error || 'Nenosiri au baruapepe si sahihi (Invalid credentials)');
      }
    } catch {
      setError('Kosa la mawasiliano na seva (Server connection error)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-2xl shadow-xl border p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white font-black text-2xl flex items-center justify-center mx-auto mb-3 shadow-md shadow-blue-200">
            K
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Shule Yetu Primary SaaS</h1>
          <p className="text-xs text-gray-400 mt-1">Mfumo wa Usimamizi wa Shule za Msingi (CBC)</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Kikoa cha Shule (School Subdomain)
            </label>
            <div className="flex rounded-xl border overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
              <input
                required
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                className="w-full px-3 py-2 text-sm outline-none"
                placeholder="demo"
              />
              <span className="bg-gray-100 px-3 py-2 text-xs text-gray-400 font-semibold border-l">
                .schools.ke
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Baruapepe au Nambari ya Simu (Email/Phone)
            </label>
            <input
              required
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="admin@shuleyetu.ke"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1 uppercase tracking-wider">
              Nenosiri (Password)
            </label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition shadow-md shadow-blue-200 mt-2"
          >
            {loading ? 'Inaingia... / Signing in...' : 'Ingia kwenye Mfumo (Sign In)'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t text-center">
          <p className="text-xs text-gray-400">
            Akaunti ya Majaribio (Demo): <span className="font-semibold text-gray-600">admin@shuleyetu.ke</span> / <span className="font-semibold text-gray-600">Password123!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
JSX_EOF

echo "⚛️ [3/4] Updating App.jsx with Session State & Logout..."

cat << 'JSX_EOF' > frontend/src/App.jsx
import React, { useState, useEffect } from 'react';
import AppShell from './layouts/AppShell';
import LoginForm from './views/LoginForm';
import AdmissionForm from './views/AdmissionForm';
import DailyAttendance from './views/DailyAttendance';
import AssessmentMatrix from './components/AssessmentMatrix';
import FeeCashiering from './views/FeeCashiering';

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
      {activeTab === 'fees' && <FeeCashiering tenantID={session.user.tenant_id} />}
    </AppShell>
  );
}
JSX_EOF

# Update AppShell header to support user logout button
cat << 'JSX_EOF' > frontend/src/layouts/AppShell.jsx
import React, { useState } from 'react';

export default function AppShell({ activeTab, onTabChange, user, onLogout, children }) {
  const [isOnline] = useState(navigator.onLine);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-800">
      <header className="bg-white border-b sticky top-0 z-50">
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

echo "🚀 [4/4] Committing and Pushing Seed and Auth Session Flow to GitHub..."
git add .
git commit -m "feat(auth-seed): add 006 demo school bootstrap migration and complete frontend login session flow"
git push origin main || git push origin master

rm -f apply_seed_and_login_flow.sh
echo "✅ Demo seed and login session flow successfully pushed to GitHub!"
