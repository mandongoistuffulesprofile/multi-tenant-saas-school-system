import React from "react";
import { formatKES } from "../utils/kenyaFormatters";

interface ThermalReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptNumber: string;
  studentName: string;
  admissionNumber: string;
  grade: string;
  mpesaRef: string;
  paymentDate: string;
  tuitionPaid: number;
  lunchPaid: number;
  remainingBalance: number;
  cashierName: string;
  schoolName?: string;
}

/**
 * 80mm thermal-printer style receipt.
 *
 * The markup is deliberately narrow and monochrome so it prints correctly from
 * a bursar's desk printer as well as on screen.
 */
export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  isOpen,
  onClose,
  receiptNumber,
  studentName,
  admissionNumber,
  grade,
  mpesaRef,
  paymentDate,
  tuitionPaid,
  lunchPaid,
  remainingBalance,
  cashierName,
  schoolName = "MANDONGOI COMPREHENSIVE SCHOOL",
}) => {
  if (!isOpen) return null;

  const total = Number(tuitionPaid) + Number(lunchPaid);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:bg-white print:p-0">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden print:shadow-none">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 print:hidden">
          <h3 className="text-xs font-bold text-slate-800">Risiti ya Malipo</h3>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-2 py-1 text-[11px] font-bold bg-slate-900 text-white rounded"
            >
              Chapisha
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 text-[11px] font-bold bg-slate-100 text-slate-700 rounded"
            >
              Funga
            </button>
          </div>
        </div>

        <div className="p-4 font-mono text-[11px] leading-relaxed text-slate-900">
          <div className="text-center">
            <p className="font-bold text-xs uppercase">{schoolName}</p>
            <p>Risiti ya Ada / Fee Receipt</p>
            <p className="mt-1">{receiptNumber}</p>
          </div>

          <div className="my-2 border-t border-dashed border-slate-400" />

          <div className="flex justify-between"><span>Mwanafunzi</span><span>{studentName}</span></div>
          <div className="flex justify-between"><span>Namba</span><span>{admissionNumber}</span></div>
          <div className="flex justify-between"><span>Darasa</span><span>{grade}</span></div>
          <div className="flex justify-between"><span>Tarehe</span><span>{paymentDate}</span></div>
          <div className="flex justify-between"><span>M-Pesa</span><span>{mpesaRef}</span></div>

          <div className="my-2 border-t border-dashed border-slate-400" />

          <div className="flex justify-between"><span>Ada (Tuition)</span><span>{formatKES(tuitionPaid)}</span></div>
          <div className="flex justify-between"><span>Chakula (Lunch)</span><span>{formatKES(lunchPaid)}</span></div>
          <div className="flex justify-between font-bold mt-1">
            <span>JUMLA</span>
            <span>{formatKES(total)}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Salio</span>
            <span>{formatKES(remainingBalance)}</span>
          </div>

          <div className="my-2 border-t border-dashed border-slate-400" />

          <p className="text-center">Alipokea: {cashierName}</p>
          <p className="text-center mt-1">Asante kwa kulipa ada kwa wakati.</p>
        </div>
      </div>
    </div>
  );
};

export default ThermalReceiptModal;
