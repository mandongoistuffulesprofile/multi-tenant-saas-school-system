import { describe, expect, it } from "vitest";
import { normalizeKenyanPhone } from "./SaaSAdminDesk";

// Onboarding a school creates the administrator's login with this number, and
// the API stores whatever it is handed. These cases pin down what the form will
// and will not accept, so a future edit cannot quietly start sending
// "0712 345 678" or an unformatted foreign number into users.phone_number.
describe("normalizeKenyanPhone", () => {
  it.each([
    // Local mobile numbers, as a school would read them off a form.
    ["0712345678", "254712345678"],
    ["0112345678", "254112345678"],
    // Spacing and punctuation are cosmetic.
    ["0712 345 678", "254712345678"],
    ["0712-345-678", "254712345678"],
    ["(0712) 345 678", "254712345678"],
    // International forms.
    ["+254712345678", "254712345678"],
    ["+254 712 345 678", "254712345678"],
    ["254712345678", "254712345678"],
    // Already-national, without the leading zero.
    ["712345678", "254712345678"],
    ["112345678", "254112345678"],
    // Surrounding whitespace is trimmed by the digits-only pass.
    ["  0712345678  ", "254712345678"],
  ])("accepts %s as %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["0712 345", "too short"],
    ["071234567", "nine digits after the zero"],
    ["07123456789", "one digit too many"],
    ["071234567890", "far too long"],
    ["25471234567", "truncated international form"],
    ["0201234567", "Nairobi landline, not a mobile"],
    ["+254 20 123 4567", "landline in international form"],
    ["+1 555 0100", "foreign number"],
    ["00254712345678", "international dialling prefix"],
    ["0712345678 ext 2", "trailing extension"],
    ["abc", "not a number at all"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});
