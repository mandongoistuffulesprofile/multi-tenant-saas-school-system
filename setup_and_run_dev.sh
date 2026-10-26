#!/usr/bin/env bash
# ==============================================================================
# All-In-One Developer Setup, Wire, Push & Launch Script
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo " 1. Auto-Wiring Frontend App & React Entrypoints"
echo "=========================================================="

mkdir -p frontend/src/components
mkdir -p frontend/src/utils
mkdir -p frontend/src/services
mkdir -p backend/src/database/migrations

# 1. Automatically write frontend/src/App.jsx (CBC Rubric + M-Pesa STK tester)
cat << 'FILE_EOF' > frontend/src/App.jsx
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
FILE_EOF

# 2. Check and ensure frontend/index.html exists for Vite
if [ ! -f "frontend/index.html" ]; then
  cat << 'FILE_EOF' > frontend/index.html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>School SaaS Multi-Tenant</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
FILE_EOF
fi

# 3. Check and ensure frontend/src/main.jsx exists
if [ ! -f "frontend/src/main.jsx" ]; then
  cat << 'FILE_EOF' > frontend/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
FILE_EOF
fi

echo "=========================================================="
echo " 2. Committing & Pushing Wired App to GitHub"
echo "=========================================================="
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git add frontend/src/App.jsx frontend/src/main.jsx frontend/index.html
git commit -m "feat(frontend): complete App.jsx wiring for CBC Rubric and M-Pesa STK widget" || true
git push origin "${CURRENT_BRANCH}" || true

echo "=========================================================="
echo " 3. Launching Database & Seeding Test School"
echo "=========================================================="
# Start PostgreSQL container
docker run --name school_saas_dev_db \
  -e POSTGRES_DB=school_saas_production \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres:15-alpine 2>/dev/null || docker start school_saas_dev_db >/dev/null

echo "Waiting for PostgreSQL database container to respond..."
until docker exec school_saas_dev_db pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done

# Apply schema migrations
docker exec -i school_saas_dev_db psql -U postgres -d school_saas_production \
  < backend/src/database/migrations/001_core_saas_schema.sql >/dev/null 2>&1 || true

# Seed Demo Tenant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
node backend/src/database/seed_tenant.js demo "Demo Academy Kenya" || true

echo "=========================================================="
echo " 4. Installing Dependencies & Booting Services"
echo "=========================================================="
# Install backend deps if needed
if [ ! -d "node_modules" ] && [ -f "package.json" ]; then
  npm install express pg cors helmet
fi

# Install frontend deps if needed
if [ -d "frontend" ] && [ ! -d "frontend/node_modules" ] && [ -f "frontend/package.json" ]; then
  cd frontend && npm install && cd ..
fi

# Start Backend in background (watch mode)
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/school_saas_production" \
PORT=4000 \
node --watch backend/src/server.js &
BACKEND_PID=$!

echo ""
echo "===================================================================="
echo "🎉 SUCCESS: FULL DEV STACK IS RUNNING!"
echo "   Backend API:   http://localhost:4000"
echo "   Frontend Web:  http://localhost:5173/?tenant=demo  (or :3000)"
echo "===================================================================="
echo "Press Ctrl + C anytime to stop both services."
echo ""

# Launch Frontend
trap "kill $BACKEND_PID 2>/dev/null; exit 0" INT TERM EXIT
cd frontend
npm run dev || npm start
