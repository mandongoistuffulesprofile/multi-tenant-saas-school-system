import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
}

export default function Card({ children, padded = true, className = "", ...props }: CardProps) {
  return (
    <div className={`card ${padded ? "p-6" : ""} ${className}`} {...props}>
      {children}
    </div>
  );
}

interface KPIStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { label: string; value: number; positive: boolean };
  icon?: React.ReactNode;
}

export function KPIStatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
}: KPIStatCardProps) {
  return (
    <Card padded>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-caption text-muted uppercase tracking-wider">{title}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-3xl font-bold text-gray-900">{value}</span>
            {subtitle && <span className="text-body text-gray-600">{subtitle}</span>}
          </div>
          {trend && (
            <p className={`text-xs font-medium mt-1 ${
              trend.positive ? "text-kenyan-green" : "text-kenyan-red"
            }`}>
              {trend.label} {trend.value > 0 ? "+" : ""}{trend.value}
            </p>
          )}
        </div>
        {icon && <div className="ml-4 p-2 rounded-xl bg-gray-50 text-gray-600">{icon}</div>}
      </div>
    </Card>
  );
}
