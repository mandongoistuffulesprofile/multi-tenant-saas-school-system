import React, { useState, useEffect } from 'react';
import { EnterpriseRBACNavigation, UserRole } from './components/EnterpriseRBACNavigation';
import { PWAOfflineSyncBanner } from './components/PWAOfflineSyncBanner';
import { QuickPinStaffroomModal } from './components/QuickPinStaffroomModal';
import { FeesDesk } from './pages/FeesDesk';
import { CBCAssessment } from './pages/CBCAssessment';
import { StudentsDesk } from './pages/StudentsDesk';
import { BOMOversight } from './pages/BOMOversight';
import { ReportCardPrint } from './pages/ReportCardPrint';
import { Language, translations } from './utils/i18n';
import { requestDurableStorage } from './utils/durableStorage';

export const App: React.FC = () => {
  const [currentRole, setCurrentRole] = useState<UserRole>('HEADTEACHER');
  const [activePath, setActivePath] = useState<string>('/fees');
  const [lang, setLang] = useState<Language>('sw');
  const [isScreenLocked, setIsScreenLocked] = useState<boolean>(false);

  useEffect(() => {
    // Request persistent storage protection against OS eviction on Android
    requestDurableStorage().catch(console.error);
  }, []);

  const t = translations[lang];

  const handleUnlockPin = (pin: string): boolean => {
    // Demo staffroom lock PIN: 1234
    if (pin === '1234') {
      setIsScreenLocked(false);
      return true;
    }
    return false;
  };

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
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* 1. Offline Network Status Banner */}
      <PWAOfflineSyncBanner pendingCount={0} />

      {/* 2. Enterprise RBAC Navigation Header */}
      <EnterpriseRBACNavigation
        currentRole={currentRole}
        currentPath={activePath}
        schoolName={t.system_title}
        onNavigate={(path) => setActivePath(path)}
      />

      {/* 3. Executive Demo Bar with Quick-PIN Lock & Bilingual Toggle */}
      <div className="bg-slate-900 border-b border-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between text-xs print:hidden gap-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Jukumu:</span>
          {(['HEADTEACHER', 'BURSAR', 'TEACHER', 'BOM_MEMBER'] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => setCurrentRole(role)}
              className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                currentRole === role ? 'bg-emerald-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {role}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Quick-PIN Lock Button */}
          <button
            onClick={() => setIsScreenLocked(true)}
            title="Kufunga skrini kwa usalama wa kompyuta ya pamoja"
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer"
          >
            <span>🔒 Funga Skrini (Lock)</span>
          </button>

          {/* Bilingual Switcher */}
          <div className="flex items-center bg-slate-800 rounded p-0.5 border border-slate-700">
            <button
              onClick={() => setLang('sw')}
              className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                lang === 'sw' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              🇰🇪 Kiswahili
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-2 py-0.5 text-[11px] font-bold rounded cursor-pointer ${
                lang === 'en' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              🇬🇧 English
            </button>
          </div>

          <button
            onClick={() => setActivePath('/reports')}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[11px] shadow cursor-pointer"
          >
            {t.nav_reports}
          </button>
        </div>
      </div>

      {/* 4. Main Institutional Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {renderActiveView()}
      </main>

      {/* 5. Shared Staffroom Quick-PIN Modal */}
      <QuickPinStaffroomModal
        isOpen={isScreenLocked}
        currentUser={`${currentRole} (Staffroom PC)`}
        onUnlock={handleUnlockPin}
        onSwitchUser={() => setIsScreenLocked(false)}
      />
    </div>
  );
};

export default App;
