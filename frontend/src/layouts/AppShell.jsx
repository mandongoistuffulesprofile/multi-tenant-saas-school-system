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
