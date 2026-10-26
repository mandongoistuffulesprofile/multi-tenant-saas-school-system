export type CbcLevel = 'EE1' | 'EE2' | 'ME1' | 'ME2' | 'AE1' | 'AE2' | 'BE1' | 'BE2';

export function percentToLevel(pct: number): CbcLevel {
  if (pct >= 90) return 'EE1';
  if (pct >= 75) return 'EE2';
  if (pct >= 65) return 'ME1';
  if (pct >= 50) return 'ME2';
  if (pct >= 40) return 'AE1';
  if (pct >= 30) return 'AE2';
  if (pct >= 20) return 'BE1';
  return 'BE2';
}

export function isLevel(v: string): v is CbcLevel {
  return ['EE1','EE2','ME1','ME2','AE1','AE2','BE1','BE2'].includes(v);
}
