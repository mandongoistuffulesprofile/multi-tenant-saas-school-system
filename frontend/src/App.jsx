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
