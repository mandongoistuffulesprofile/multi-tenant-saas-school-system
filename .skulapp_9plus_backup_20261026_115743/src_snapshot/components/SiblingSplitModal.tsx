import React, { useState } from 'react';
import { formatKES } from '../utils/kenyaFormatters';

interface SiblingSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  lumpSumAmount: number;
  mpesaRef: string;
  senderPhone: string;
  onApplySplit: (allocations: { admNo: string; amount: number; votehead: string }[]) => void;
}

export const SiblingSplitModal: React.FC<SiblingSplitModalProps> = ({
  isOpen,
  onClose,
  lumpSumAmount,
  mpesaRef,
  senderPhone,
  onApplySplit,
}) => {
  const [splits, setSplits] = useState([
    { admNo: 'ADM-4102', studentName: 'Wanjiku Kamau (Grade 7)', amount: 15000, votehead: 'Tuition' },
    { admNo: 'ADM-4109', studentName: 'Brian Kiprop (Grade 8)', amount: 10000, votehead: 'Tuition' },
  ]);

  if (!isOpen) return null;

  const currentTotal = splits.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const remaining = lumpSumAmount - currentTotal;

  const handleExecute = () => {
    if (remaining !== 0) return;
    onApplySplit(splits.map(s => ({ admNo: s.admNo, amount: Number(s.amount), votehead: s.votehead })));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 text-white p-4">
          <h3 className="text-sm font-bold uppercase tracking-wide">Mgawanyo wa Ada kwa Ndugu (Sibling Payment Split)</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            M-Pesa Ref: <strong className="text-emerald-400 font-mono">{mpesaRef}</strong> &bull; Simu: {senderPhone}
          </p>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-500">Jumla Iliyopokelewa:</span>
              <div className="font-bold font-mono text-base text-slate-900">{formatKES(lumpSumAmount)}</div>
            </div>
            <div className="text-right">
              <span className="text-slate-500">Kiasi Kilichobaki Kugawa:</span>
              <div className={`font-bold font-mono text-base ${remaining === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatKES(remaining)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {splits.map((s, idx) => (
              <div key={idx} className="p-3 bg-white border border-slate-200 rounded-lg space-y-2">
                <div className="font-bold text-slate-800">{s.studentName} ({s.admNo})</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-500">Kiasi cha Kugawa (KES):</label>
                    <input
                      type="number"
                      value={s.amount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setSplits(prev => prev.map((item, i) => i === idx ? { ...item, amount: val } : item));
                      }}
                      className="w-full p-1.5 border rounded font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500">Vote-head:</label>
                    <select
                      value={s.votehead}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSplits(prev => prev.map((item, i) => i === idx ? { ...item, votehead: v } : item));
                      }}
                      className="w-full p-1.5 border rounded bg-white"
                    >
                      <option value="Tuition">Tuition (Masomo)</option>
                      <option value="Lunch">Lunch (Chakula)</option>
                      <option value="PTA">PTA Fund</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700">
              Ghairi
            </button>
            <button
              type="button"
              disabled={remaining !== 0}
              onClick={handleExecute}
              className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40"
            >
              Kamilisha Mgawanyo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
