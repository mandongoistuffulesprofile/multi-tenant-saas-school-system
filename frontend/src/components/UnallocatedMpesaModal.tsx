import React, { useEffect, useState } from "react";
import { formatKES, maskPhoneNumber } from "../utils/kenyaFormatters";

export interface UnmatchedTransaction {
  id: string;
  trans_id: string;
  sender_name: string;
  phone: string;
  amount: number;
  timestamp: string;
  account_ref_entered: string;
}

interface MatchCandidate {
  learner_id: string;
  admission_number: string;
  learner_name: string;
  guardian_phone?: string;
  confidence_score: number;
  match_basis: string;
}

interface UnallocatedMpesaModalProps {
  isOpen: boolean;
  onClose: () => void;
  unmatchedList: UnmatchedTransaction[];
  /** Called when a bursar links a transaction to a learner and votehead. */
  onClaim: (transId: string, admissionNumber: string, votehead: string) => void;
  /** Base URL for the real API when available. Falls back to manual entry. */
  apiBase?: string;
}

/**
 * Review queue for M-Pesa payments that could not be auto-matched to a learner
 * (wrong account reference, partial name, or an unknown sender).
 *
 * When apiBase is provided and the backend exposes the holding tank match
 * endpoint, the modal fetches ranked candidates for the selected transaction
 * and lets the bursar choose one directly. Otherwise it keeps the existing
 * manual admission-number entry so it still works in demo/mock environments.
 */
export const UnallocatedMpesaModal: React.FC<UnallocatedMpesaModalProps> = ({
  isOpen,
  onClose,
  unmatchedList,
  onClaim,
  apiBase = "",
}) => {
  const [admission, setAdmission] = useState("");
  const [votehead, setVotehead] = useState("Tuition");
  const [selected, setSelected] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAdmission("");
      setVotehead("Tuition");
      setSelected(null);
      setCandidates([]);
      setCandidateError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selected || !apiBase) {
      setCandidates([]);
      setCandidateError(null);
      return;
    }
    const controller = new AbortController();

    const fetchCandidates = async () => {
      setCandidateLoading(true);
      setCandidateError(null);
      try {
        const res = await fetch(`${apiBase}/holding-tank/${encodeURIComponent(selected)}/match`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`match request failed`);
        }
        const data: MatchCandidate[] = await res.json();
        setCandidates(Array.isArray(data) ? data : []);
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        setCandidateError("Could not load matches. Enter the admission number manually.");
        setCandidates([]);
      } finally {
        setCandidateLoading(false);
      }
    };

    fetchCandidates();
    return () => controller.abort();
  }, [isOpen, selected, apiBase]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between bg-slate-900 text-white px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">M-Pesa Zisizolingana</h3>
            <p className="text-[11px] text-slate-300">
              Chagua muamala kisha ulinganishe na mwanafunzi.
            </p>
          </div>
          <button onClick={onClose} className="text-xs font-bold text-slate-300 hover:text-white">
            Funga
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
          {unmatchedList.length === 0 && (
            <p className="p-4 text-xs text-slate-500">Hakuna malipo yasiyolingana.</p>
          )}
          {unmatchedList.map((tx) => (
            <button
              key={tx.id}
              type="button"
              onClick={() => setSelected(tx.trans_id)}
              className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                selected === tx.trans_id ? "bg-emerald-50" : "hover:bg-slate-50"
              }`}
            >
              <div className="flex justify-between font-semibold text-slate-900">
                <span>{tx.sender_name}</span>
                <span>{formatKES(tx.amount)}</span>
              </div>
              <div className="mt-1 flex justify-between text-slate-500">
                <span className="font-mono">{tx.trans_id}</span>
                <span>{maskPhoneNumber(tx.phone)}</span>
              </div>
              <div className="mt-0.5 text-slate-500">
                Ref: <span className="font-mono">{tx.account_ref_entered}</span>
              </div>
            </button>
          ))}
        </div>

                  <div className={`border-t border-slate-200 p-4 flex flex-wrap items-end gap-2 bg-slate-50 ${candidateLoading ? "opacity-60" : ""}`}>
            {candidateLoading && (
              <div className="w-full text-center text-[11px] text-slate-500">Inaandikwa orodha ya watu inaweza kupokea...</div>
            )}
            {candidateError && (
              <div className="w-full text-[11px] text-rose-700">{candidateError}</div>
            )}
            {!candidateLoading && candidates.length > 0 && (
              <div className="w-full text-[11px] text-slate-600 mb-2">
                Matakwa inaweza kukaa kati ya watu wa mwanafunzi:
              </div>
            )}
            {candidates.length > 0 && (
              <div className="w-full max-w-xs space-y-1">
                {candidates.map((c) => (
                  <button
                    key={c.learner_id}
                    type="button"
                    className={`w-full text-left text-[11px] rounded p-2 border transition-colors ${
                      admission === c.admission_number ? "bg-emerald-50 border-emerald-400" : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                    onClick={() => setAdmission(c.admission_number)}
                  >
                    <div className="font-semibold text-slate-900">{c.learner_name}</div>
                    <div className="text-slate-500">{c.admission_number}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {c.match_basis} &bull; {Math.round(c.confidence_score * 100)}%
                    </div>
                  </button>
                ))}
              </div>
            )}
            {candidates.length === 0 && !candidateLoading && candidateError && (
              <div className="w-full text-[11px] text-slate-500">
                Hakuna matakwa yaliyopangwa. Weka namba ya usajili ya k hand.
              </div>
            )}
            <label className="text-[11px] font-semibold text-slate-600">
              Namba ya Usajili
              <input
                value={admission}
                onChange={(e) => setAdmission(e.target.value.toUpperCase())}
                placeholder={candidates.length > 0 ? "Chagua au weka namba..." : "ADM-MND-0582"}
                className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-xs uppercase"
              />
            </label>
            <label className="text-[11px] font-semibold text-slate-600">
              Kichwa cha Ada
              <select
                value={votehead}
                onChange={(e) => setVotehead(e.target.value)}
                className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-xs bg-white"
              >
                <option>Tuition</option>
                <option>Lunch</option>
                <option>Boarding</option>
                <option>Activity</option>
              </select>
            </label>
            <button
              type="button"
              disabled={!selected || !admission.trim()}
              onClick={() => selected && onClaim(selected, admission.trim(), votehead)}
              className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              Linganisha
            </button>
          </div>
      </div>
    </div>
  );
};

export default UnallocatedMpesaModal;
