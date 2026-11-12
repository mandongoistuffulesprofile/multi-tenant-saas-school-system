import React from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { InstitutionalEmptyState } from "../ui/InstitutionalEmptyState";

interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

interface DataTableProps<T extends Record<string, any>> {
  data: T[];
  columns: DataTableColumn<T>[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  keyField?: string;
  loading?: boolean;
  skeletonRows?: number;
  className?: string;
  /** Optional per-row expanded content (e.g. raw audit detail behind a narrative). */
  expandable?: (row: T) => React.ReactNode;
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <tbody>
      {Array.from({ length: 3 }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="px-6 py-4">
              <div className="h-4 bg-gray-200 rounded animate-pulse w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export default function DataTable<T extends Record<string, any>>({
  data,
  columns,
  emptyMessage = "No records found",
  onRowClick,
  keyField = "id" as string,
  loading = false,
  skeletonRows = 3,
  className = "",
  expandable,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortable = columns.some((c) => c.sortable !== false);

  const sorted = React.useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey as keyof T] ?? "";
      const bv = b[sortKey as keyof T] ?? "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  return (
    <>
      {/* Phones get readable cards instead of a 600px-wide scrolling table. */}
      <div className={`space-y-3 md:hidden ${className}`}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="h-4 w-1/3 rounded bg-gray-200 animate-pulse mb-3" />
              <div className="h-4 w-2/3 rounded bg-gray-100 animate-pulse" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <InstitutionalEmptyState
              title={emptyMessage}
              description="No records match the current filters. Try adjusting your search or filters."
              icon={FileText}
            />
          </div>
        ) : (
          sorted.map((row) => {
            const k = String((row as Record<string, unknown>)[keyField] ?? JSON.stringify(row));
            return (
              <div
                key={k}
                className={`rounded-xl border border-gray-200 bg-white p-4 ${onRowClick ? "cursor-pointer active:bg-gray-50" : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                <dl className="space-y-2">
                  {columns.map((col) => (
                    <div key={String(col.key)} className="flex items-start justify-between gap-4">
                      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500">
                        {col.header}
                      </dt>
                      <dd className="min-w-0 break-words text-right text-sm text-gray-900">
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                      </dd>
                    </div>
                  ))}
                </dl>
                {expandable && (
                  <details className="mt-3 border-t border-gray-100 pt-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-gray-500">
                      {t("common.audit_details")}
                    </summary>
                    <div className="mt-2 text-sm text-gray-700">{expandable(row)}</div>
                  </details>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={`hidden md:block overflow-x-auto rounded-xl border border-gray-200 ${className}`}>
      <table className="w-full text-left min-w-[600px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={`px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap ${col.className ?? ""}`}
              >
                {sortable && col.sortable !== false ? (
                  <button
                    type="button"
                    onClick={() => handleSort(String(col.key))}
                    className="inline-flex items-center gap-1 hover:text-gray-700 transition"
                    aria-label={`Sort by ${col.header}`}
                  >
                    {col.header}
                    {sortKey === String(col.key) ? (
                      sortDir === "asc" ? " ▲" : " ▼"
                    ) : null}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        {loading ? (
          <TableSkeleton columns={columns.length} />
        ) : sorted.length === 0 ? (
          <InstitutionalEmptyState
            title={emptyMessage}
            description="No records match the current filters. Try adjusting your search or filters."
            icon={FileText}
          />
        ) : (
          <tbody className="divide-y divide-gray-100">
            {sorted.map((row) => {
              const k = String((row as Record<string, unknown>)[keyField] ?? JSON.stringify(row));
              return (
                <React.Fragment key={k}>
                  <tr
                    key={k}
                    className={`hover:bg-gray-50 transition-colors ${
                      onRowClick ? "cursor-pointer" : ""
                    }`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    role={onRowClick ? "button" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e: React.KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((col) => (
                      <td
                        key={String(col.key)}
                        className={`px-6 py-4 text-sm text-gray-900 whitespace-nowrap ${col.className ?? ""}`}
                      >
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                  {expandable && (
                    <tr key={k + "-expanded"} className="bg-gray-50/50">
                      <td colSpan={columns.length} className="px-6 py-3 text-sm text-gray-700 border-t border-gray-100">
                        <details className="group">
                          <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-medium text-gray-500 group-open:text-gray-900">
                            <span className="transition-transform group-open:rotate-900">›</span>
                            {t("common.audit_details")}
                          </summary>
                          <div className="mt-2 ml-4">{expandable(row)}</div>
                        </details>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        )}
      </table>
      </div>
    </>
  );
}
