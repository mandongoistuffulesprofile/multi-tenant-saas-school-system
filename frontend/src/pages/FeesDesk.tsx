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
