import React, { useMemo, useState } from 'react';
import { Clock, Search, Trash2 } from 'lucide-react';
import type { AnalysisHistoryEntry } from '../types/data';

interface HistoryViewProps {
  history: AnalysisHistoryEntry[];
  onClearHistory: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ history, onClearHistory }) => {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((item) => {
      const modMatch = moduleFilter === 'all' || item.module === moduleFilter;
      const textMatch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.datasetName.toLowerCase().includes(q);
      return modMatch && textMatch;
    });
  }, [history, search, moduleFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search analysis log..."
              className="w-56 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            aria-label="Filter by module"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="all">All Modules</option>
            <option value="chat">AI Data Chat</option>
            <option value="cleaning">Data Cleaning</option>
            <option value="eda">EDA</option>
            <option value="predictive">Predictive ML</option>
            <option value="sql">SQL Assistant</option>
            <option value="python">Python Assistant</option>
            <option value="insights">BI Insights</option>
            <option value="report">Reports</option>
          </select>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear History
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
          <Clock className="mb-3 h-8 w-8 text-slate-400" />
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            No analysis entries recorded yet
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Queries, SQL runs, ML evaluations, and exported reports appear here chronologically.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {filtered.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-indigo-600 uppercase dark:text-indigo-400">{entry.module}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-medium text-slate-900 dark:text-white">{entry.title}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{entry.summary}</p>
                <div className="text-[11px] text-slate-400">Dataset: {entry.datasetName}</div>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
