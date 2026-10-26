import React from "react";
import {
  CBC_LEVELS,
  CBC_RUBRIC_CONFIG,
  type CBCLevel,
} from "../utils/kenyaFormatters";

interface CBCRubricSelectorProps {
  value: CBCLevel | null;
  onChange: (level: CBCLevel) => void;
  disabled?: boolean;
}

/**
 * Segmented control for the four CBC performance levels.
 * Used in the assessment grid so teachers can record a level per learner.
 */
export const CBCRubricSelector: React.FC<CBCRubricSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => (
  <div className="inline-flex rounded-md border border-slate-300 overflow-hidden" role="group">
    {CBC_LEVELS.map((level) => {
      const config = CBC_RUBRIC_CONFIG[level];
      const selected = value === level;
      return (
        <button
          key={level}
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          title={`${config.description} (${config.score}/4)`}
          onClick={() => onChange(level)}
          className={`px-2 py-1 text-[11px] font-bold border-r border-slate-200 last:border-r-0 transition-colors ${
            selected
              ? config.badgeClass
              : "bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          }`}
        >
          {level}
        </button>
      );
    })}
  </div>
);

export default CBCRubricSelector;
