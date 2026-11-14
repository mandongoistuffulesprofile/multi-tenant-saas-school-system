export type CbcLevel = "EE1" | "EE2" | "ME1" | "ME2" | "AE1" | "AE2" | "BE1" | "BE2";
export type FourBandLevel = "EE" | "ME" | "AE" | "BE";

/**
 * Official KNEC 8-point boundaries for Upper Primary and Junior School.
 * Kept as a fallback only: the server is authoritative and exposes the
 * tenant-adjusted scale at /grading/levels. Do not hard-code these in screens
 * that a school administrator can reconfigure.
 */
export function percentToLevel(pct: number): CbcLevel {
  if (pct >= 90) return "EE1";
  if (pct >= 75) return "EE2";
  if (pct >= 58) return "ME1";
  if (pct >= 41) return "ME2";
  if (pct >= 31) return "AE1";
  if (pct >= 21) return "AE2";
  if (pct >= 11) return "BE1";
  return "BE2";
}

/** Classroom 4-band rubric used for PP1–Grade 3 and KPSEA/Grade 3. */
export function percentToBand(pct: number): FourBandLevel {
  if (pct >= 80) return "EE";
  if (pct >= 50) return "ME";
  if (pct >= 30) return "AE";
  return "BE";
}

export const EIGHT_POINT_LEVELS: CbcLevel[] = ["EE1", "EE2", "ME1", "ME2", "AE1", "AE2", "BE1", "BE2"];
export const FOUR_BAND_LEVELS: FourBandLevel[] = ["EE", "ME", "AE", "BE"];

export function pointsForLevel(level: string): number {
  return { EE1: 8, EE2: 7, ME1: 6, ME2: 5, AE1: 4, AE2: 3, BE1: 2, BE2: 1, EE: 4, ME: 3, AE: 2, BE: 1 }[level] ?? 0;
}

export function isLevel(v: string): v is CbcLevel {
  return EIGHT_POINT_LEVELS.includes(v as CbcLevel);
}
