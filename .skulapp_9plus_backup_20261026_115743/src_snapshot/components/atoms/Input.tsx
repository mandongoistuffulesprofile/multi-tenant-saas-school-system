import React, { useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
  fullWidth?: boolean;
}

export default function Input({
  label,
  error,
  helper,
  fullWidth = false,
  className = "",
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = props.id || generatedId;
  return (
    <div className={`${fullWidth ? "w-full" : ""} ${className}`}>
      {label && <label className="label" htmlFor={inputId}>
        {label}
      </label>}
      <input
        id={inputId}
        {...props}
        className={`input-field ${error ? "border-red-500 focus:ring-red-500 focus:border-red-500" : ""} ${className}`}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-red-600 mt-1" role="alert">
          {error}
        </p>
      )}
      {helper && !error && <p className="text-xs text-gray-500 mt-1">{helper}</p>}
    </div>
  );
}
