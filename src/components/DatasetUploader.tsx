import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import {
  createSampleChurnDataset,
  createSampleRetailSalesDataset,
  parseCSVText,
  parseSheetValuesMatrix,
  parseUploadedFile,
} from '../engine/parser';
import { importGoogleSheet } from '../services/aiService';
import type { Dataset } from '../types/data';

interface DatasetUploaderProps {
  onDatasetLoaded: (dataset: Dataset) => void;
  compact?: boolean;
}

export const DatasetUploader: React.FC<DatasetUploaderProps> = ({ onDatasetLoaded, compact = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Google Sheets state
  const [sheetUrl, setSheetUrl] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [showOAuthInput, setShowOAuthInput] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setError(null);
    setSuccessMsg(null);
    setProgress(25);

    try {
      setProgress(60);
      const dataset = await parseUploadedFile(file);
      setProgress(100);
      setSuccessMsg(`Loaded "${dataset.name}" (${dataset.profile.rowCount.toLocaleString()} rows · ${dataset.profile.columnCount} columns).`);
      onDatasetLoaded(dataset);
      setTimeout(() => setProgress(null), 800);
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Failed to parse uploaded file.');
    }
  };

  const handleGoogleSheetImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl.trim()) {
      setError('Paste a Google Sheets URL or published CSV URL.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setSheetLoading(true);
    try {
      const result = await importGoogleSheet({
        url: sheetUrl.trim(),
        accessToken: oauthToken.trim() || undefined,
      });

      let dataset: Dataset;
      if (result.mode === 'oauth_api' && result.values) {
        dataset = parseSheetValuesMatrix(result.values, `${result.title} (${result.activeSheet || 'Sheet'})`);
      } else if (result.csvText) {
        dataset = await parseCSVText(result.csvText, `${result.title}.csv`, 'google_sheets');
      } else {
        throw new Error('No tabular rows were returned from the spreadsheet.');
      }

      setSuccessMsg(`Imported "${dataset.name}" (${dataset.profile.rowCount.toLocaleString()} rows).`);
      setSheetUrl('');
      onDatasetLoaded(dataset);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to import Google Sheet.';
      setError(msg);
      if (msg.toLowerCase().includes('private') || msg.toLowerCase().includes('authentication')) {
        setShowOAuthInput(true);
      }
    } finally {
      setSheetLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
        {/* Drag-and-drop Upload */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            dragging
              ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
              : 'border-slate-300 bg-white hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <UploadCloud className="h-5 w-5" />
          </div>
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Drop CSV, Excel, or JSON file
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Supports .csv, .xlsx, .xls, and .json up to 25 MB
          </p>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.json"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Browse Files
          </button>

          {progress !== null && (
            <div className="mt-4 w-full max-w-xs">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 tabular-nums">Parsing and profiling dataset... {progress}%</p>
            </div>
          )}
        </div>

        {/* Google Sheets Import */}
        <form
          onSubmit={handleGoogleSheetImport}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                <Link2 className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Import from Google Sheets
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Public link, published CSV URL, or OAuth bearer access
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              <input
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowOAuthInput((v) => !v)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  {showOAuthInput ? 'Hide OAuth token field' : 'Private sheet? Supply OAuth access token'}
                </button>
              </div>

              {showOAuthInput && (
                <input
                  type="password"
                  value={oauthToken}
                  onChange={(e) => setOauthToken(e.target.value)}
                  placeholder="Optional Google OAuth2 Bearer access token"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">
              Private sheets require link sharing, CSV publish, or OAuth.
            </span>
            <button
              type="submit"
              disabled={sheetLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:border-slate-700 dark:bg-indigo-600 dark:hover:bg-indigo-700 whitespace-nowrap shrink-0"
            >
              {sheetLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import Sheet
            </button>
          </div>
        </form>
      </div>

      {/* Quick-start Sample Datasets */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>Want to explore immediately? Load a curated benchmark dataset:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const ds = createSampleRetailSalesDataset();
              onDatasetLoaded(ds);
              setError(null);
              setSuccessMsg(`Loaded sample "${ds.name}" (${ds.profile.rowCount} rows).`);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            SaaS Sales & Revenue (122 rows)
          </button>
          <button
            type="button"
            onClick={() => {
              const ds = createSampleChurnDataset();
              onDatasetLoaded(ds);
              setError(null);
              setSuccessMsg(`Loaded sample "${ds.name}" (${ds.profile.rowCount} rows).`);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
          >
            Customer Churn & Retention (150 rows)
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}
    </div>
  );
};
