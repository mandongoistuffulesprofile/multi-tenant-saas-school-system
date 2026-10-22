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
