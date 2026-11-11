import React from "react";

interface SharpIconProps extends React.SVGProps<SVGSVGElement> {
  strokeWidth?: number | string;
}

// Sharp Badge — institutional mark. Strict shield geometry, 45° angles.
export function SharpBadge({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M12 2 L20 6 L20 18 L12 22 L4 18 L4 6 Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Sharp Shield — compliance / security seal. Straight-edged kite shield.
export function SharpShield({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M12 2 L20 6 L20 20 L12 24 L4 20 L4 6 Z" />
      <path d="M12 8 L12 16" />
      <path d="M8 12 L16 12" />
    </svg>
  );
}

// Sharp Phone — M-Pesa / contact line. Rectangular handset.
export function SharpPhone({ strokeWidth = 1.5, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <rect x="4" y="8" width="16" height="8" rx="0" />
      <path d="M12 14 L12 18" />
      <path d="M16 10 L20 10" />
      <path d="M8 10 L4 10" />
    </svg>
  );
}

// Sharp Phone Off — STK cancelled / disconnected.
export function SharpPhoneOff({ strokeWidth = 1.5, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <rect x="4" y="8" width="16" height="8" />
      <line x1="4" y1="8" x2="20" y2="16" />
      <path d="M12 14 L12 18" />
    </svg>
  );
}

// Sharp Scan QR — Gate Kiosk badge scan. Square QR pattern.
export function SharpScanQR({ strokeWidth = 1.5, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <rect x="5" y="5" width="14" height="14" />
      <rect x="6" y="6" width="4" height="4" />
      <rect x="14" y="6" width="4" height="4" />
      <rect x="6" y="14" width="4" height="4" />
      <rect x="11" y="11" width="2" height="2" />
    </svg>
  );
}

// Sharp Lock — security / access denied.
export function SharpLock({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <rect x="9" y="12" width="6" height="8" />
      <path d="M12 12 L12 6 L9 6 L9 10" />
      <path d="M12 6 L15 6 L15 10" />
    </svg>
  );
}

// Sharp Arrow Right — navigation.
export function SharpArrowRight({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="12" y1="5" x2="19" y2="12" />
      <line x1="12" y1="19" x2="19" y2="12" />
    </svg>
  );
}

// Sharp Check — confirmation / verified.
export function SharpCheck({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Sharp X — cancel / deny.
export function SharpX({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Sharp Users — people / staff / parents.
export function SharpUsers({ strokeWidth = 1.5, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M16 21 V16 A4 4 0 0 0 12 12 A4 4 0 0 0 8 16 V21" />
      <path d="M3 10 L21 10" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="6" r="2" />
    </svg>
  );
}

// Sharp Home — dashboard / house.
export function SharpHome({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M3 12 L12 5 L21 12 V21 H3 V12 Z" />
      <path d="M12 5 L12 21" />
    </svg>
  );
}

// Sharp CreditCard — finance / payments.
export function SharpCreditCard({ strokeWidth = 1.5, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <rect x="2" y="6" width="20" height="12" />
      <line x1="8" y1="10" x2="1" y2="10" />
      <line x1="8" y1="14" x2="1" y2="14" />
      <path d="M16 10 L20 10 L20 14 L16 14" />
    </svg>
  );
}

// Sharp Pin — map-pin / gate / location.
export function SharpPin({ strokeWidth = 2, ...props }: SharpIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...props}
    >
      <path d="M12 2 L16 6 L16 12 A4 4 0 0 1 12 16 A4 4 0 0 1 8 12 L8 6 L12 2 Z" />
      <circle cx="12" cy="10" r="1" />
    </svg>
  );
}
