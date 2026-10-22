import React from "react";

interface DataTableColumn<T> {
  key: keyof T;
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
  keyField?: keyof T;
  loading?: boolean;
  skeletonRows?: number;
  className?: string;
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
  keyField = "id" as keyof T,
  loading = false,
  skeletonRows = 3,
  className = "",
}: DataTableProps<T>) {
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
    <div className={`overflow-x-auto rounded-xl border border-gray-200 ${className}`}>
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
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-6 py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-3xl">📭</span>
                  <span className="text-body">{emptyMessage}</span>
                </div>
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody className="divide-y divide-gray-100">
            {sorted.map((row) => {
              const k = row[keyField] ?? JSON.stringify(row);
              return (
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
                      {col.render ? col.render(row) : row[col.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        )}
      </table>
    </div>
  );
}
