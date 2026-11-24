import React from 'react';
import { Check, Database, Download, Trash2 } from 'lucide-react';
import { DatasetUploader } from '../components/DatasetUploader';
import { DataTable } from '../components/DataTable';
import { useThemeCustomization } from '../context/ThemeContext';
import { exportDatasetAsCSV, exportDatasetAsExcel, exportTableAsPDF } from '../engine/reportExporter';
import type { Dataset } from '../types/data';

interface DatasetsViewProps {
  datasets: Dataset[];
  activeDataset: Dataset | null;
  onSelectDataset: (id: string) => void;
  onDatasetLoaded: (ds: Dataset) => void;
  onDeleteDataset: (id: string) => void;
}

export const DatasetsView: React.FC<DatasetsViewProps> = ({
  datasets,
  activeDataset,
  onSelectDataset,
  onDatasetLoaded,
  onDeleteDataset,
}) => {
  const { accentHex } = useThemeCustomization();

  return (
    <div className="space-y-6">
      <DatasetUploader onDatasetLoaded={onDatasetLoaded} />

      {datasets.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Workspace Datasets ({datasets.length})
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {datasets.map((ds) => {
              const isActive = ds.id === activeDataset?.id;
              return (
                <div
                  key={ds.id}
                  onClick={() => onSelectDataset(ds.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelectDataset(ds.id);
                  }}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-50/40 dark:border-indigo-500 dark:bg-indigo-950/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Database className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {ds.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                          <Check className="h-3.5 w-3.5" />
                          Active
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteDataset(ds.id);
                        }}
                        title="Remove dataset"
                        aria-label={`Remove ${ds.name}`}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    {ds.profile.rowCount.toLocaleString()} rows · {ds.profile.columnCount} columns · Quality {ds.profile.qualityScore}/100
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 tabular-nums">
                    Source: {ds.source.toUpperCase()} · Missing: {ds.profile.missingPct}% · Duplicates: {ds.profile.duplicateRowCount}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeDataset && (
        <section className="space-y-4">
          {/* Dataset Information Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {activeDataset.name}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {activeDataset.profile.rowCount.toLocaleString()} rows · {activeDataset.profile.columnCount} columns ·{' '}
                  {activeDataset.profile.missingCells.toLocaleString()} missing cells ·{' '}
                  {activeDataset.profile.duplicateRowCount.toLocaleString()} duplicates · Quality Score {activeDataset.profile.qualityScore}/100
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    exportTableAsPDF({
                      title: activeDataset.name,
                      subtitle: `${activeDataset.profile.rowCount.toLocaleString()} rows · ${activeDataset.profile.columnCount} columns · Quality Score ${activeDataset.profile.qualityScore}/100`,
                      columns: activeDataset.columns,
                      rows: activeDataset.rows,
                      accentHex,
                    })
                  }
                  style={{ backgroundColor: accentHex }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export PDF
                </button>
                <button
                  type="button"
                  onClick={() => exportDatasetAsCSV(activeDataset)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportDatasetAsExcel(activeDataset)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Excel
                </button>
              </div>
            </div>

            {/* Schema Overview Grid */}
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {activeDataset.profile.columns.map((col) => (
                <div
                  key={col.name}
                  className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{col.name}</span>
                    <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{col.type}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {col.uniqueCount.toLocaleString()} unique · {col.missingCount} missing
                    {col.type === 'number' && col.mean !== undefined ? ` · avg ${col.mean.toLocaleString()}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DataTable
            title="Dataset Preview"
            columns={activeDataset.columns}
            rows={activeDataset.rows}
            columnProfiles={activeDataset.profile.columns}
            pageSize={15}
          />
        </section>
      )}
    </div>
  );
};
