/**
 * Strict normalizer for Kenyan mobile numbers (Safaricom / Airtel / Telkom).
 *
 * Accepted input forms (whitespace, dashes and '+' are stripped first):
 *   - 07XXXXXXXX / 01XXXXXXXX          -> 2547XXXXXXXX / 2541XXXXXXXX
 *   - 2547XXXXXXXX / 2541XXXXXXXX      -> unchanged
 *   - 7XXXXXXXX / 1XXXXXXXX (9 digits) -> 2547XXXXXXXX / 2541XXXXXXXX
 *
 * Throws for anything else so callers never submit a malformed MSISDN to
 * Daraja (which would surface as an unhelpful "Invalid MSISDN" error).
 */
export function normalizeKenyanPhone(input: string): string {
  const clean = input.replace(/[\s\-+]/g, "");

  if (/^0[17]\d{8}$/.test(clean)) {
    return "254" + clean.slice(1);
  }

  if (/^254[17]\d{8}$/.test(clean)) {
    return clean;
  }

  if (/^[17]\d{8}$/.test(clean)) {
    return "254" + clean;
  }

  throw new Error("Please enter a valid Kenyan phone number (e.g. 0712 345 678).");
}
