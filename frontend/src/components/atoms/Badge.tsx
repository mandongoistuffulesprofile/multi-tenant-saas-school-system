import React from "react";
import { useTranslation } from "react-i18next";

export type LevelCode = "EE" | "ME" | "AE" | "BE";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: "default" | "success" | "info" | "warning" | "danger" | "level";
  level?: LevelCode;
  className?: string;
}

const LEVEL_COLORS: Record<LevelCode, string> = {
  EE: "bg-kenyan-green/10 text-kenyan-green border-kenyan-green/20",
  ME: "bg-blue-100 text-blue-700 border-blue-200",
  AE: "bg-amber-100 text-amber-700 border-amber-200",
  BE: "bg-red-100 text-red-700 border-red-200",
};

const VARIANTS: Record<string, string> = {
  default: "bg-gray-100 text-gray-700 border-gray-200",
  success: "bg-kenyan-green/10 text-kenyan-green border-kenyan-green/20",
  info: "bg-blue-100 text-blue-700 border-blue-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  danger: "bg-red-100 text-red-700 border-red-200",
  level: "",
};

export default function Badge({
  children,
  variant = "default",
  level,
  className = "",
  ...props
}: BadgeProps) {
  const color = level ? LEVEL_COLORS[level] : VARIANTS[variant];
  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${color} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

export function LevelBadge({ level, className }: { level: LevelCode; className?: string }) {
  const { t } = useTranslation();
  const labels: Record<LevelCode, string> = {
    EE: t("level_exceeding"),
    ME: t("level_meeting"),
    AE: t("level_approaching"),
    BE: t("level_below"),
  };
  return <Badge variant="level" level={level} className={className}>
    {level} {labels[level]}
  </Badge>;
}
