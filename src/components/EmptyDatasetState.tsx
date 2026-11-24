import React from 'react';
import { Database, UploadCloud } from 'lucide-react';
import type { NavSectionId } from '../types/data';

interface EmptyDatasetStateProps {
  title: string;
  description: string;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample?: () => void;
}

export const EmptyDatasetState: React.FC<EmptyDatasetStateProps> = ({
  title,
  description,
  onNavigate,
  onLoadSample,
}) => {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
        <Database className="h-6 w-6" />
      </div>
      <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => onNavigate('datasets')}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
        >
          <UploadCloud className="h-4 w-4" />
          Upload or Import Dataset
        </button>
        {onLoadSample && (
          <button
            type="button"
            onClick={onLoadSample}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            Load Sample Sales Dataset
          </button>
        )}
      </div>
    </div>
  );
};
