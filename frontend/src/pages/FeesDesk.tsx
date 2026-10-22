import React, { useState } from 'react';
import { EnterpriseDataTable, Column } from '../components/EnterpriseDataTable';
import { AuditConfirmationModal } from '../components/AuditConfirmationModal';
import { formatKES } from '../utils/kenyaFormatters';

interface FeeRecord {
  id: string;
  admission_number: string;
  student_name: string;
  grade: string;
  tuition_balance: number;
  lunch_balance: number;
  total_balance: number;
  last_mpesa_ref: string;
}

const INITIAL_FEES: FeeRecord[] = [
  { id: '1', admission_number: 'ADM-4102', student_name: 'Wanjiku Kamau', grade: 'Grade 7', tuition_balance: 0, lunch_balance: 1500, total_balance: 1500, last_mpesa_ref: 'RKD9821X9A' },
  { id: '2', admission_number: 'ADM-4109', student_name: 'Brian Kiprop', grade: 'Grade 8', tuition_balance: 4500, lunch_balance: 2000, total_balance: 6500, last_mpesa_ref: 'QKD712XY6Z' },
  { id: '3', admission_number: 'ADM-4115', student_name: 'Faith Achieng', grade: 'Grade 7', tuition_balance: 12000, lunch_balance: 3000, total_balance: 15000, last_mpesa_ref: 'SDF4190KL2' },
  { id: '4', admission_number: 'ADM-4120', student_name: 'Emmanuel Mutua', grade: 'Grade 9', tuition_balance: 0, lunch_balance: 0, total_balance: 0, last_mpesa_ref: 'TKL61298OP' },
];

export const FeesDesk: React.FC = () => {
  const [feesData, setFeesData] = useState<FeeRecord[]>(INITIAL_FEES);
  const [selectedRecord, setSelectedRecord] = useState<FeeRecord | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [auditLogNotification, setAuditLogNotification] = useState<string | null>(null);

  const handleOpenWaiver = (record: FeeRecord) => {
    setSelectedRecord(record);
    setIsModalOpen(true);
  };

  const handleConfirmWaiver = (justification: string) => {
    if (!selectedRecord) return;
    setFeesData((prev) =>
      prev.map((item) =>
        item.id === selectedRecord.id ? { ...item, tuition_balance: 0, total_balance: item.lunch_balance } : item
      )
    );
    setIsModalOpen(false);
    setAuditLogNotification(
      `✓ Hatua ya ukaguzi imerekodiwa kwa ${selectedRecord.student_name}: Ada imeondolewa. Sababu: "${justification}"`
    );
    setTimeout(() => setAuditLogNotification(null), 6000);
  };

  const columns: Column<FeeRecord>[] = [
    { key: 'admission_number', header: 'Nambari ya Usajili' },
    { key: 'student_name', header: 'Jina la Mwanafunzi' },
    { key: 'grade', header: 'Darasa' },
    {
      key: 'tuition_balance',
      header: 'Masomo (Tuition)',
      render: (r) => <span className="font-mono">{formatKES(r.tuition_balance)}</span>,
    },
    {
      key: 'lunch_balance',
      header: 'Chakula (Lunch)',
      render: (r) => <span className="font-mono">{formatKES(r.lunch_balance)}</span>,
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
      key: 'last_mpesa_ref',
      header: 'Kumbukumbu ya M-Pesa',
      render: (r) => <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{r.last_mpesa_ref}</span>,
    },
    {
      key: 'actions',
      header: 'Hatua (Actions)',
      render: (r) => (
        <button
          onClick={() => handleOpenWaiver(r)}
          disabled={r.tuition_balance === 0}
          className="px-2 py-1 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-40"
        >
          Omba Msamaha (Waiver)
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-900">Usimamizi wa Ada & Daraja M-Pesa Paybill</h2>
          <p className="text-xs text-slate-500">Ugawaji wa Ada kwa Vote-heads (Tuition, Boarding, Lunch, PTA)</p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-500">Paybill ya Shule:</span>
          <div className="text-sm font-mono font-bold text-emerald-600">522123 &bull; Acc: [ADM-NO]</div>
        </div>
      </div>

      {auditLogNotification && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded font-medium animate-in fade-in">
          {auditLogNotification}
        </div>
      )}

      <EnterpriseDataTable
        data={feesData}
        columns={columns}
        searchPlaceholder="Tafuta kwa nambari ya usajili, jina au M-Pesa..."
        filenameExport="Ripoti_ya_Ada_Term1.csv"
      />

      <AuditConfirmationModal
        isOpen={isModalOpen}
        title="Idhini ya Msamaha wa Ada (Fee Waiver Authorization)"
        warningMessage="Hatua hii itapunguza salio la mwanafunzi na itahitaji idhini ya Mkutano wa BOM."
        actionButtonLabel="Thibitisha Msamaha"
        onConfirm={handleConfirmWaiver}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};
