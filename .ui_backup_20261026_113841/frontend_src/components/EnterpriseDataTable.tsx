import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

interface EnterpriseDataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  filterStreamOptions?: string[];
  filenameExport?: string;
}

export function EnterpriseDataTable<T extends Record<string, any>>({
  data,
  columns,
  searchPlaceholder = 'Tafuta kwa nambari ya usajili, jina au UPI...',
  filterStreamOptions = ['Form 1', 'Form 2', 'Form 3', 'Form 4', 'Grade 7', 'Grade 8', 'Grade 9'],
  filenameExport = 'Ripoti_ya_Wanafunzi.csv',
}: EnterpriseDataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [selectedStream, setSelectedStream] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Filtered dataset
  const filteredData = useMemo(() => {
    return data.filter((row) => {
      const matchSearch = Object.values(row).some((val) =>
        String(val).toLowerCase().includes(query.toLowerCase())
      );
      const matchStream = selectedStream ? row.stream === selectedStream || row.grade === selectedStream : true;
      return matchSearch && matchStream;
    });
  }, [data, query, selectedStream]);

  // Pagination slice
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;

  // CSV Export utility
  const handleExportCSV = () => {
    if (filteredData.length === 0) return;
    const headers = columns.map((col) => `"${col.header}"`).join(',');
    const rows = filteredData.map((row) =>
      columns.map((col) => `"${String(row[col.key] ?? '')}"`).join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filenameExport);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      {/* Control Bar */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2 items-center justify-between text-xs">
        <div className="flex gap-2 items-center flex-1 min-w-[280px]">
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
            placeholder={searchPlaceholder}
            className="w-full sm:w-80 px-3 py-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 focus:outline-none"
          />
          <select
            value={selectedStream}
            onChange={(e) => { setSelectedStream(e.target.value); setCurrentPage(1); }}
            className="px-2.5 py-1.5 border border-slate-300 rounded bg-white focus:outline-none"
          >
            <option value="">Madarasa Yote (All Streams)</option>
            {filterStreamOptions.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleExportCSV}
          type="button"
          className="px-3 py-1.5 bg-slate-800 text-white rounded font-medium hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
        >
          <span>Pakua CSV (Export)</span>
        </button>
      </div>

      {/* Responsive Table Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-100 text-slate-800 uppercase font-semibold border-b border-slate-200">
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} className="px-4 py-2.5">{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedData.length > 0 ? (
              paginatedData.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className="px-4 py-2.5">
                      {col.render ? col.render(row) : String(row[col.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 text-slate-400">
                  Hakuna rekodi zilizopatikana (No records found).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
        <div>
          Jumla ya Rekodi: <strong className="text-slate-800">{filteredData.length}</strong> (Ukurasa {currentPage} wa {totalPages})
        </div>
        <div className="flex gap-1">
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40"
          >
            Nyuma (Prev)
          </button>
          <button
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            className="px-2.5 py-1 border border-slate-200 bg-white rounded disabled:opacity-40"
          >
            Mbele (Next)
          </button>
        </div>
      </div>
    </div>
  );
}
