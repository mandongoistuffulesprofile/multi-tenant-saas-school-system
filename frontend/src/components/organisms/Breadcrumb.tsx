import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  path: string;
}

export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const { t } = useTranslation();
  const location = useLocation();

  if (!items.length) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden md:flex items-center gap-1 px-6 py-2 text-sm text-gray-500 bg-gray-50 border-b border-gray-100"
    >
      <ol className="flex items-center gap-1 flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isFirst = index === 0;

          return (
            <li key={item.path} className="flex items-center gap-1">
              {!isFirst && (
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" aria-hidden="true" />
              )}
              {isLast ? (
                <span
                  className="text-gray-900 font-medium truncate max-w-[200px]"
                  aria-current="page"
                >
                  {t(item.label) !== item.label ? t(item.label) : item.label}
                </span>
              ) : (
                <NavLink
                  to={item.path}
                  className="hover:text-kenyan-red transition text-gray-500 flex items-center gap-1"
                >
                  {isFirst && item.path === "/" && (
                    <Home className="w-4 h-4" aria-hidden="true" />
                  )}
                  {t(item.label) !== item.label ? t(item.label) : item.label}
                </NavLink>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation();
  const pathnames = location.pathname.split("/").filter(Boolean);

  const items: BreadcrumbItem[] = [{ label: "dashboard", path: "/" }];

  let currentPath = "";
  for (const segment of pathnames) {
    currentPath += `/${segment}`;
    const label = segment.replace(/-/g, " ");
    items.push({ label, path: currentPath });
  }

  return items;
}