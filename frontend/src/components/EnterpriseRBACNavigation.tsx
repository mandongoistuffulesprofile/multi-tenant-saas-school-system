import React from 'react';

export type UserRole = 'SUPER_ADMIN' | 'HEADTEACHER' | 'BURSAR' | 'TEACHER' | 'BOM_MEMBER' | 'STOREKEEPER';

export interface NavItem {
  label: string;
  href: string;
  roles: UserRole[];
  badge?: string;
}

const NAVIGATION_ITEMS: NavItem[] = [
  { label: 'SaaS Platform Owner', href: '/saas-admin', roles: ['SUPER_ADMIN'] },
  { label: 'Dashibodi ya Shule', href: '/dashboard', roles: ['HEADTEACHER', 'BURSAR', 'TEACHER', 'BOM_MEMBER', 'STOREKEEPER'] },
  { label: 'Usimamizi wa Ada', href: '/fees', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BURSAR'] },
  { label: 'Tathmini ya CBC', href: '/cbc-assessment', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'TEACHER'] },
  { label: 'Sajili ya Wanafunzi (NEMIS)', href: '/students', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BURSAR', 'TEACHER'] },
  { label: 'BOM Oversight & QASO', href: '/bom-oversight', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BOM_MEMBER'] },
];

interface RBACNavProps {
  currentRole: UserRole;
  currentPath: string;
  schoolName?: string;
  onNavigate?: (href: string) => void;
}

export const EnterpriseRBACNavigation: React.FC<RBACNavProps> = ({
  currentRole,
  currentPath,
  schoolName = 'KENYA PRIMARY MANAGEMENT SYSTEM',
  onNavigate,
}) => {
  const authorizedItems = NAVIGATION_ITEMS.filter((item) => item.roles.includes(currentRole));

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center space-x-4">
            <span className="font-black text-sm tracking-widest text-emerald-400 uppercase">
              {currentRole === 'SUPER_ADMIN' ? 'EduKe SaaS Network' : schoolName}
            </span>
            <nav className="hidden md:flex space-x-1" aria-label="Main Navigation">
              {authorizedItems.map((item) => {
                const isActive = currentPath === item.href;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={(e) => {
                      if (onNavigate) {
                        e.preventDefault();
                        onNavigate(item.href);
                      }
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-slate-800 text-emerald-300 border-b-2 border-emerald-400 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-[11px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded border border-slate-700">
              Jukumu: <strong className="text-emerald-400 uppercase">{currentRole}</strong>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};
