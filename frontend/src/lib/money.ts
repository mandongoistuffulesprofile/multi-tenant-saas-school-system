// Exact decimal handling for money amounts.
//
// The API sends finance amounts as decimal strings ("123456789.12") precisely so
// clients do not round them through an IEEE-754 double. `Number(x)` discards
// that guarantee, so anything that displays, compares or totals an amount must
// go through here instead.
//
// The value is kept as the digits of the decimal integer ("12345678912") plus a
// scale (2), and arithmetic is done on those digit strings. That avoids both
// floating point drift and BigInt, which the bundle target (es2018) does not
// allow.
//
// Parsing accepts a string (preferred), a number (already-lossy at the source,
// accepted for form input) or null/undefined (treated as zero). Invalid input is
// also zero, matching the old `Number(x) || 0` behaviour.

export interface Money {
  /** Signed decimal integer digits, e.g. "-12345678912" for -123456789.12. */
  digits: string;
  /** How many of those digits sit after the decimal point. */
  scale: number;
}

/** MoneyInput is anything that can be read as an amount. */
export type MoneyInput = string | number | Money | null | undefined;

const ZERO: Money = { digits: "0", scale: 0 };

function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Money).digits === "string" &&
    typeof (value as Money).scale === "number"
  );
}

/** parseMoney turns an API amount into its exact digit representation. */
export function parseMoney(value: MoneyInput): Money {
  if (value === null || value === undefined) return ZERO;
  if (isMoney(value)) return value;

  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ZERO;
    // String(1e-7) is "1e-7"; toFixed expands it so the parser sees digits.
    text = String(value);
    if (/e/i.test(text)) text = value.toFixed(20);
  } else {
    text = value;
  }

  text = text.trim();
  if (!text) return ZERO;

  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  const [intPart = "0", fracPart = ""] = text.split(".");
  if ((intPart && !/^\d+$/.test(intPart)) || (fracPart && !/^\d+$/.test(fracPart))) {
    return ZERO;
  }

  const joined = `${intPart || "0"}${fracPart}`.replace(/^0+(?=\d)/, "");
  return { digits: negative && joined !== "0" ? `-${joined}` : joined, scale: fracPart.length };
}

function magnitude(digits: string): string {
  return digits.startsWith("-") ? digits.slice(1) : digits;
}

function isNegative(digits: string): boolean {
  return digits.startsWith("-");
}

/** addUnsigned adds two non-negative digit strings. */
function addUnsigned(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let carry = 0;
  let out = "";
  while (i >= 0 || j >= 0 || carry > 0) {
    const sum = (i >= 0 ? Number(a[i]) : 0) + (j >= 0 ? Number(b[j]) : 0) + carry;
    out = String(sum % 10) + out;
    carry = sum >= 10 ? 1 : 0;
    i -= 1;
    j -= 1;
  }
  return out.replace(/^0+(?=\d)/, "");
}

/** compareMagnitude compares two non-negative digit strings. */
function compareMagnitude(a: string, b: string): -1 | 0 | 1 {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** subtractUnsigned returns a - b, where a >= b. */
function subtractUnsigned(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let borrow = 0;
  let out = "";
  while (i >= 0) {
    let diff = Number(a[i]) - borrow - (j >= 0 ? Number(b[j]) : 0);
    borrow = 0;
    if (diff < 0) {
      diff += 10;
      borrow = 1;
    }
    out = String(diff) + out;
    i -= 1;
    j -= 1;
  }
  return out.replace(/^0+(?=\d)/, "");
}

function align(a: Money, b: Money): [string, string, number] {
  const scale = Math.max(a.scale, b.scale);
  const pad = (m: Money) => magnitude(m.digits) + "0".repeat(scale - m.scale);
  return [pad(a), pad(b), scale];
}

function signedSum(a: Money, b: Money, flipB: boolean): Money {
  const [x, y, scale] = align(a, b);
  const xNeg = isNegative(a.digits);
  const yNeg = isNegative(b.digits) !== flipB && y !== "0";

  if (xNeg === yNeg) {
    const total = addUnsigned(x, y);
    return { digits: xNeg && total !== "0" ? `-${total}` : total, scale };
  }

  const cmp = compareMagnitude(x, y);
  if (cmp === 0) return { digits: "0", scale };
  if (cmp > 0) {
    return { digits: xNeg ? `-${subtractUnsigned(x, y)}` : subtractUnsigned(x, y), scale };
  }
  return { digits: yNeg ? `-${subtractUnsigned(y, x)}` : subtractUnsigned(y, x), scale };
}

/** addMoney returns a + b, exactly. */
export function addMoney(a: MoneyInput, b: MoneyInput): Money {
  return signedSum(parseMoney(a), parseMoney(b), false);
}

/** subtractMoney returns a - b, exactly. */
export function subtractMoney(a: MoneyInput, b: MoneyInput): Money {
  return signedSum(parseMoney(a), parseMoney(b), true);
}

/** sumMoney totals a list of amounts without drifting. */
export function sumMoney(values: MoneyInput[]): Money {
  return values.reduce<Money>((total, value) => addMoney(total, value), ZERO);
}

/** compareMoney returns -1, 0 or 1. */
export function compareMoney(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  const left = parseMoney(a);
  const right = parseMoney(b);
  const [x, y] = align(left, right);
  const xNeg = isNegative(left.digits);
  const yNeg = isNegative(right.digits);

  if (xNeg !== yNeg) return xNeg ? -1 : 1;
  const cmp = compareMagnitude(x, y);
  return xNeg ? (cmp === 0 ? 0 : cmp === 1 ? -1 : 1) : cmp;
}

/** isPositiveMoney reports whether the amount is greater than zero. */
export function isPositiveMoney(value: MoneyInput): boolean {
  const { digits } = parseMoney(value);
  return !isNegative(digits) && digits !== "0";
}

/**
 * formatMoney renders an amount for display: thousands separators, at least two
 * decimal places, and no trailing zeros beyond the value's own precision (so a
 * rate of 33.335 keeps its third decimal). Unlike toLocaleString it never
 * rounds, because the digits are formatted straight from the exact value.
 */
export function formatMoney(value: MoneyInput): string {
  const { digits, scale } = parseMoney(value);
  const negative = isNegative(digits);
  const abs = magnitude(digits);

  const text = abs.padStart(scale + 1, "0");
  const intPart = text.slice(0, text.length - scale) || "0";
  let frac = text.slice(text.length - scale);

  frac = frac.replace(/0+$/, "");
  while (frac.length < 2) frac += "0";

  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}
