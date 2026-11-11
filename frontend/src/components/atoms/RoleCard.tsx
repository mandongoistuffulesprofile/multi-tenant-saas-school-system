import React from "react";

interface RoleCardProps {
  schoolName: string;
  subdomain: string;
  role: string;
  status: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export default function RoleCard({
  schoolName,
  subdomain,
  role,
  status,
  selected = false,
  disabled = false,
  onClick,
}: RoleCardProps) {
  const base =
    "flex items-center justify-between p-4 rounded-xl border transition-all duration-200 cursor-pointer text-left";
  const border =
    selected
      ? "border-kenyan-red bg-kenyan-red/5"
      : "border-gray-200 bg-white hover:bg-gray-50";
  const ring = selected ? "ring-2 ring-kenyan-red" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${border} ${ring} disabled:opacity-50 disabled:pointer-events-none`}
    >
      <div>
        <div className="font-semibold text-gray-900">{schoolName}</div>
        <div className="text-xs text-gray-500">
          {subdomain} &middot; {role}
        </div>
      </div>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
          status === "active"
            ? "bg-kenyan-green/10 text-kenyan-green border-kenyan-green/20"
            : "bg-gray-100 text-gray-600 border-gray-200"
        }`}
      >
        {status}
      </span>
    </button>
  );
}
