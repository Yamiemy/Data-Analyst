import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  RotateCcw,
  Undo2,
  Wand2,
} from 'lucide-react';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { MetricTooltip } from '../components/MetricTooltip';
import { useThemeCustomization } from '../context/ThemeContext';
import { detectDatasetIssues, simulateCleaningAction } from '../engine/cleaner';
import { exportDatasetAsCSV, exportDatasetAsExcel, exportTableAsPDF } from '../engine/reportExporter';
import type { CleaningAction, CleaningPreview, ColumnType, Dataset, NavSectionId } from '../types/data';

interface CleaningStudioViewProps {
  dataset: Dataset | null;
  onApplyCleaning: (action: CleaningAction) => void;
  onUndoCleaning: () => void;
  onResetDataset: () => void;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
}

export const CleaningStudioView: React.FC<CleaningStudioViewProps> = ({
  dataset,
  onApplyCleaning,
  onUndoCleaning,
  onResetDataset,
  onNavigate,
  onLoadSample,
}) => {
  const { accentHex } = useThemeCustomization();
  const [actionType, setActionType] = useState<CleaningAction['type']>('fill_missing');
  const [selectedCol, setSelectedCol] = useState<string>('');
  const [fillStrategy, setFillStrategy] = useState<'mean' | 'median' | 'mode' | 'zero' | 'custom'>('median');
  const [customValue, setCustomValue] = useState('');
  const [textMode, setTextMode] = useState<'trim' | 'lowercase' | 'uppercase' | 'titlecase'>('titlecase');
  const [targetType, setTargetType] = useState<ColumnType>('number');
  const [outlierStrategy, setOutlierStrategy] = useState<'cap' | 'remove'>('cap');
  const [newColName, setNewColName] = useState('');

  const [pendingAction, setPendingAction] = useState<CleaningAction | null>(null);
  const [preview, setPreview] = useState<CleaningPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(() => (dataset ? detectDatasetIssues(dataset) : []), [dataset]);

  const validationChecks = useMemo(() => {
    if (!dataset) return [];
    const negNumericCols = dataset.profile.columns.filter((c) => c.type === 'number' && (c.min ?? 0) < 0);
    const mixedDateCols = dataset.profile.columns.filter((c) => c.type === 'date' && (c.inconsistentFormatCount || 0) > 0);
    return [
      {
        label: 'Completeness',
        pass: dataset.profile.missingCells === 0,
        detail:
          dataset.profile.missingCells === 0
            ? 'All cells populated'
            : `${dataset.profile.missingCells.toLocaleString()} missing cells`,
      },
      {
        label: 'Row Uniqueness',
        pass: dataset.profile.duplicateRowCount === 0,
        detail:
          dataset.profile.duplicateRowCount === 0
            ? 'No duplicate records'
            : `${dataset.profile.duplicateRowCount.toLocaleString()} duplicates`,
      },
      {
        label: 'Date Format Consistency',
        pass: mixedDateCols.length === 0,
        detail:
          mixedDateCols.length === 0
            ? 'Dates consistent'
            : `${mixedDateCols.length} col(s) need ISO normalization`,
      },
      {
        label: 'Negative Value Audit',
        pass: negNumericCols.length === 0,
        detail:
          negNumericCols.length === 0
            ? 'All numeric mins ≥ 0'
            : `${negNumericCols.length} col(s) have negative values`,
      },
    ];
  }, [dataset]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Data Cleaning Studio"
        description="Upload a dataset to audit missing values, duplicates, inconsistent text casing, date formats, outliers, and type mismatches with safe undoable previews."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const activeCol = selectedCol && dataset.columns.includes(selectedCol) ? selectedCol : dataset.columns[0];

  const handlePreview = (action: CleaningAction) => {
    setError(null);
    try {
      const sim = simulateCleaningAction(dataset, action);
      setPendingAction(action);
      setPreview(sim.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview cleaning action.');
    }
  };

  const handleConfirmApply = () => {
    if (!pendingAction) return;
    setError(null);
    try {
      onApplyCleaning(pendingAction);
      setPendingAction(null);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply cleaning action.');
    }
  };

  const buildCustomAction = (): CleaningAction => ({
    type: actionType,
    column: activeCol,
    fillStrategy,
    customValue,
    textMode,
    targetType,
    outlierStrategy,
    newColumnName: newColName,
  });

  const qualityDelta = Number((dataset.profile.qualityScore - dataset.originalProfile.qualityScore).toFixed(1));

  return (
    <div className="space-y-6">
      {/* Quality Before / After Comparison Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Original Quality Score</span>
            <MetricTooltip
              label="Baseline Score"
              explanation="Initial quality score preserved from your unmodified source upload."
            />
          </div>
          <div className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {dataset.originalProfile.qualityScore}/100
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {dataset.originalProfile.rowCount.toLocaleString()} rows · {dataset.originalProfile.missingCells} nulls
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Current Quality Score</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums" style={{ color: accentHex }}>
            {dataset.profile.qualityScore}/100
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {qualityDelta > 0 ? `+${qualityDelta} pts improvement` : qualityDelta < 0 ? `${qualityDelta} pts` : 'Unchanged from original'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Missing Cells &amp; Duplicates</div>
          <div className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {dataset.profile.missingCells} / {dataset.profile.duplicateRowCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {dataset.profile.missingPct}% missing · {dataset.profile.rowCount.toLocaleString()} rows left
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Safety &amp; Export Controls</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={dataset.cleaningHistory.length === 0}
              onClick={onUndoCleaning}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo ({dataset.cleaningHistory.length})
            </button>
            <button
              type="button"
              disabled={dataset.cleaningHistory.length === 0}
              onClick={onResetDataset}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={() =>
                exportTableAsPDF({
                  title: `${dataset.name} (Cleaned)`,
                  subtitle: `Quality Score ${dataset.profile.qualityScore}/100 · ${dataset.profile.rowCount.toLocaleString()} rows · ${dataset.profile.columnCount} columns`,
                  columns: dataset.columns,
                  rows: dataset.rows,
                  accentHex,
                  filename: `${dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '')}_cleaned.pdf`,
                })
              }
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </button>
            <button
              type="button"
              onClick={() => exportDatasetAsCSV(dataset, '_cleaned')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => exportDatasetAsExcel(dataset, '_cleaned')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Download className="h-3.5 w-3.5" />
              XLSX
            </button>
          </div>
        </div>
      </section>

      {/* Automated Data Validation Checks */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {validationChecks.map((chk) => (
          <div
            key={chk.label}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{chk.label}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{chk.detail}</div>
            </div>
            <span
              className={`text-xs font-semibold ${
                chk.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {chk.pass ? 'Pass' : 'Review'}
            </span>
          </div>
        ))}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Preview Before Apply Panel */}
      {preview && pendingAction && (
        <section className="rounded-xl border border-indigo-300 bg-indigo-50/40 p-5 dark:border-indigo-700 dark:bg-indigo-950/20">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Preview Transformation</div>
              <h3 className="mt-0.5 font-display text-base font-semibold text-slate-900 dark:text-white">
                {preview.actionLabel}
              </h3>
              <p className="mt-1 text-xs text-slate-600 tabular-nums dark:text-slate-300">
                Affects {preview.affectedRowsCount.toLocaleString()} row(s) · Rows: {preview.beforeRowCount.toLocaleString()} →{' '}
                {preview.afterRowCount.toLocaleString()} · Projected Quality: {preview.beforeQualityScore} →{' '}
                {preview.afterQualityScore}/100
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingAction(null);
                  setPreview(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApply}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Apply Change
              </button>
            </div>
          </div>

          {preview.sampleDiffs.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-2 font-medium text-slate-500">Row</th>
                    <th className="px-3 py-2 font-medium text-slate-500">Column</th>
                    <th className="px-3 py-2 font-medium text-slate-500">Before</th>
                    <th className="px-3 py-2 font-medium text-slate-500">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {preview.sampleDiffs.map((diff, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-500">{diff.rowIndex}</td>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{diff.column}</td>
                      <td className="px-3 py-2 font-mono text-red-600 dark:text-red-400">{diff.before}</td>
                      <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">{diff.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              No records would be modified by this rule.
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Detected Issues List */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Detected Quality Issues ({issues.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Preview any recommended fix before modifying your dataset
              </p>
            </div>
          </div>

          {issues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              No missing values, duplicates, casing inconsistencies, or statistical outliers detected.
            </div>
          ) : (
            <div className="space-y-3">
              {issues.map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                      <AlertTriangle
                        className={`h-3.5 w-3.5 shrink-0 ${
                          issue.severity === 'high'
                            ? 'text-red-600'
                            : issue.severity === 'medium'
                              ? 'text-amber-600'
                              : 'text-slate-500'
                        }`}
                      />
                      <span>{issue.column ? `Column: ${issue.column}` : 'Dataset-wide'}</span>
                      <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                        · {issue.count.toLocaleString()} affected
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{issue.description}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handlePreview(issue.recommendedAction)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview Fix
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Custom Cleaning Action Builder */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Cleaning Action
            </h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Operation</label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as CleaningAction['type'])}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="fill_missing">Fill missing values</option>
                <option value="remove_missing_rows">Remove rows with missing values</option>
                <option value="remove_duplicates">Remove duplicate rows</option>
                <option value="standardize_text">Standardize text casing &amp; whitespace</option>
                <option value="standardize_dates">Standardize date formats (YYYY-MM-DD)</option>
                <option value="convert_type">Convert column data type</option>
                <option value="handle_outliers">Handle numeric outliers (IQR)</option>
                <option value="rename_column">Rename column</option>
              </select>
            </div>

            {actionType !== 'remove_duplicates' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Target Column</label>
                <select
                  value={activeCol}
                  onChange={(e) => setSelectedCol(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {dataset.columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {actionType === 'fill_missing' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Imputation Strategy</label>
                  <select
                    value={fillStrategy}
                    onChange={(e) => setFillStrategy(e.target.value as typeof fillStrategy)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="median">Median (numeric)</option>
                    <option value="mean">Mean (numeric)</option>
                    <option value="mode">Most frequent (mode)</option>
                    <option value="zero">Zero (0)</option>
                    <option value="custom">Custom value</option>
                  </select>
                </div>
                {fillStrategy === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Custom Replacement</label>
                    <input
                      type="text"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      placeholder="e.g. Unknown"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>
            )}

            {actionType === 'standardize_text' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Text Formatting</label>
                <select
                  value={textMode}
                  onChange={(e) => setTextMode(e.target.value as typeof textMode)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="trim">Trim whitespace only</option>
                  <option value="titlecase">Title Case + Trim</option>
                  <option value="lowercase">lowercase + Trim</option>
                  <option value="uppercase">UPPERCASE + Trim</option>
                </select>
              </div>
            )}

            {actionType === 'convert_type' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Convert To Type</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value as ColumnType)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="number">Number</option>
                  <option value="string">Text (String)</option>
                  <option value="date">Date (YYYY-MM-DD)</option>
                  <option value="boolean">Boolean (true/false)</option>
                </select>
              </div>
            )}

            {actionType === 'handle_outliers' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Outlier Strategy</label>
                <select
                  value={outlierStrategy}
                  onChange={(e) => setOutlierStrategy(e.target.value as 'cap' | 'remove')}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="cap">Cap at 1.5x IQR bounds (Winsorize)</option>
                  <option value="remove">Remove rows containing outliers</option>
                </select>
              </div>
            )}

            {actionType === 'rename_column' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">New Column Name</label>
                <input
                  type="text"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="Enter new column name"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => handlePreview(buildCustomAction())}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview Transformation
            </button>

            {dataset.cleaningHistory.length > 0 && (
              <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">Applied Steps</div>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {dataset.cleaningHistory.map((snap, idx) => (
                    <li key={snap.id} className="tabular-nums">
                      {idx + 1}. {snap.actionDescription}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
