import { useId } from "react";
import { Info } from "lucide-react";

/**
 * Short, contextual guidance for a label or metric.
 *
 * Works on hover and keyboard focus; the description is exposed through
 * aria-describedby rather than being visual-only. Keep copy to one or two
 * sentences and tied to the real backend rule it explains.
 */
export default function HelpTip({ text }: { text: string }) {
  const id = useId();

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label="More information"
        aria-describedby={id}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/30"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-normal leading-5 text-slate-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
