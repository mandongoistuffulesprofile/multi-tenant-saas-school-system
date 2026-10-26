/**
 * Shared formatting helpers for Kenyan school data.
 *
 * Kept dependency-free so it can be used from any page or component.
 */

/** Format an amount as Kenyan shillings, e.g. 12500 -> "KES 12,500". */
export function formatKES(amount: number | string | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Mask a phone number for display: 0718786067 -> "0718***067". */
export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  const start = digits.slice(0, 4);
  const end = digits.slice(-3);
  return `${start}***${end}`;
}

/** Normalise a Kenyan phone number to the 2547XXXXXXXX / 2541XXXXXXXX format. */
export function normalizeKenyanPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

/** Format an ISO date as DD/MM/YYYY. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB");
}

export type CBCLevel = "EE" | "ME" | "AE" | "BE";

export interface CBCRubricConfig {
  label: string;
  score: number;
  badgeClass: string;
  description: string;
}

/**
 * CBC performance levels used by KICD / KNEC.
 * EE = Exceeding Expectation, ME = Meeting, AE = Approaching, BE = Below.
 */
export const CBC_RUBRIC_CONFIG: Record<CBCLevel, CBCRubricConfig> = {
  EE: {
    label: "Kuzidi Matarajio",
    score: 4,
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300",
    description: "Exceeding Expectation",
  },
  ME: {
    label: "Kufikia Matarajio",
    score: 3,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-300",
    description: "Meeting Expectation",
  },
  AE: {
    label: "Kukaribia Matarajio",
    score: 2,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
    description: "Approaching Expectation",
  },
  BE: {
    label: "Chini ya Matarajio",
    score: 1,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-300",
    description: "Below Expectation",
  },
};

export const CBC_LEVELS: CBCLevel[] = ["EE", "ME", "AE", "BE"];
