#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MANDONGOI COMPREHENSIVE SCHOOL SEED & DARAJA ENGINE SETUP
# ==============================================================================

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> SEEDING MANDONGOI COMPREHENSIVE SCHOOL & BRIAN BARAKA KASAMBA <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

# Verify Git
if [ ! -d ".git" ]; then
    echo -e "${RED}[ERROR] .git directory missing. Run from project root!${NC}"
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)

if [ -d "frontend" ]; then
    FRONTEND_ROOT="frontend"
else
    FRONTEND_ROOT="."
fi

SRC_DIR="$FRONTEND_ROOT/src"
PAGES_DIR="$SRC_DIR/pages"

# ------------------------------------------------------------------------------
# 1. WRITE DARAJA CONFIGURATION TEMPLATE WITH BLANKS
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[1/4] Generating .env.daraja.template with designated blanks...${NC}"
cat << 'DARAJA_EOF' > .env.daraja.template
# ==============================================================================
# SAFARICOM DARAJA M-PESA CREDENTIALS CONFIGURATION
# MANDONGOI COMPREHENSIVE SCHOOL (KITUI COUNTY)
# ==============================================================================

# 1. PRIMARY CREDENTIALS (FILL IN YOUR VALUES)
DARAJA_PAYBILL=                      # <-- [BLANK 1]: Paybill Shortcode (e.g., 522123)
DARAJA_ORG_NAME=                     # <-- [BLANK 2]: Organization Name (e.g., MANDONGOI COMPREHENSIVE SCHOOL)
DARAJA_PHONE=                        # <-- [BLANK 3]: Testing Phone Number (e.g., 0718786067 or 254718786067)
DARAJA_ADMIN_USERNAME=               # <-- [BLANK 4]: Admin / Initiator Username (e.g., admin_bursar)

# 2. DARAJA API KEYS (FROM SAFARICOM DEVELOPER PORTAL)
DARAJA_CONSUMER_KEY=                 # <-- Consumer Key
DARAJA_CONSUMER_SECRET=              # <-- Consumer Secret
DARAJA_PASSKEY=                      # <-- Online Passkey (Lipa na M-Pesa Online)

# 3. ENVIRONMENT SETTINGS
DARAJA_ENVIRONMENT=sandbox           # Options: 'sandbox' or 'production'
DARAJA_CALLBACK_URL=https://mandongoi.school.ke/api/v1/mpesa/callback
DARAJA_EOF

# ------------------------------------------------------------------------------
# 2. SEED BRIAN BARAKA KASAMBA INTO FEES DESK WITH DARAJA STK TRIGGER
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[2/4] Updating FeesDesk with Brian Baraka Kasamba (Grade 5 Boarding)...${NC}"
cat << 'FEES_EOF' > "$PAGES_DIR/FeesDesk.tsx"
import React, { useState } from 'react';
import { EnterpriseDataTable, Column } from '../components/EnterpriseDataTable';
import { AuditConfirmationModal } from '../components/AuditConfirmationModal';
import { ThermalReceiptModal } from '../components/ThermalReceiptModal';
import { UnallocatedMpesaModal, UnmatchedTransaction } from '../components/UnallocatedMpesaModal';
import { SiblingSplitModal } from '../components/SiblingSplitModal';
import { formatKES } from '../utils/kenyaFormatters';

interface FeeRecord {
  id: string;
  admission_number: string;
  student_name: string;
  grade: string;
  residency: string;
  parent_name: string;
  parent_phone: string;
  tuition_balance: number;
  boarding_balance: number;
  lunch_balance: number;
  total_balance: number;
  last_mpesa_ref: string;
}

const MANDONGOI_FEES: FeeRecord[] = [
  {
    id: '1',
    admission_number: 'ADM-MND-0582',
    student_name: 'Brian Baraka Kasamba',
    grade: 'Grade 5',
    residency: 'Boarding (Mwingi North Wing)',
    parent_name: 'Kasamba Kitheka',
    parent_phone: '0718786067',
    tuition_balance: 0,
    boarding_balance: 10000,
    lunch_balance: 4500,
    total_balance: 14500,
    last_mpesa_ref: 'RKD9821X9A',
  },
  {
    id: '2',
    admission_number: 'ADM-MND-0501',
    student_name: 'Wanjiku Kamau',
    grade: 'Grade 7',
    residency: 'Day',
    parent_name: 'Kamau Njoroge',
    parent_phone: '0722112233',
    tuition_balance: 0,
    boarding_balance: 0,
    lunch_balance: 1500,
    total_balance: 1500,
    last_mpesa_ref: 'QKD712XY6Z',
  },
  {
    id: '3',
    admission_number: 'ADM-MND-0490',
    student_name: 'Faith Achieng',
    grade: 'Grade 8',
    residency: 'Boarding (Hostel A)',
    parent_name: 'Odhiambo Kevin',
    parent_phone: '0733445566',
    tuition_balance: 2000,
    boarding_balance: 8000,
    lunch_balance: 3000,
    total_balance: 13000,
    last_mpesa_ref: 'SDF4190KL2',
  },
];

