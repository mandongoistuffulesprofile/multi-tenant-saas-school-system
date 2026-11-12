/**
 * Standardized Kenyan shilling formatter: KES 14,500.00
 *
 * Mirrors the Central Bank of Kenya display convention used on fee
 * statements, invoices and receipts so bursars see the same format on
 * every screen.
 */
export function formatKES(amount: number | string | null | undefined): string {
  const numeric =
    typeof amount === "string" ? parseFloat(amount) : amount;
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) {
    return "KES 0.00";
  }

  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}
