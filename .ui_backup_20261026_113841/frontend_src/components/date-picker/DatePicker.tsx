import React, { useState, useEffect, ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  required?: boolean;
  className?: string;
  error?: string;
}

export default function DatePicker({
  value,
  onChange,
  label,
  placeholder,
  min,
  max,
  required = false,
  className = "",
  error,
}: DatePickerProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (min && value && value < min) {
      onChange("");
    }
  }, [min, value, onChange]);

  return (
    <div className="space-y-2">
      {label && (
        <label
          className="label"
          htmlFor="date-picker"
          aria-required={required}
        >
          {label}
          {required && <span className="text-kenyan-red" aria-hidden="true"> *</span>}
        </label>
      )}
      <div className="relative">
        <input
          id="date-picker"
          type="date"
          className={`input-field pr-12 ${className} ${error ? "border-red-500 focus:ring-red-500" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          min={min ?? undefined}
          max={max ?? undefined}
          required={required}
          placeholder={placeholder}
          aria-invalid={error ? "true" : "false"}
          {...(error ? { "aria-describedby": "date-picker-error" } : {})}
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-kenyan-red transition"
          aria-label={t("auth.open_date_picker") ?? "Open date picker"}
          aria-controls="date-picker"
          tabIndex={-1}
        >
          📅
        </button>
      </div>
      {error && (
        <p id="date-picker-error" className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
