import React from "react";
import Input from "../atoms/Input";

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}

export default function Label({ children, required = false, className = "", ...props }: LabelProps) {
  return (
    <label className={`label ${className}`} {...props}>
      {children}
      {required && <span className="text-kenyan-red ml-1" aria-label="required">*</span>}
    </label>
  );
}

interface FieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  helper?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  required,
  error,
  helper,
  children,
  className = "",
}: FieldProps) {
  return (
    <div className={`w-full space-y-1 ${className}`}>
      {label && <Label required={required}>{label}</Label>}
      {children}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
      {helper && !error && <p className="text-xs text-gray-500">{helper}</p>}
    </div>
  );
}

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  placeholder?: string;
  className?: string;
}

export function SearchInput({ placeholder, className = "", ...props }: SearchInputProps) {
  return (
    <Input
      placeholder={placeholder ?? "Search..."}
      className={`pl-10 pr-4 ${className}`}
      {...props}
    />
  );
}
