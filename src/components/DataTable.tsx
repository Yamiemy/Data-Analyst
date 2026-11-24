import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useThemeCustomization } from '../context/ThemeContext';
import { exportRowsAsCSV, exportTableAsPDF } from '../engine/reportExporter';
import type { ColumnProfile, DatasetRow } from '../types/data';

interface DataTableProps {
  columns: string[];
  rows: DatasetRow[];
  columnProfiles?: ColumnProfile[];
  pageSize?: number;
  title?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  columns,
  rows,
  columnProfiles,
  pageSize = 15,
  title,
}) => {
  const { accentHex } = useThemeCustomization();
  const [search, setSearch] = useState('');
  const [filterCol, setFilterCol] = useState<string>('__all__');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const typeMap = useMemo(() => {
    const map = new Map<string, string>();
    columnProfiles?.forEach((c) => map.set(c.name, c.type));
    return map;
  }, [columnProfiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (filterCol !== '__all__') {
        return String(row[filterCol] ?? '').toLowerCase().includes(q);
      }
      return columns.some((c) => String(row[c] ?? '').toLowerCase().includes(q));
    });
  }, [rows, columns, search, filterCol]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      return sortDir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {title && <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 mr-2">{title}</span>}
          <span className="tabular-nums">{sorted.length.toLocaleString()} rows</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{columns.length} columns</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter column"
            value={filterCol}
            onChange={(e) => {
              setFilterCol(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="__all__">All columns</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search records..."
              className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <button
            type="button"
            disabled={sorted.length === 0}
            onClick={() =>
              exportTableAsPDF({
                title: title || 'Data Table Export',
                columns,
                rows: sorted,
                accentHex,
              })
            }
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </button>

          <button
            type="button"
            disabled={sorted.length === 0}
            onClick={() => exportRowsAsCSV(title || 'table_export', columns, sorted)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/60">
              <th className="px-3 py-2.5 font-medium text-slate-400 tabular-nums w-12">#</th>
              {columns.map((col) => {
                const colType = typeMap.get(col);
                const isNum = colType === 'number';
                return (
                  <th
                    key={col}
                    className={`px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap ${
                      isNum ? 'text-right' : 'text-left'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className={`inline-flex items-center gap-1.5 hover:text-indigo-600 dark:hover:text-indigo-400 ${
                        isNum ? 'flex-row-reverse' : ''
                      }`}
                    >
                      <span>{col}</span>
                      {colType && (
                        <span className="font-mono text-[10px] font-normal text-slate-400">{colType}</span>
                      )}
                      {sortCol === col ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3 w-3 text-indigo-600" />
                        ) : (
                          <ArrowDown className="h-3 w-3 text-indigo-600" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-35" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                  No matching rows found.
                </td>
              </tr>
            ) : (
              pageRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400 tabular-nums">
                    {(safePage - 1) * pageSize + rIdx + 1}
                  </td>
                  {columns.map((col) => {
                    const val = row[col];
                    const isNum = typeof val === 'number' || typeMap.get(col) === 'number';
                    return (
                      <td
                        key={col}
                        className={`px-3 py-2 max-w-[240px] truncate ${
                          isNum ? 'text-right font-mono tabular-nums text-slate-800 dark:text-slate-200' : 'text-slate-700 dark:text-slate-300'
                        }`}
                        title={val === null || val === undefined ? 'null' : String(val)}
                      >
                        {val === null || val === undefined ? (
                          <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">null</span>
                        ) : typeof val === 'boolean' ? (
                          String(val)
                        ) : typeof val === 'number' ? (
                          val.toLocaleString()
                        ) : (
                          String(val)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="tabular-nums">
          Page {safePage} of {totalPages}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
