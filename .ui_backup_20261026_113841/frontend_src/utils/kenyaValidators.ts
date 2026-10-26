/**
 * Kenyan Institutional Validation Rules (MoE, TSC, KNEC, Daraja)
 */

export const KenyaValidators = {
  // NEMIS UPI: Exactly 6 alphanumeric characters (or modern 10-char UPI)
  nemisUPI: (val: string): boolean => {
    return /^[A-Z0-9]{6,10}$/i.test(val.trim());
  },

  // Teachers Service Commission (TSC) Number: 6-7 numeric digits
  tscNumber: (val: string): boolean => {
    return /^\d{6,7}$/.test(val.trim());
  },

  // Kenyan M-Pesa / Mobile Phone validator
  kenyanPhone: (val: string): boolean => {
    return /^(?:254|\+254|0)?([71]\d{8})$/.test(val.trim());
  },

  // Standardize mobile number to E.164 (+2547XXXXXXXX)
  normalizePhone: (val: string): string => {
    const clean = val.replace(/\D/g, '');
    if (clean.startsWith('254') && clean.length === 12) return `+${clean}`;
    if (clean.startsWith('0') && clean.length === 10) return `+254${clean.substring(1)}`;
    if (clean.length === 9) return `+254${clean}`;
    return val;
  },

  // KNEC Assessment Index Number format (e.g., 40100101-001)
  knecAssessmentNumber: (val: string): boolean => {
    return /^\d{8}-\d{3}$/.test(val.trim());
  },

  // Standard Safaricom Daraja M-Pesa Receipt ID (e.g., QKD712XY6Z)
  mpesaReceiptId: (val: string): boolean => {
    return /^[A-Z0-9]{10}$/.test(val.trim());
  }
};