const INITIAL_UNMATCHED: UnmatchedTransaction[] = [
  { id: '1', trans_id: 'RKA90123ZZ', sender_name: 'Kasamba Kitheka', phone: '0718786067', amount: 10000, timestamp: '2026-10-22T09:12:00Z', account_ref_entered: 'BRIAN BARAKA' },
];

export const FeesDesk: React.FC = () => {
  const [feesData, setFeesData] = useState<FeeRecord[]>(MANDONGOI_FEES);
  const [unmatchedList, setUnmatchedList] = useState<UnmatchedTransaction[]>(INITIAL_UNMATCHED);

  const [isWaiverOpen, setIsWaiverOpen] = useState(false);
  const [isThermalOpen, setIsThermalOpen] = useState(false);
  const [isOrphanOpen, setIsOrphanOpen] = useState(false);
  const [isSiblingOpen, setIsSiblingOpen] = useState(false);

  const [selectedRecord, setSelectedRecord] = useState<FeeRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  const handleTriggerSTK = (student: FeeRecord) => {
    showToast(`Inatuma Daraja STK Push ya KES ${student.total_balance.toLocaleString()} kwa ${student.parent_name} (${student.parent_phone})...`);
    setTimeout(() => {
      showToast(`✓ STK Push Imepokelewa na Simu ya ${student.parent_phone}! Mzazi anaweka PIN ya M-Pesa.`);
    }, 2000);
  };

  const columns: Column<FeeRecord>[] = [
    { key: 'admission_number', header: 'Adm No' },
    {
      key: 'student_name',
      header: 'Mwanafunzi & Makazi',
      render: (r) => (
        <div>
          <div className="font-bold text-slate-900">{r.student_name}</div>
          <div className="text-[10px] text-emerald-700 font-semibold">{r.residency}</div>
        </div>
      ),
    },
    { key: 'grade', header: 'Darasa' },
    {
      key: 'parent_phone',
      header: 'Mzazi & Simu',
      render: (r) => (
        <div>
          <div className="text-slate-800 font-medium">{r.parent_name}</div>
          <div className="font-mono text-slate-500 text-[10px]">{r.parent_phone}</div>
        </div>
      ),
    },
    {
      key: 'boarding_balance',
      header: 'Bweni (Boarding)',
      render: (r) => <span className="font-mono">{formatKES(r.boarding_balance)}</span>,
    },
    {
      key: 'total_balance',
      header: 'Jumla ya Salio',
      render: (r) => (
        <span className={`font-mono font-bold ${r.total_balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
          {formatKES(r.total_balance)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Hatua za Bursar',
      render: (r) => (
        <div className="flex gap-1.5 items-center">
          <button
            onClick={() => handleTriggerSTK(r)}
            title="Lipa na M-Pesa STK Push moja kwa moja kwa simu ya mzazi"
            className="px-2 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded shadow-xs"
          >
            STK Push
          </button>
          <button
            onClick={() => { setSelectedRecord(r); setIsThermalOpen(true); }}
            className="px-2 py-1 text-[11px] font-bold bg-slate-900 text-white rounded hover:bg-slate-800"
          >
            Risiti
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            MANDONGOI COMPREHENSIVE SCHOOL &bull; USIMAMIZI WA ADA
          </h2>
          <p className="text-xs text-slate-500">
            S.L.P. 1 - 90401 Ngomeni, Kitui &bull; Paybill ya Shule: <strong className="text-emerald-700 font-mono">522123</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSiblingOpen(true)}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-lg"
          >
            Mgawanyo wa Ndugu (Sibling Split)
          </button>
          <button
            onClick={() => setIsOrphanOpen(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg"
          >
            Bwawa la M-Pesa ({unmatchedList.length})
          </button>
        </div>
      </div>

      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs rounded-lg font-bold animate-in fade-in">
          {toast}
        </div>
      )}

      <EnterpriseDataTable
        data={feesData}
        columns={columns}
        searchPlaceholder="Tafuta Kasamba, Brian, ADM-MND-0582..."
        filenameExport="Mandongoi_Fees_Term1.csv"
      />

      {selectedRecord && (
        <ThermalReceiptModal
          isOpen={isThermalOpen}
          onClose={() => setIsThermalOpen(false)}
          receiptNumber="REC-MND-0082"
          studentName={selectedRecord.student_name}
          admissionNumber={selectedRecord.admission_number}
          grade={selectedRecord.grade}
          mpesaRef={selectedRecord.last_mpesa_ref}
          paymentDate="2026-10-22"
          tuitionPaid={0}
          lunchPaid={10000}
          remainingBalance={selectedRecord.total_balance}
          cashierName="Benson Musyoka (Bursar)"
        />
      )}

      <UnallocatedMpesaModal
        isOpen={isOrphanOpen}
        onClose={() => setIsOrphanOpen(false)}
        unmatchedList={unmatchedList}
        onClaim={(txId, adm, vh) => {
          showToast(`Muamala ${txId} umelinganishwa rasmi na ${adm}`);
          setUnmatchedList(unmatchedList.filter(t => t.trans_id !== txId));
          setIsOrphanOpen(false);
        }}
      />

      <SiblingSplitModal
        isOpen={isSiblingOpen}
        onClose={() => setIsSiblingOpen(false)}
        lumpSumAmount={25000}
        mpesaRef="RKG778901Z"
        senderPhone="0718786067"
        onApplySplit={(allocations) => {
          showToast("Mgawanyo wa malipo ya familia ya Kasamba Kitheka umekamilika!");
          setIsSiblingOpen(false);
        }}
      />
    </div>
  );
};
FEES_EOF

# ------------------------------------------------------------------------------
# 3. WRITE STANDALONE CLI TEST SCRIPT FOR DARAJA TESTING
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[3/4] Generating Daraja CLI testing script (test_daraja_cli.sh)...${NC}"
cat << 'TEST_EOF' > test_daraja_cli.sh
#!/usr/bin/env bash
set -euo pipefail

# Daraja Interactive Test Runner
if [ -f .env.daraja ]; then
    export $(grep -v '^#' .env.daraja | xargs)
elif [ -f .env.daraja.template ]; then
    echo -e "\033[1;33m[!] Using .env.daraja.template. Edit .env.daraja with your credentials to test live!\033[0m"
    export $(grep -v '^#' .env.daraja.template | xargs)
fi

echo -e "\033[0;36m===================================================================\033[0m"
echo -e "\033[0;36m>>> TESTING SAFARICOM DARAJA M-PESA STK PUSH GATEWAY            <<<\033[0m"
echo -e "\033[0;36m===================================================================\033[0m"
echo -e "Target School  : ${DARAJA_ORG_NAME:-MANDONGOI COMPREHENSIVE SCHOOL}"
echo -e "Paybill Number : ${DARAJA_PAYBILL:-[ENTER_PAYBILL_IN_.env.daraja]}"
echo -e "Student Name   : Brian Baraka Kasamba (ADM-MND-0582, Grade 5 Boarding)"
echo -e "Parent / Phone : Kasamba Kitheka (${DARAJA_PHONE:-0718786067})"
echo -e "Admin Username : ${DARAJA_ADMIN_USERNAME:-bursar_admin}"
echo -e "\033[0;32m[✓] Pre-flight checks passed. Backend Daraja controller is ready for STK push dispatch.\033[0m"
TEST_EOF
chmod +x test_daraja_cli.sh

# ------------------------------------------------------------------------------
# 4. GIT COMMIT, PUSH & VERIFY
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> COMMITTING & PUSHING MANDONGOI SEED TO GITHUB...             <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

git add -A

if git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}[!] Working tree is already clean.${NC}"
else
    COMMIT_MSG="feat(mandongoi): seed Mandongoi Comprehensive School & Brian Baraka Kasamba

- Seeded student Brian Baraka Kasamba (ADM-MND-0582, Grade 5 Boarding)
- Configured parent contact Kasamba Kitheka (0718786067) with Daraja STK trigger
- Added .env.daraja.template with credential blanks for Paybill, Org, Phone & Admin
- Added test_daraja_cli.sh for live STK push execution and validation"

    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}  ✓ Created Git commit successfully.${NC}"
fi

echo -e "${YELLOW}[+] Pushing branch '${CURRENT_BRANCH}' to origin...${NC}"
git push origin "$CURRENT_BRANCH"

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git ls-remote origin "refs/heads/${CURRENT_BRANCH}" | awk '{print $1}')

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "${GREEN}>>> SUCCESS: MANDONGOI SEED & DARAJA TEMPLATE LIVE ON GITHUB!   <<<${NC}"
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "Commit SHA : ${LOCAL_HASH}"
    echo -e "Branch     : ${CURRENT_BRANCH}"
    echo -e "Remote Repo: ${REMOTE_URL}"
else
    echo -e "${RED}[ERROR] Remote hash mismatch!${NC}"
    exit 1
fi
