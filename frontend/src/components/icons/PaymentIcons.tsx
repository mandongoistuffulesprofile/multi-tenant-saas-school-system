import React from "react";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

/**
 * Crisp M-Pesa vector anchor for Paybill/Till/STK surfaces.
 * The geometry is fixed so it never stretches on high-DPI phone displays;
 * brand color uses the Safaricom green used across this app's payment UI.
 */
export const MpesaIcon: React.FC<IconProps> = ({ size = 24, className = "", ...props }) => (
  <svg
    width={size}
    height={(size * 20) / 24}
    viewBox="0 0 48 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`inline-block shrink-0 ${className}`}
    aria-label="M-Pesa"
    {...props}
  >
    <rect width="48" height="40" rx="4" fill="#00A344" />
    <path d="M10 28V12L16 20L22 12V28H18V18.5L16 21.5L14 18.5V28H10Z" fill="white" />
    <path d="M26 28V12H34C36.2 12 38 13.8 38 16C38 18.2 36.2 20 34 20H29.5V28H26ZM29.5 16.5H33.5C34.3 16.5 35 15.8 35 15C35 14.2 34.3 13.5 33.5 13.5H29.5V16.5Z" fill="white" />
    <circle cx="38" cy="26" r="3" fill="#ED1C24" />
  </svg>
);

/**
 * Bank / treasury icon for branch deposits, slips and EFT channels.
 */
export const BankSlipIcon: React.FC<IconProps> = ({ size = 20, className = "", ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`inline-block shrink-0 ${className}`}
    aria-label="Bank deposit / slip"
    {...props}
  >
    <path d="M3 21h18M3 10h18M5 10v11M19 10v11M9 10v11M14 10v11M12 2L2 7h20L12 2z" />
    <circle cx="12" cy="14" r="1.5" />
  </svg>
);

/**
 * Government authority shield for NG-CDF, county and constituency bursaries.
 */
export const GovShieldIcon: React.FC<IconProps> = ({ size = 20, className = "", ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`inline-block shrink-0 ${className}`}
    aria-label="Government bursary / NG-CDF"
    {...props}
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * Cash office icon for walk-in and counter payments.
 */
export const CashIcon: React.FC<IconProps> = ({ size = 20, className = "", ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`inline-block shrink-0 ${className}`}
    aria-label="Cash"
    {...props}
  >
    <rect x="2" y="6" width="20" height="15" rx="2" />
    <path d="M15 11h2M18 14h-3M9 11h2M12 8v6" />
  </svg>
);
