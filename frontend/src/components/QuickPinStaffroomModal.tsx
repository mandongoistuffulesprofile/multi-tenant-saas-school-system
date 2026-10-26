import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface Props {
  isOpen: boolean;
  currentUser: string;
  onUnlock: (pin: string) => boolean;
  onSwitchUser: () => void;
}

export const QuickPinStaffroomModal: React.FC<Props> = ({
  isOpen,
  currentUser,
  onUnlock,
  onSwitchUser,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPin(nextPin);
      if (nextPin.length === 4) {
        const success = onUnlock(nextPin);
        if (!success) {
          setError(true);
          setTimeout(() => {
            setPin('');
            setError(false);
          }, 600);
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xs w-full p-6 text-center text-white shadow-2xl">
        <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3 font-bold text-lg">
          <Lock className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-sm font-bold tracking-tight uppercase">Kompyuta ya Walimu (Staffroom)</h3>
        <p className="text-xs text-slate-400 mt-1">
          Kipindi cha: <strong className="text-emerald-400">{currentUser}</strong>
        </p>

        {/* PIN Indicators */}
        <div className="flex justify-center gap-3 my-6">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={`w-3.5 h-3.5 rounded-full border transition-all ${
                pin.length > idx
                  ? 'bg-emerald-400 border-emerald-400 scale-110 shadow-sm shadow-emerald-400/50'
                  : 'border-slate-700 bg-slate-800'
              } ${error ? 'border-rose-500 bg-rose-500/30' : ''}`}
            />
          ))}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 text-base font-bold">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-emerald-600 transition-colors flex items-center justify-center"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin('')}
            className="h-12 rounded-xl bg-slate-800/40 text-slate-400 hover:bg-slate-800 text-xs font-semibold"
          >
            Futa
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-emerald-600"
          >
            0
          </button>
          <button
            type="button"
            onClick={onSwitchUser}
            className="h-12 rounded-xl bg-slate-800/40 text-slate-400 hover:bg-slate-800 text-xs font-semibold"
          >
            Badili
          </button>
        </div>
      </div>
    </div>
  );
};
