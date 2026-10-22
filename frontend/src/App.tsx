import React, { useState } from 'react';
import { EnterpriseRBACNavigation, UserRole } from './components/EnterpriseRBACNavigation';
import { PWAOfflineSyncBanner } from './components/PWAOfflineSyncBanner';
import { FeesDesk } from './pages/FeesDesk';
import { CBCAssessment } from './pages/CBCAssessment';
import { StudentsDesk } from './pages/StudentsDesk';
import { BOMOversight } from './pages/BOMOversight';
import { ReportCardPrint } from './pages/ReportCardPrint';

export const App: React.FC = () => {
  const [currentRole, setCurrentRole] = useState<UserRole>('HEADTEACHER');
  const [activePath, setActivePath] = useState<string>('/fees');

  const renderActiveView = () => {
    switch (activePath) {
      case '/fees':
        return <FeesDesk />;
      case '/cbc-assessment':
        return <CBCAssessment />;
      case '/students':
        return <StudentsDesk />;
      case '/bom-oversight':
        return <BOMOversight />;
      case '/reports':
        return <ReportCardPrint />;
      default:
        return <FeesDesk />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* 1. Offline Network Status Banner */}
      <PWAOfflineSyncBanner pendingCount={0} />

      {/* 2. Enterprise RBAC Navigation Header */}
      <EnterpriseRBACNavigation
        currentRole={currentRole}
        currentPath={activePath}
        schoolName="MANDONGOI BOARDING PRIMARY SAAS"
        onNavigate={(path) => setActivePath(path)}
      />

      {/* 3. Demo Role Switcher Bar (For Procurement & BOM Demonstrations) */}
      <div className="bg-slate-800 text-white px-4 py-1.5 flex items-center justify-between text-xs print:hidden border-b border-slate-700">
        <span className="text-slate-400">
          Chagua Jukumu la Kujaribu (Demo Role Switcher):
        </span>
        <div className="flex gap-2">
          {(['HEADTEACHER', 'BURSAR', 'TEACHER', 'BOM_MEMBER'] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => setCurrentRole(role)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                currentRole === role ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {role}
            </button>
          ))}
          <button
            onClick={() => setActivePath('/reports')}
            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-500 ml-3"
          >
            Ripoti ya MoE (Print View)
          </button>
        </div>
      </div>

      {/* 4. Main Institutional Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {renderActiveView()}
      </main>
    </div>
  );
};

export default App;
