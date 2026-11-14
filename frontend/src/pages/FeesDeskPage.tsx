import React from 'react';
import { FeesDesk } from './FeesDesk';

function resolveApiBase(): string | undefined {
  const v = import.meta.env.VITE_API_BASE || import.meta.env.REACT_APP_API_BASE;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export default function FeesDeskPage() {
  return <FeesDesk apiBase={resolveApiBase() ?? ''} />;
}
