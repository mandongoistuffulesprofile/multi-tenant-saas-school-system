import React from 'react';
import { FeesDesk } from './FeesDesk';

function resolveApiBase(): string | undefined {
  const v =
    (typeof process !== 'undefined' && process.env?.REACT_APP_API_BASE) ??
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_BASE || import.meta.env?.REACT_APP_API_BASE));
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export default function FeesDeskPage() {
  return <FeesDesk apiBase={resolveApiBase() ?? ''} />;
}
