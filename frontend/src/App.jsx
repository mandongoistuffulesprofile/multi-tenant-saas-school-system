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
