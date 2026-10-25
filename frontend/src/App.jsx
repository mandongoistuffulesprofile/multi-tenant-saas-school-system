import React, { useState } from 'react';
import CBCRubricAssessment from './components/CBCRubricAssessment';
import { getActiveTenantSubdomain } from './utils/tenantResolver';

const SAMPLE_SUBSTRAND = {
  id: 'MAT-G4-STR1-NUM',
  name: 'Mathematics Grade 4: Place Value & Operations'
};

const SAMPLE_LEARNERS = [
  { id: 'student-001', name: 'Achieng Otieno', admissionNumber: 'ADM-101', initialScoreCode: 'ME' },
  { id: 'student-002', name: 'Brian Kiprop', admissionNumber: 'ADM-102', initialScoreCode: 'EE' },
  { id: 'student-003', name: 'Faith Wanjiku', admissionNumber: 'ADM-103', initialScoreCode: 'AE' },
  { id: 'student-004', name: 'David Mutua', admissionNumber: 'ADM-104', initialScoreCode: 'BE' }
];

export default function App() {
  const tenant = getActiveTenantSubdomain();
  const [activeTab, setActiveTab] = useState('cbc');

  // M-Pesa STK Push Test State
  const [phone, setPhone] = useState('0712345678');
  const [amount, setAmount] = useState('1500');
  const [admNo, setAdmNo] = useState('ADM-101');
  const [stkStatus, setStkStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSTKPush = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStkStatus(null);
    try {
      const res = await fetch('http://localhost:4000/api/v1/payments/daraja/stk-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant
        },
        body: JSON.stringify({
          phoneNumber: phone,
          amount: Number(amount),
          admissionNumber: admNo
        })
      });
      const data = await res.json();
      setStkStatus({ success: res.ok, data });
    } catch (err) {
      setStkStatus({ success: false, data: { error: err.message } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Segoe UI, -apple-system, sans-serif', backgroundColor: '#f0f2f5', minHeight: '100vh', margin: 0, padding: '20px' }}>
      {/* Top Banner */}
      <div style={{ maxWidth: '1000px', margin: '0 auto 20px', background: '#1e293b', color: '#fff', padding: '16px 24px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>🇰🇪 School SaaS: Kenya Multi-Tenant Core</h1>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '13px' }}>
            Active Tenant Subdomain: <span style={{ background: '#334155', padding: '2px 8px', borderRadius: '4px', color: '#38bdf8' }}>{tenant}</span>
          </p>
        </div>
        <div>
          <button 
            onClick={() => setActiveTab('cbc')}
            style={{ marginRight: '8px', padding: '8px 14px', borderRadius: '6px', border: 'none', background: activeTab === 'cbc' ? '#38bdf8' : '#334155', color: activeTab === 'cbc' ? '#0f172a' : '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            CBC Rubrics
          </button>
          <button 
            onClick={() => setActiveTab('daraja')}
            style={{ padding: '8px 14px', borderRadius: '6px', border: 'none', background: activeTab === 'daraja' ? '#38bdf8' : '#334155', color: activeTab === 'daraja' ? '#0f172a' : '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Lipa na M-Pesa Test
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        {activeTab === 'cbc' ? (
          <div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', color: '#1e40af' }}>
              💡 <strong>Offline Test Tip:</strong> Open DevTools (F12) &gt; Network tab &gt; Switch "No throttling" to <strong>"Offline"</strong>. Click grades — they persist in your local IndexedDB and sync automatically when you toggle back to Online.
            </div>
            <CBCRubricAssessment 
              tenantId={tenant} 
              subStrand={SAMPLE_SUBSTRAND} 
              learners={SAMPLE_LEARNERS} 
            />
          </div>
        ) : (
          <div style={{ maxWidth: '500px', margin: '0 auto' }}>
            <h2>Test Lipa na M-Pesa Online (STK Push)</h2>
            <p style={{ color: '#64748b', fontSize: '14px' }}>Dispatches a payment prompt to the parent phone and automatically credits the student's fee ledger.</p>
            <form onSubmit={handleSTKPush} style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Parent Phone Number (Safaricom):</label>
                <input 
                  type="text" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Amount (KES):</label>
                <input 
                  type="number" 
                  value={amount} 
                  onChange={(e) => setAmount(e.target.value)} 
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Student Admission Number:</label>
                <input 
                  type="text" 
                  value={admNo} 
                  onChange={(e) => setAdmNo(e.target.value)} 
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
                  required 
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                style={{ padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'Dispatching to Safaricom...' : 'Trigger M-Pesa Prompt'}
              </button>
            </form>

            {stkStatus && (
              <div style={{ marginTop: '20px', padding: '14px', borderRadius: '6px', background: stkStatus.success ? '#dcfce7' : '#fee2e2', color: stkStatus.success ? '#166534' : '#991b1b', fontSize: '13px' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(stkStatus.data, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
