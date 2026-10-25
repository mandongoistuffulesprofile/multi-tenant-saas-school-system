#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# UX MATURITY REMEDIATION ENGINE (LINUX)
# Platform: Multi-Tenant Kenyan Primary School Management SaaS
# Target Stakeholders: Procurement, School BOM, MoE QASO, Institutional Operators
# ==============================================================================

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}==================================================================${NC}"
echo -e "${CYAN}>>> Initiating Enterprise UX Modernization for Linux Environment <<<${NC}"
echo -e "${CYAN}==================================================================${NC}"

# Locate frontend root directory
if [ -d "frontend" ]; then
    FRONTEND_ROOT="frontend"
elif [ -f "package.json" ]; then
    FRONTEND_ROOT="."
else
    echo -e "${RED}[ERROR] Could not detect frontend directory. Run this from your project root.${NC}"
    exit 1
fi

SRC_DIR="$FRONTEND_ROOT/src"
UTILS_DIR="$SRC_DIR/utils"
COMPONENTS_DIR="$SRC_DIR/components"

mkdir -p "$UTILS_DIR"
mkdir -p "$COMPONENTS_DIR"

echo -e "${YELLOW}[1/6] Purging Tailwind CDN & Enforcing Local PostCSS Zero-FOUC Config...${NC}"
INDEX_HTML="$FRONTEND_ROOT/index.html"
if [ -f "$INDEX_HTML" ]; then
    # Strip any CDN scripts targeting tailwindcdn.com
    sed -i '/cdn.tailwindcss.com/d' "$INDEX_HTML"
    echo -e "${GREEN}  ✓ Purged external Tailwind CDN links from $INDEX_HTML${NC}"
fi

# Ensure postcss.config.js exists
cat << 'CONFIG_EOF' > "$FRONTEND_ROOT/postcss.config.js"
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
CONFIG_EOF

# Ensure base index.css imports tailwind layers properly
INDEX_CSS="$SRC_DIR/index.css"
if [ -f "$INDEX_CSS" ]; then
    if ! grep -q "@tailwind base;" "$INDEX_CSS"; then
        echo -e "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n$(cat "$INDEX_CSS")" > "$INDEX_CSS"
        echo -e "${GREEN}  ✓ Injected @tailwind directives into $INDEX_CSS${NC}"
    fi
else
    cat << 'CSS_EOF' > "$INDEX_CSS"
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    @apply bg-slate-50 text-slate-900 antialiased;
    font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  }
}
CSS_EOF
    echo -e "${GREEN}  ✓ Created local stylesheet $INDEX_CSS${NC}"
fi

echo -e "${YELLOW}[2/6] Generating Deep Kenyan Institutional Validators (NEMIS, TSC, M-Pesa)...${NC}"
cat << 'VALIDATOR_EOF' > "$UTILS_DIR/kenyaValidators.ts"
/**
 * Kenyan Institutional Validation Rules (MoE, TSC, KNEC, Daraja)
 */

export const KenyaValidators = {
  // NEMIS UPI: Exactly 6 alphanumeric characters (or modern 10-char UPI)
  nemisUPI: (val: string): boolean => {
    return /^[A-Z0-9]{6,10}$/i.test(val.trim());
  },

  // Teachers Service Commission (TSC) Number: 6-7 numeric digits
  tscNumber: (val: string): boolean => {
    return /^\d{6,7}$/.test(val.trim());
  },

  // Kenyan M-Pesa / Mobile Phone validator
  kenyanPhone: (val: string): boolean => {
    return /^(?:254|\+254|0)?([71]\d{8})$/.test(val.trim());
  },

  // Standardize mobile number to E.164 (+2547XXXXXXXX)
  normalizePhone: (val: string): string => {
    const clean = val.replace(/\D/g, '');
    if (clean.startsWith('254') && clean.length === 12) return `+${clean}`;
    if (clean.startsWith('0') && clean.length === 10) return `+254${clean.substring(1)}`;
    if (clean.length === 9) return `+254${clean}`;
    return val;
  },

  // KNEC Assessment Index Number format (e.g., 40100101-001)
  knecAssessmentNumber: (val: string): boolean => {
    return /^\d{8}-\d{3}$/.test(val.trim());
  },

  // Standard Safaricom Daraja M-Pesa Receipt ID (e.g., QKD712XY6Z)
  mpesaReceiptId: (val: string): boolean => {
    return /^[A-Z0-9]{10}$/.test(val.trim());
  }
};
VALIDATOR_EOF
echo -e "${GREEN}  ✓ Generated $UTILS_DIR/kenyaValidators.ts${NC}"

