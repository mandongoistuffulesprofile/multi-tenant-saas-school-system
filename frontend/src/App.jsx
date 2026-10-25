import React, { useState, useEffect } from 'react';
import CBCRubricAssessment from './components/CBCRubricAssessment';
import { getActiveTenantSubdomain } from './utils/tenantResolver';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000/api/v1' : '/api/v1';

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentTenant, setCurrentTenant] = useState(null);
  const [navigationPath, setNavigationPath] = useState(['Dashboard']);

  // Login Form State
  const [email, setEmail] = useState('admin@school.co.ke');
  const [password, setPassword] = useState('password123');
  const [subdomain, setSubdomain] = useState(getActiveTenantSubdomain());
  const [loginError, setLoginError] = useState(null);
  const [loading, setLoading] = useState(false);

  // M-Pesa Form State
  const [phone, setPhone] = useState('254712345678');
  const [amount, setAmount] = useState('5000');
  const [admNo, setAdmNo] = useState('ADM-101');
  const [stkStatus, setStkStatus] = useState(null);

  // Check saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem('school_saas_session');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setCurrentUser(parsed.user);
        setCurrentTenant(parsed.tenant);
      } catch (e) {
        localStorage.removeItem('school_saas_session');
      }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, subdomain })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setCurrentUser(data.user);
        setCurrentTenant(data.tenant);
        localStorage.setItem('school_saas_session', JSON.stringify(data));
        setNavigationPath(['Dashboard', `${data.user.role.toUpperCase()} Workspace`]);
      } else {
        setLoginError(data.error || 'Authentication failed.');
      }
    } catch (err) {
      setLoginError(`Cannot connect to authentication backend at ${API_BASE}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('school_saas_session');
    setCurrentUser(null);
    setCurrentTenant(null);
    setNavigationPath(['Dashboard']);
  };

  const handleSTKPush = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStkStatus(null);
    try {
      const res = await fetch(`${API_BASE}/payments/daraja/stk-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': currentTenant?.id || 'demo'
        },
        body: JSON.stringify({ phoneNumber: phone, amount: Number(amount), admissionNumber: admNo })
      });
      const data = await res.json();
      setStkStatus({ success: res.ok, message: data.message || data.error });
    } catch (err) {
      setStkStatus({ success: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Unauthenticated State: Clean Production Login Form
  // ---------------------------------------------------------------------------
  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#ffffff', width: '100%', maxWidth: '440px', borderRadius: '16px', padding: '36px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{ display: 'inline-block', padding: '10px 14px', background: '#e0f2fe', borderRadius: '12px', fontSize: '24px', marginBottom: '8px' }}>🏫</div>
            <h2 style={{ margin: 0, fontSize: '22px', color: '#0f172a' }}>School SaaS Portal</h2>
            <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '14px' }}>Sign in to your institutional workspace</p>
          </div>

          {loginError && (
            <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '13px', marginBottom: '18px' }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>School Tenant Subdomain</label>
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Staff / Parent Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', boxSizing: 'border-box' }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '12px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '6px' }}
            >
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          {/* Quick-Switch Role Selector for Testing */}
          <div style={{ marginTop: '24px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Quick Fill Role:</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginTop: '8px' }}>
              <button type="button" onClick={() => setEmail('admin@school.co.ke')} style={{ padding: '6px 8px', fontSize: '11px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>Admin (Dr. Khaemba)</button>
              <button type="button" onClick={() => setEmail('teacher@school.co.ke')} style={{ padding: '6px 8px', fontSize: '11px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>Teacher (Mwangi)</button>
              <button type="button" onClick={() => setEmail('accountant@school.co.ke')} style={{ padding: '6px 8px', fontSize: '11px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>Accountant (Bursar)</button>
              <button type="button" onClick={() => setEmail('parent@school.co.ke')} style={{ padding: '6px 8px', fontSize: '11px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer' }}>Parent (Otieno)</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Authenticated State: Shell with Universal Breadcrumbs & Role-Based Views
  // ---------------------------------------------------------------------------
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      {/* Top Navigation Bar */}
      <header style={{ background: '#0f172a', color: '#ffffff', padding: '14px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>🏫</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>{currentTenant?.schoolName || 'School SaaS'}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Domain: <strong>{currentTenant?.subdomain}.schoolsaas.co.ke</strong></div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>{currentUser.name}</div>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: '#0284c7', color: '#fff', textTransform: 'uppercase', fontWeight: 700 }}>
              {currentUser.role}
            </span>
          </div>
          <button
            onClick={handleLogout}
            style={{ padding: '7px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Universal Breadcrumb Bar */}
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
        <span style={{ color: '#64748b' }}>Navigation:</span>
        {navigationPath.map((item, idx) => (
          <React.Fragment key={item}>
            <span style={{ color: idx === navigationPath.length - 1 ? '#0f172a' : '#0284c7', fontWeight: idx === navigationPath.length - 1 ? 600 : 400 }}>
              {item}
            </span>
            {idx < navigationPath.length - 1 && <span style={{ color: '#cbd5e1' }}>/</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Main Role-Based Workspaces */}
      <main style={{ maxWidth: '1100px', margin: '24px auto', padding: '0 16px' }}>
        {/* Role 1: TEACHER WORKSPACE */}
        {currentUser.role === 'teacher' && (
          <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>CBC 4-Level Learner Assessment</h2>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Term 1 - Grade 4 Mathematics</span>
            </div>
            <CBCRubricAssessment
              tenantId={currentTenant.id}
              subStrand={{ id: 'MAT-G4-NUM-01', name: 'Numbers: Operations & Fractions' }}
              learners={[
                { id: 'student-1', name: 'Achieng Otieno', admissionNumber: 'ADM-101', initialScoreCode: 'ME' },
                { id: 'student-2', name: 'Brian Kiprop', admissionNumber: 'ADM-102', initialScoreCode: 'EE' },
                { id: 'student-3', name: 'Faith Wanjiku', admissionNumber: 'ADM-103', initialScoreCode: 'AE' },
                { id: 'student-4', name: 'David Mutua', admissionNumber: 'ADM-104', initialScoreCode: 'BE' }
              ]}
            />
          </div>
        )}

        {/* Role 2: ACCOUNTANT / BURSAR CONSOLE */}
        {currentUser.role === 'accountant' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Dispatch M-Pesa STK Prompt</h3>
              <form onSubmit={handleSTKPush} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Parent Phone (254...)</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Amount to Incur (KES)</label>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Student Admission No.</label>
                  <input type="text" value={admNo} onChange={(e) => setAdmNo(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} required />
                </div>
                <button type="submit" disabled={loading} style={{ padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
                  {loading ? 'Transmitting to Safaricom...' : 'Trigger Lipa na M-Pesa'}
                </button>
              </form>
              {stkStatus && (
                <div style={{ marginTop: '14px', padding: '10px', borderRadius: '6px', fontSize: '12px', background: stkStatus.success ? '#dcfce7' : '#fee2e2', color: stkStatus.success ? '#166534' : '#991b1b' }}>
                  {stkStatus.message}
                </div>
              )}
            </div>

            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px' }}>Fee Ledgers (Active Roster)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                    <th style={{ padding: '8px 0' }}>Adm</th>
                    <th>Student</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 0' }}>ADM-101</td>
                    <td>Achieng Otieno</td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>KES 20,000</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 0' }}>ADM-102</td>
                    <td>Brian Kiprop</td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>KES 20,000</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '10px 0' }}>ADM-103</td>
                    <td>Faith Wanjiku</td>
                    <td style={{ color: '#16a34a', fontWeight: 600 }}>KES 0 (Cleared)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Role 3: PRINCIPAL / ADMIN DASHBOARD */}
        {currentUser.role === 'admin' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>Total Active Students</div>
              <div style={{ fontSize: '28px', fontWeight: 700, margin: '8px 0', color: '#0f172a' }}>482</div>
              <div style={{ fontSize: '12px', color: '#16a34a' }}>CBC Grade 1 to 6</div>
            </div>
            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>Fee Collection Rate</div>
              <div style={{ fontSize: '28px', fontWeight: 700, margin: '8px 0', color: '#0f172a' }}>78.4%</div>
              <div style={{ fontSize: '12px', color: '#0284c7' }}>KES 4.2M Reconciled</div>
            </div>
            <div style={{ background: '#ffffff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <div style={{ color: '#64748b', fontSize: '13px' }}>Offline CBC Sync Status</div>
              <div style={{ fontSize: '28px', fontWeight: 700, margin: '8px 0', color: '#16a34a' }}>Synchronized</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>PostgreSQL RLS Active</div>
            </div>
          </div>
        )}

        {/* Role 4: PARENT PORTAL */}
        {currentUser.role === 'parent' && (
          <div style={{ background: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px' }}>Student Performance & Fee Statement</h2>
            <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Learner: <strong>Achieng Otieno (Grade 4)</strong></p>

            <div style={{ margin: '20px 0', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Total Term Invoice:</span>
                <span style={{ fontWeight: 600 }}>KES 35,000</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: '#64748b' }}>Total Paid via M-Pesa:</span>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>KES 15,000</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '14px', fontWeight: 700 }}>Outstanding Balance:</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>KES 20,000</span>
              </div>
            </div>

            <button
              onClick={() => alert('STK Push initiated to your registered Safaricom phone.')}
              style={{ width: '100%', padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
            >
              Pay Outstanding KES 20,000 via M-Pesa
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
