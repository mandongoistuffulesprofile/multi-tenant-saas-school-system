import React, { ReactNode } from "react";

interface TopBarProps {
  /** Left cluster: brand + sidebar toggle. */
  left?: ReactNode;
  /** Center cluster: tenant context / school code. */
  center?: ReactNode;
  /** Right cluster: role, language toggle, sign-out. */
  right?: ReactNode;
  /** Optional impersonation banner rendered above the bar. */
  banner?: ReactNode;
  className?: string;
}

/**
 * Shared application header shell. Layout and SaaSLayout both re-implemented
 * the same sticky / border-b / flex justify-between markup; this component
 * owns that shell and the layouts pass their unique content as slots.
 */
export default function TopBar({ left, center, right, banner, className = "" }: TopBarProps) {
  return (
    <header className={`sticky top-0 z-40 bg-white border-b border-gray-200 print:hidden ${className}`}>
      {banner}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">{left}</div>
        <div className="hidden md:flex items-center gap-4">{center}</div>
        <div className="flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}