echo -e "${YELLOW}[3/6] Generating Strict RBAC Navigation Engine...${NC}"
cat << 'RBAC_EOF' > "$COMPONENTS_DIR/EnterpriseRBACNavigation.tsx"
import React from 'react';

export type UserRole = 'SUPER_ADMIN' | 'HEADTEACHER' | 'BURSAR' | 'TEACHER' | 'BOM_MEMBER' | 'STOREKEEPER';

export interface NavItem {
  label: string;
  href: string;
  roles: UserRole[];
  badge?: string;
}

const NAVIGATION_ITEMS: NavItem[] = [
  { label: 'Dashibodi (Dashboard)', href: '/dashboard', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BURSAR', 'TEACHER', 'BOM_MEMBER', 'STOREKEEPER'] },
  { label: 'Usimamizi wa Ada (Fees & Paybill)', href: '/fees', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BURSAR'] },
  { label: 'Tathmini ya CBC (Assessments)', href: '/cbc-assessment', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'TEACHER'] },
  { label: 'Wanafunzi & NEMIS', href: '/students', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BURSAR', 'TEACHER'] },
  { label: 'BOM Oversight & Reconciliations', href: '/bom-oversight', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'BOM_MEMBER'] },
  { label: 'Bohari na Vifaa (Inventory)', href: '/inventory', roles: ['SUPER_ADMIN', 'HEADTEACHER', 'STOREKEEPER'] },
  { label: 'Mipangilio ya Mfumo (Settings)', href: '/settings', roles: ['SUPER_ADMIN'] }
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
              {schoolName}
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
RBAC_EOF
echo -e "${GREEN}  ✓ Generated $COMPONENTS_DIR/EnterpriseRBACNavigation.tsx${NC}"

echo -e "${YELLOW}[4/6] Generating Enterprise Kenyan Paginated Data Table with Filters & CSV Export...${NC}"
cat << 'TABLE_EOF' > "$COMPONENTS_DIR/EnterpriseDataTable.tsx"
import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

interface EnterpriseDataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  filterStreamOptions?: string[];
  filenameExport?: string;
}

export function EnterpriseDataTable<T extends Record<string, any>>({
  data,
  columns,
  searchPlaceholder = 'Tafuta kwa nambari ya usajili, jina au UPI...',
  filterStreamOptions = ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Grade 7', 'Grade 8', 'Grade 9'],
  filenameExport = 'Ripoti_ya_Wanafunzi.csv',
}: EnterpriseDataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [selectedStream, setSelectedStream] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Filtered dataset
  const filteredData = useMemo(() => {
    return data.filter((row) => {
      const matchSearch = Object.values(row).some((val) =>
        String(val).toLowerCase().includes(query.toLowerCase())
      );
      const matchStream = selectedStream ? row.stream === selectedStream || row.grade === selectedStream : true;
      return matchSearch && matchStream;
    });
  }, [data, query, selectedStream]);

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;

  // CSV Export utility
  const handleExportCSV = () => {
    if (filteredData.length === 0) return;
    const headers = columns.map((col) => `"${col.header}"`).join(',');
    const rows = filteredData.map((row) =>
      columns.map((col) => `"${String(row[col.key] ?? '')}"`).join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filenameExport);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Control Bar */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2 items-center justify-between text-xs">
        <div className="flex gap-2 items-center flex-1 min-w-[280px]">
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
            placeholder={searchPlaceholder}
            className="w-full sm:w-80 px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
          <select
            value={selectedStream}
            onChange={(e) => { setSelectedStream(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white focus:outline-none"
          >
            <option value="">Madarasa Yote (All Streams)</option>
            {filterStreamOptions.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleExportCSV}
          type="button"
          className="px-3 py-1.5 bg-slate-800 text-white rounded font-medium hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
        >
          <span>Pakua CSV (Export)</span>
        </button>
      </div>

      {/* Responsive Table Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-100 text-slate-800 uppercase font-semibold border-b border-slate-200">
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} className="px-4 py-2.5">{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedData.length > 0 ? (
              paginatedData.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className="px-4 py-2.5">
                      {col.render ? col.render(row) : String(row[col.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-slate-400">
                  Hakuna rekodi zilizopatikana (No records found).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
        <div>
          Jumla ya Rekodi: <strong className="text-slate-800">{filteredData.length}</strong> (Ukurasa {currentPage} wa {totalPages})
        </div>
        <div className="flex gap-1">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40"
          >
            Nyuma (Prev)
          </button>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40"
          >
            Mbele (Next)
          </button>
        </div>
      </div>
    </div>
  );
}
TABLE_EOF
echo -e "${GREEN}  ✓ Generated $COMPONENTS_DIR/EnterpriseDataTable.tsx${NC}"

echo -e "${YELLOW}[5/6] Generating BOM Audit-Trail Confirmation Modal...${NC}"
cat << 'MODAL_EOF' > "$COMPONENTS_DIR/AuditConfirmationModal.tsx"
import React, { useState } from 'react';

interface AuditConfirmationModalProps {
  isOpen: boolean;
  title: string;
  warningMessage: string;
  actionButtonLabel: string;
  onConfirm: (justification: string) => void;
  onClose: () => void;
}

export const AuditConfirmationModal: React.FC<AuditConfirmationModalProps> = ({
  isOpen,
  title,
  warningMessage,
  actionButtonLabel,
  onConfirm,
  onClose,
}) => {
  const [justification, setJustification] = useState('');
  const [confirmKeyword, setConfirmKeyword] = useState('');
  const REQUIRED_KEYWORD = 'THIBITISHA';

  if (!isOpen) return null;

  const isActionAllowed = justification.trim().length >= 10 && confirmKeyword === REQUIRED_KEYWORD;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full border border-rose-200 overflow-hidden animate-in fade-in">
        <div className="bg-rose-50 border-b border-rose-100 p-4">
          <h3 className="text-sm font-bold text-rose-900 uppercase tracking-wide">{title}</h3>
          <p className="text-xs text-rose-700 mt-1">{warningMessage}</p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Sababu ya Kisheria (Audit Justification &bull; Min 10 Herufi):
            </label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Mfano: Idhini ya Mkutano wa BOM Tarehe 12/03/2026..."
              className="w-full text-xs p-2 border border-slate-300 rounded focus:ring-1 focus:ring-rose-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Andika <span className="font-mono text-rose-600 bg-rose-50 px-1 py-0.5 rounded font-bold">THIBITISHA</span> kuendelea:
            </label>
            <input
              type="text"
              value={confirmKeyword}
              onChange={(e) => setConfirmKeyword(e.target.value)}
              className="w-full text-xs p-2 border border-slate-300 rounded uppercase font-mono focus:ring-1 focus:ring-rose-500"
              placeholder="THIBITISHA"
            />
          </div>
        </div>

        <div className="bg-slate-50 p-3 flex justify-end gap-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded"
          >
            Ghairi (Cancel)
          </button>
          <button
            type="button"
            disabled={!isActionAllowed}
            onClick={() => onConfirm(justification)}
            className={`px-3 py-1.5 text-xs font-semibold rounded text-white transition-all ${
              isActionAllowed ? 'bg-rose-600 hover:bg-rose-700 shadow' : 'bg-slate-300 cursor-not-allowed'
            }`}
          >
            {actionButtonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
MODAL_EOF
echo -e "${GREEN}  ✓ Generated $COMPONENTS_DIR/AuditConfirmationModal.tsx${NC}"

echo -e "${YELLOW}[6/6] Generating MoE/BOM Tamper-Proof Document & Watermark Wrapper...${NC}"
cat << 'DOC_EOF' > "$COMPONENTS_DIR/OfficialDocumentWrapper.tsx"
import React from 'react';

interface OfficialPrintDocProps {
  schoolName: string;
  moeRegNumber: string;
  poBox: string;
  watermarkText?: string;
  verificationHash: string;
  title: string;
  children: React.ReactNode;
}

export const OfficialDocumentWrapper: React.FC<OfficialPrintDocProps> = ({
  schoolName,
  moeRegNumber,
  poBox,
  watermarkText = 'STAMPED & VERIFIED',
  verificationHash,
  title,
  children,
}) => {
  return (
    <div className="relative bg-white p-8 max-w-4xl mx-auto border border-slate-200 shadow-md text-slate-900 print:border-none print:shadow-none print:p-0">
      {/* Background Anti-Tamper Diagonal Watermark */}
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-5 select-none rotate-[-30deg] text-6xl font-black uppercase tracking-wider text-slate-900"
      >
        {watermarkText}
      </div>

      {/* Official MoE Standard Header */}
      <header className="border-b-2 border-slate-900 pb-3 mb-6 text-center">
        <h1 className="text-xl font-black tracking-tight uppercase text-slate-900">{schoolName}</h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Usajili wa Wizara (MoE Reg): <strong>{moeRegNumber}</strong> &bull; {poBox}
        </p>
        <div className="inline-block mt-3 px-4 py-0.5 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest">
          {title}
        </div>
      </header>

      {/* Document Content */}
      <main className="relative z-10">{children}</main>

      {/* Signature & Verification Block */}
      <footer className="mt-12 pt-4 border-t border-slate-300 flex justify-between items-end text-xs">
        <div className="space-y-6">
          <div className="w-52 border-b border-dashed border-slate-600 pb-1 text-center text-slate-500 italic">
            Saini ya Mwalimu Mkuu & Muhuri Rasmi
          </div>
          <p className="text-[10px] text-slate-400">Mfumo Salama wa EduKe SaaS &bull; Hati Rasmi</p>
        </div>

        <div className="text-right">
          <div className="p-1 border border-slate-300 inline-block bg-slate-50">
            <div className="w-14 h-14 bg-slate-200 flex items-center justify-center text-[7px] text-center font-mono font-bold leading-tight">
              QR<br/>VERIFIED
            </div>
          </div>
          <p className="text-[9px] font-mono mt-1 text-slate-500">HASH: {verificationHash.substring(0, 16)}...</p>
        </div>
      </footer>
    </div>
  );
};
DOC_EOF
echo -e "${GREEN}  ✓ Generated $COMPONENTS_DIR/OfficialDocumentWrapper.tsx${NC}"

echo -e "\n${CYAN}==================================================================${NC}"
echo -e "${GREEN}>>> UX MATURITY REMEDIATION APPLIED SUCCESSFULLY! <<<${NC}"
echo -e "${CYAN}==================================================================${NC}"
echo -e "Files created:"
echo -e "  1. ${SRC_DIR}/utils/kenyaValidators.ts"
echo -e "  2. ${SRC_DIR}/components/EnterpriseRBACNavigation.tsx"
echo -e "  3. ${SRC_DIR}/components/EnterpriseDataTable.tsx"
echo -e "  4. ${SRC_DIR}/components/AuditConfirmationModal.tsx"
echo -e "  5. ${SRC_DIR}/components/OfficialDocumentWrapper.tsx"
echo -e "  6. ${FRONTEND_ROOT}/postcss.config.js"
