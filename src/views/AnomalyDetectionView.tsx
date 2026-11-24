import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  GitCompare,
  Info,
  Loader2,
  Play,
  ScanSearch,
  Search,
  Sparkles,
} from 'lucide-react';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { AnalysisSkeleton } from '../components/Skeleton';
import { useThemeCustomization } from '../context/ThemeContext';
import { ANOMALY_ALGORITHMS, compareAnomalyAlgorithms, runAnomalyDetection } from '../engine/anomalyEngine';
import { parseNumericValue } from '../engine/parser';
import { exportRowsAsCSV, exportTableAsPDF } from '../engine/reportExporter';
import { requestAnomalyExplanations } from '../services/aiService';
import type {
  AIAnomalyExplanationResponse,
  AnomalyAlgorithmId,
  AnomalyComparisonSummary,
  AnomalyDetectionResult,
  AnomalyRecord,
  AnomalyReviewState,
  AnomalyReviewStatus,
  AnomalySeverity,
  Dataset,
  NavSectionId,
  TimeSeriesAnomalyPattern,
} from '../types/data';

interface AnomalyDetectionViewProps {
  dataset: Dataset | null;
  savedResult: AnomalyDetectionResult | null;
  reviews: Record<number, AnomalyReviewState>;
  onSaveResult: (res: AnomalyDetectionResult) => void;
  onUpdateReview: (rowIndex: number, status: AnomalyReviewStatus, note?: string) => void;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

const SEVERITY_COLORS: Record<AnomalySeverity, string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#38BDF8',
};

const REVIEW_STATUS_LABELS: Record<AnomalyReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  reviewed: 'Reviewed',
  expected: 'Expected Behavior',
  flagged: 'Flagged for Audit',
};

const TS_PATTERN_LABELS: Record<TimeSeriesAnomalyPattern, string> = {
  sudden_spike: 'Sudden Spike',
  sudden_drop: 'Sudden Drop',
  unexpected_fluctuation: 'Unexpected Fluctuation',
  trend_deviation: 'Trend Deviation',
  seasonal_deviation: 'Seasonal Deviation',
};

const CLASSIFICATION_LABELS: Record<
  'likely_data_quality_issue' | 'likely_legitimate_rare_event' | 'requires_domain_verification',
  { label: string; colorClass: string }
> = {
  likely_data_quality_issue: {
    label: 'Likely Data-Quality Issue',
    colorClass: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  likely_legitimate_rare_event: {
    label: 'Likely Legitimate Unusual Event',
    colorClass: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  requires_domain_verification: {
    label: 'Requires Domain Verification',
    colorClass: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  },
};

export const AnomalyDetectionView: React.FC<AnomalyDetectionViewProps> = ({
  dataset,
  savedResult,
  reviews,
  onSaveResult,
  onUpdateReview,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex } = useThemeCustomization();

  const numericCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name) : []),
    [dataset]
  );
  const dateCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'date').map((c) => c.name) : []),
    [dataset]
  );

  // Configuration state
  const [algorithm, setAlgorithm] = useState<AnomalyAlgorithmId>('auto');
  const [sensitivity, setSensitivity] = useState<'conservative' | 'balanced' | 'sensitive'>('balanced');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [dateCol, setDateCol] = useState<string>('');
  const [windowSize, setWindowSize] = useState<number>(7);
  const [kNeighbors, setKNeighbors] = useState<number>(10);
  const [running, setRunning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Filters & table state
  const [filterSeverity, setFilterSeverity] = useState<'all' | AnomalySeverity>('all');
  const [filterColumn, setFilterColumn] = useState<string>('all');
  const [filterReview, setFilterReview] = useState<'all' | AnomalyReviewStatus>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'score' | 'rowIndex' | 'severity'>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  // Scatter custom axes
  const [scatterX, setScatterX] = useState<string>('');
  const [scatterY, setScatterY] = useState<string>('');

  // Selected anomaly inspector + review note
  const [selectedRecord, setSelectedRecord] = useState<AnomalyRecord | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');
  const [selectedRowIndices, setSelectedRowIndices] = useState<number[]>([]);
  const [tsMetricCol, setTsMetricCol] = useState<string>('');

  // Multi-algorithm comparison state
  const [comparing, setComparing] = useState<boolean>(false);
  const [comparison, setComparison] = useState<AnomalyComparisonSummary | null>(null);

  // AI Explanation state
  const [aiExplaining, setAiExplaining] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResponse, setAiResponse] = useState<AIAnomalyExplanationResponse | null>(null);

  // Reset ephemeral UI controls when switching datasets
  useEffect(() => {
    setSelectedCols(numericCols.slice(0, 6));
    setDateCol(dateCols[0] || '');
    setTsMetricCol(numericCols[0] || '');
    setScatterX(numericCols[0] || '');
    setScatterY(numericCols[1] || numericCols[0] || '');
    setFilterSeverity('all');
    setFilterColumn('all');
    setFilterReview('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
    setPage(1);
    setSelectedRecord(null);
    setSelectedRowIndices([]);
    setComparison(null);
    setAiResponse(null);
    setAiError(null);
    setScanError(null);
  }, [dataset?.id, numericCols, dateCols]);

  // Auto-run initial scan once when entering Anomaly Studio for a dataset without cached result
  useEffect(() => {
    if (!dataset || numericCols.length === 0 || savedResult) return;
    const cols = numericCols.slice(0, 6);
    try {
      const res = runAnomalyDetection(dataset, {
        algorithm: 'auto',
        sensitivity: 'balanced',
        selectedColumns: cols,
        dateColumn: dateCols[0] || undefined,
      });
      onSaveResult(res);
    } catch {
      // Errors surfaced interactively when user clicks Run
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Anomaly Detection Studio"
        description="Upload a dataset to automatically scan for statistical outliers, time-series spikes, density anomalies, and unusual multivariate combinations."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const activeCols =
    selectedCols.filter((c) => numericCols.includes(c)).length > 0
      ? selectedCols.filter((c) => numericCols.includes(c))
      : numericCols.slice(0, Math.min(6, numericCols.length));

  const toggleColumn = (col: string) => {
    setSelectedCols((prev) => {
      const base = prev.filter((c) => numericCols.includes(c));
      const curr = base.length > 0 ? base : activeCols;
      if (curr.includes(col)) {
        return curr.length > 1 ? curr.filter((x) => x !== col) : curr;
      }
      return [...curr, col];
    });
  };

  const handleRunScan = () => {
    setScanError(null);
    setAiResponse(null);
    setSelectedRecord(null);
    setSelectedRowIndices([]);
    setPage(1);
    setRunning(true);

    // Ensure chosen Time-Series primary metric sits at position 0 when selected
    const orderedCols =
      tsMetricCol && numericCols.includes(tsMetricCol)
        ? [tsMetricCol, ...activeCols.filter((c) => c !== tsMetricCol)]
        : activeCols;

    setTimeout(() => {
      try {
        const res = runAnomalyDetection(dataset, {
          algorithm,
          sensitivity,
          selectedColumns: orderedCols,
          dateColumn: dateCol || undefined,
          windowSize,
          kNeighbors,
        });
        onSaveResult(res);
        onRecordHistory(
          `Anomaly Scan (${res.algorithmLabel})`,
          `Detected ${res.totalAnomalies} anomalies (${res.anomalyPct}%) across ${res.totalRecordsAnalyzed} rows in ${dataset.name}.`
        );
      } catch (err) {
        setScanError(err instanceof Error ? err.message : 'Anomaly scan failed.');
      } finally {
        setRunning(false);
      }
    }, 25);
  };

  const handleRunComparison = () => {
    if (numericCols.length === 0 || comparing) return;
    setScanError(null);
    setComparing(true);
    setTimeout(() => {
      try {
        const comp = compareAnomalyAlgorithms(dataset, {
          selectedColumns: activeCols,
          sensitivity,
          kNeighbors,
        });
        setComparison(comp);
        onRecordHistory(
          'Multi-Algorithm Anomaly Comparison',
          `Compared Z-Score, IQR, Isolation Forest, LOF, and DBSCAN across ${comp.totalRecordsAnalyzed} rows (${comp.consensusCount} consensus records).`
        );
      } catch (err) {
        setScanError(err instanceof Error ? err.message : 'Algorithm comparison failed.');
      } finally {
        setComparing(false);
      }
    }, 25);
  };

  const result = savedResult;

  // Filtered + sorted records
  const filteredRecords = useMemo(() => {
    if (!result) return [];
    const q = searchQuery.trim().toLowerCase();
    const sevWeight: Record<AnomalySeverity, number> = { high: 3, medium: 2, low: 1 };

    const list = result.records.filter((rec) => {
      if (filterSeverity !== 'all' && rec.severity !== filterSeverity) return false;
      if (filterColumn !== 'all' && !rec.affectedFeatures.includes(filterColumn)) return false;

      const revStatus: AnomalyReviewStatus = reviews[rec.rowIndex]?.status || 'unreviewed';
      if (filterReview !== 'all' && revStatus !== filterReview) return false;

      if (dateFrom && rec.dateValue && rec.dateValue < dateFrom) return false;
      if (dateTo && rec.dateValue && rec.dateValue > dateTo) return false;

      if (q) {
        const matches =
          String(rec.rowIndex).includes(q) ||
          rec.recordId.toLowerCase().includes(q) ||
          rec.affectedFeatures.some((f) => f.toLowerCase().includes(q)) ||
          rec.explanation.toLowerCase().includes(q) ||
          Object.values(rec.values).some((v) => String(v ?? '').toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'score') cmp = a.score - b.score;
      else if (sortBy === 'rowIndex') cmp = a.rowIndex - b.rowIndex;
      else cmp = sevWeight[a.severity] - sevWeight[b.severity];
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [result, filterSeverity, filterColumn, filterReview, dateFrom, dateTo, searchQuery, sortBy, sortDir, reviews]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRecords = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Live scatter points using user-chosen scatterX & scatterY axes
  const customScatter = useMemo(() => {
    if (!result || numericCols.length === 0) return { normal: [], high: [], medium: [], low: [] };
    const xKey = scatterX && numericCols.includes(scatterX) ? scatterX : numericCols[0];
    const yKey = scatterY && numericCols.includes(scatterY) ? scatterY : numericCols[1] || numericCols[0];
    const normal: Array<{ x: number; y: number; rowIndex: number; score: number }> = [];
    const high: Array<{ x: number; y: number; rowIndex: number; score: number }> = [];
    const medium: Array<{ x: number; y: number; rowIndex: number; score: number }> = [];
    const low: Array<{ x: number; y: number; rowIndex: number; score: number }> = [];

    dataset.rows.forEach((row, idx) => {
      const xv = xKey === yKey && numericCols.length === 1 ? idx + 1 : parseNumericValue(row[xKey]);
      const yv = parseNumericValue(row[yKey]);
      if (xv === null || yv === null) return;
      const flagged = result.allRowFlags[idx];
      const sc = result.allRowScores[idx] ?? 0;
      const pt = { x: Number(xv.toFixed(2)), y: Number(yv.toFixed(2)), rowIndex: idx + 1, score: sc };
      if (!flagged) {
        if (normal.length < 260) normal.push(pt);
      } else if (sc >= 72) {
        high.push(pt);
      } else if (sc >= 42) {
        medium.push(pt);
      } else {
        low.push(pt);
      }
    });
    return { normal, high, medium, low };
  }, [dataset.rows, numericCols, result, scatterX, scatterY]);

  const handleSort = (col: 'score' | 'rowIndex' | 'severity') => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const handleSelectRecord = (rec: AnomalyRecord) => {
    setSelectedRecord(rec);
    setNoteDraft(reviews[rec.rowIndex]?.note || '');
  };

  const handleExplainWithAI = async (targets: AnomalyRecord[]) => {
    if (!result || targets.length === 0 || aiExplaining) return;
    setAiError(null);
    setAiExplaining(true);
    try {
      const resp = await requestAnomalyExplanations(dataset, result, targets);
      setAiResponse(resp);
      onRecordHistory(
        'AI Anomaly Interpretation',
        `Explained ${targets.length} anomaly record(s) from ${result.algorithmLabel} scan.`
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Unable to generate AI anomaly explanations.');
    } finally {
      setAiExplaining(false);
    }
  };

  const selectedRecordsList = useMemo(
    () => filteredRecords.filter((r) => selectedRowIndices.includes(r.rowIndex)),
    [filteredRecords, selectedRowIndices]
  );

  const toggleRowSelect = (rowIndex: number) => {
    setSelectedRowIndices((prev) =>
      prev.includes(rowIndex) ? prev.filter((id) => id !== rowIndex) : [...prev, rowIndex]
    );
  };

  const togglePageSelect = () => {
    const pageIds = pagedRecords.map((r) => r.rowIndex);
    const allChecked = pageIds.length > 0 && pageIds.every((id) => selectedRowIndices.includes(id));
    if (allChecked) {
      setSelectedRowIndices((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedRowIndices((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleExportAnomaliesCSV = (recordsToExport: AnomalyRecord[] = filteredRecords, suffix = '') => {
    if (!result || recordsToExport.length === 0) return;
    const cols = [
      'Row_Index',
      'Record_ID',
      'Intensity_Score_0_100',
      'Severity',
      'Detection_Algorithm',
      'Affected_Columns',
      'Actual_Values',
      'Expected_Range',
      'Statistical_Evidence',
      'Review_Status',
      'Review_Note',
      'Explanation',
    ];
    const rows = recordsToExport.map((r) => ({
      Row_Index: r.rowIndex,
      Record_ID: r.recordId,
      Intensity_Score_0_100: r.score,
      Severity: r.severity.toUpperCase(),
      Detection_Algorithm: r.algorithmUsed,
      Affected_Columns: r.affectedFeatures.join('; '),
      Actual_Values: r.actualValuesSummary,
      Expected_Range: r.expectedValuesSummary,
      Statistical_Evidence: r.rawStatistic,
      Review_Status: REVIEW_STATUS_LABELS[reviews[r.rowIndex]?.status || 'unreviewed'],
      Review_Note: reviews[r.rowIndex]?.note || '',
      Explanation: r.explanation,
    }));
    exportRowsAsCSV(`${dataset.name}_anomalies${suffix}`, cols, rows);
  };

  const handleExportAnomaliesExcel = (recordsToExport: AnomalyRecord[] = filteredRecords, suffix = '') => {
    if (!result || recordsToExport.length === 0) return;
    const rows = recordsToExport.map((r) => ({
      Row_Index: r.rowIndex,
      Record_ID: r.recordId,
      Intensity_Score_0_100: r.score,
      Severity: r.severity.toUpperCase(),
      Detection_Algorithm: r.algorithmUsed,
      Affected_Columns: r.affectedFeatures.join('; '),
      Actual_Values: r.actualValuesSummary,
      Expected_Range: r.expectedValuesSummary,
      Statistical_Evidence: r.rawStatistic,
      Review_Status: REVIEW_STATUS_LABELS[reviews[r.rowIndex]?.status || 'unreviewed'],
      Review_Note: reviews[r.rowIndex]?.note || '',
      ...r.values,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Flagged_Anomalies');
    XLSX.writeFile(wb, `${dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '')}_anomalies${suffix}.xlsx`);
  };

  const handleExportAnomaliesPDF = (recordsToExport: AnomalyRecord[] = filteredRecords, suffix = '') => {
    if (!result || recordsToExport.length === 0) return;
    const cols = ['Row', 'Record', 'Score (0-100)', 'Severity', 'Algorithm', 'Actual Values', 'Expected Range', 'Review'];
    const rows = recordsToExport.map((r) => ({
      Row: `#${r.rowIndex}`,
      Record: r.recordId,
      'Score (0-100)': `${r.score}/100`,
      Severity: r.severity.toUpperCase(),
      Algorithm: r.algorithmUsed,
      'Actual Values': r.actualValuesSummary,
      'Expected Range': r.expectedValuesSummary,
      Review: REVIEW_STATUS_LABELS[reviews[r.rowIndex]?.status || 'unreviewed'],
    }));
    exportTableAsPDF({
      title: `Anomaly Investigation Report — ${dataset.name}`,
      subtitle: `${result.algorithmLabel} (${result.sensitivity}) · Exporting ${recordsToExport.length} of ${result.totalAnomalies} flagged records`,
      columns: cols,
      rows,
      accentHex,
      filename: `${dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '')}_anomalies${suffix}.pdf`,
    });
  };

  const activeMeta = ANOMALY_ALGORITHMS.find((a) => a.id === algorithm) || ANOMALY_ALGORITHMS[0];
  const severityChartData = result
    ? [
        { name: 'High Severity', count: result.highCount, fill: SEVERITY_COLORS.high },
        { name: 'Medium Severity', count: result.mediumCount, fill: SEVERITY_COLORS.medium },
        { name: 'Low Severity', count: result.lowCount, fill: SEVERITY_COLORS.low },
      ].filter((d) => d.count > 0)
    : [];

  return (
    <div className="space-y-6">
      {/* 1. Detection Controls */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ScanSearch className="h-4 w-4 shrink-0" style={{ color: accentHex }} />
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Anomaly Detection Studio
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Multi-algorithm outlier, time-series spike, density &amp; multivariate combination scanner
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunComparison}
              disabled={comparing || running || numericCols.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {comparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
              {comparing ? 'Comparing 5 Detectors...' : 'Compare 5 Algorithms'}
            </button>
            <button
              type="button"
              onClick={handleRunScan}
              disabled={running || numericCols.length === 0}
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {running ? 'Scanning Dataset...' : 'Run Anomaly Scan'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Detection Algorithm
            </label>
            <select
              aria-label="Anomaly detection algorithm"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as AnomalyAlgorithmId)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {ANOMALY_ALGORITHMS.map((alg) => (
                <option key={alg.id} value={alg.id}>
                  [{alg.category}] {alg.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{activeMeta.shortDesc}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Threshold Sensitivity
            </label>
            <select
              aria-label="Anomaly sensitivity"
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as 'conservative' | 'balanced' | 'sensitive')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="conservative">Conservative (Strict / Fewer Alerts)</option>
              <option value="balanced">Balanced (Recommended)</option>
              <option value="sensitive">Sensitive (Catch Subtle Shifts)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Date Column (Time-Series)
            </label>
            <select
              aria-label="Time-series date column"
              value={dateCol}
              onChange={(e) => setDateCol(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">None (Use Row Sequence)</option>
              {dateCols.map((dc) => (
                <option key={dc} value={dc}>
                  {dc}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Time-Series Metric
            </label>
            <select
              aria-label="Time-series numerical metric"
              value={tsMetricCol}
              onChange={(e) => setTsMetricCol(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {numericCols.map((nc) => (
                <option key={nc} value={nc}>
                  {nc}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(algorithm === 'moving_average' || algorithm === 'rolling_std' || algorithm === 'lof') && (
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            {(algorithm === 'moving_average' || algorithm === 'rolling_std') && (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>Rolling Window Size:</span>
                <input
                  type="number"
                  min={3}
                  max={60}
                  value={windowSize}
                  onChange={(e) => setWindowSize(Math.max(3, Math.min(60, Number(e.target.value))))}
                  className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            )}
            {algorithm === 'lof' && (
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span>k-Nearest Neighbors:</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={kNeighbors}
                  onChange={(e) => setKNeighbors(Math.max(3, Math.min(30, Number(e.target.value))))}
                  className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            )}
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Evaluated Numeric Features ({activeCols.length} selected)
          </div>
          {numericCols.length === 0 ? (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              No numeric columns found in this dataset.
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {numericCols.map((col) => {
                const selected = activeCols.includes(col);
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => toggleColumn(col)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                    }`}
                  >
                    {col}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {running && <AnalysisSkeleton label="Computing deterministic anomaly scores and neighborhood densities..." />}

      {scanError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}

      {!running && result && (
        <div className="space-y-6">
          {/* 2. Algorithm Resolution & Sampling Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accentHex }} />
              <div>
                <span className="font-semibold text-slate-900 dark:text-white">{result.algorithmLabel}: </span>
                <span className="text-slate-600 dark:text-slate-300">{result.autoDetectReason}</span>
              </div>
            </div>
            <div className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              {result.isSampled
                ? `Sampled ${result.sampledRecordsCount.toLocaleString()} / ${result.totalRecordsAnalyzed.toLocaleString()} rows`
                : `Full scan (${result.totalRecordsAnalyzed.toLocaleString()} rows)`}{' '}
              · {result.executionTimeMs} ms
            </div>
          </div>

          {/* 3. Dashboard KPI Cards */}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Records Analyzed</div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 tabular-nums dark:text-white">
                {result.totalRecordsAnalyzed.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Anomalies Flagged</div>
              <div className="mt-1 font-display text-xl font-bold tabular-nums" style={{ color: accentHex }}>
                {result.totalAnomalies.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Normal Records</div>
              <div className="mt-1 font-display text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                {result.normalRecords.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Anomaly Rate</div>
              <div className="mt-1 font-display text-xl font-bold text-slate-900 tabular-nums dark:text-white">
                {result.anomalyPct}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">High Severity</div>
              <div className="mt-1 font-display text-xl font-bold text-red-500 tabular-nums">
                {result.highCount.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Medium Severity</div>
              <div className="mt-1 font-display text-xl font-bold text-amber-500 tabular-nums">
                {result.mediumCount.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Low Severity</div>
              <div className="mt-1 font-display text-xl font-bold text-sky-400 tabular-nums">
                {result.lowCount.toLocaleString()}
              </div>
            </div>
          </section>

          {/* 4. 6 Interactive Visualizations */}
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Viz 1: Normal vs Anomalous Scatter */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Normal vs. Anomalous Distribution
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Overlay of flagged severity tiers over baseline population
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  {numericCols.length > 1 && (
                    <select
                      aria-label="Scatter X axis"
                      value={scatterX}
                      onChange={(e) => setScatterX(e.target.value)}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {numericCols.map((c) => (
                        <option key={c} value={c}>
                          X: {c}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    aria-label="Scatter Y axis"
                    value={scatterY}
                    onChange={(e) => setScatterY(e.target.value)}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                  >
                    {numericCols.map((c) => (
                      <option key={c} value={c}>
                        Y: {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={270}>
                <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis type="number" dataKey="x" name={scatterX || 'Index'} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis type="number" dataKey="y" name={scatterY || numericCols[0]} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Scatter name="Normal" data={customScatter.normal} fill="#64748B" fillOpacity={0.45} />
                  {customScatter.low.length > 0 && <Scatter name="Low Anomaly" data={customScatter.low} fill={SEVERITY_COLORS.low} />}
                  {customScatter.medium.length > 0 && <Scatter name="Medium Anomaly" data={customScatter.medium} fill={SEVERITY_COLORS.medium} />}
                  {customScatter.high.length > 0 && <Scatter name="High Anomaly" data={customScatter.high} fill={SEVERITY_COLORS.high} />}
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Viz 2: Time-Series / Sequential Anomaly Chart */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Sequential / Time-Series Anomaly Analysis ({result.featuresEvaluated[0]})
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {result.dateColumnUsed ? `Ordered chronologically by ${result.dateColumnUsed}` : 'Ordered sequentially'} · solid actual vs. dashed baseline
                  </p>
                </div>
                {result.timeSeriesPatternBreakdown && (
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {result.timeSeriesPatternBreakdown.sudden_spike > 0 && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        Spikes: {result.timeSeriesPatternBreakdown.sudden_spike}
                      </span>
                    )}
                    {result.timeSeriesPatternBreakdown.sudden_drop > 0 && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        Drops: {result.timeSeriesPatternBreakdown.sudden_drop}
                      </span>
                    )}
                    {result.timeSeriesPatternBreakdown.unexpected_fluctuation > 0 && (
                      <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        Fluctuations: {result.timeSeriesPatternBreakdown.unexpected_fluctuation}
                      </span>
                    )}
                    {result.timeSeriesPatternBreakdown.trend_deviation > 0 && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        Trend Shifts: {result.timeSeriesPatternBreakdown.trend_deviation}
                      </span>
                    )}
                    {result.timeSeriesPatternBreakdown.seasonal_deviation > 0 && (
                      <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                        Seasonal Dev: {result.timeSeriesPatternBreakdown.seasonal_deviation}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={270}>
                <LineChart data={result.timeSeriesPoints} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                    formatter={(val, name, item: { payload?: { patternType?: TimeSeriesAnomalyPattern; score?: number; isAnomaly?: boolean } }) => {
                      const labelStr = String(name ?? '');
                      if (labelStr === result.featuresEvaluated[0] && item?.payload?.isAnomaly) {
                        const pat = item.payload.patternType ? ` (${TS_PATTERN_LABELS[item.payload.patternType]})` : '';
                        return [`${val}${pat} · Score ${item.payload.score}/100`, labelStr];
                      }
                      return [String(val ?? ''), labelStr];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line
                    type="monotone"
                    dataKey="expectedValue"
                    name="Expected Baseline"
                    stroke="#94A3B8"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    name={result.featuresEvaluated[0]}
                    stroke={accentHex}
                    strokeWidth={2}
                    dot={(props: { cx?: number; cy?: number; payload?: { isAnomaly?: boolean; severity?: string }; index?: number }) => {
                      const { cx, cy, payload, index } = props;
                      if (cx === undefined || cy === undefined || !payload?.isAnomaly) {
                        return <circle key={`n_${index}`} cx={cx} cy={cy} r={0} />;
                      }
                      const color =
                        payload.severity === 'high'
                          ? SEVERITY_COLORS.high
                          : payload.severity === 'medium'
                            ? SEVERITY_COLORS.medium
                            : SEVERITY_COLORS.low;
                      return <circle key={`a_${index}`} cx={cx} cy={cy} r={5} fill={color} stroke="#0F172A" strokeWidth={1.5} />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Viz 3: Score Distribution Histogram */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Anomaly Intensity Score Distribution (0–100)
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Separation between normal tail density and flagged anomalies
                </p>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={result.scoreDistribution} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis dataKey="range" tick={{ fontSize: 10, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="normalCount" name="Normal" stackId="s" fill="#475569" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="anomalyCount" name="Flagged Anomalies" stackId="s" fill={SEVERITY_COLORS.high} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Viz 4: Feature Anomaly Comparison */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Feature Anomaly Contribution
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Frequency each feature appeared as a primary anomaly driver
                </p>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={result.columnBreakdown} layout="vertical" margin={{ top: 6, right: 20, left: 20, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis type="category" dataKey="column" width={110} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                  />
                  <Bar dataKey="anomalyCount" name="Anomalies" fill={accentHex} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Viz 5: Severity Breakdown */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Severity Tier Breakdown
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Distribution across High (≥72), Medium (42–71), and Low (&lt;42) score tiers
                </p>
              </div>
              {severityChartData.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-xs text-slate-500">
                  No anomalous records detected under active thresholds.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie
                      data={severityChartData}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="48%"
                      outerRadius="78%"
                      paddingAngle={3}
                    >
                      {severityChartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Viz 6: Correlation Impact Analysis */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-3">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Correlation Impact (Full Dataset vs. Normal Records)
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Reveals whether flagged anomalies distort linear feature correlations
                </p>
              </div>
              {result.correlationComparison.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-xs text-slate-500">
                  Select at least 2 numeric features to compare correlation distortion.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={result.correlationComparison} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="pair" tick={{ fontSize: 10, fill: '#64748B' }} />
                    <YAxis domain={[-1, 1]} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="allR" name="All Rows (r)" fill="#94A3B8" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="normalR" name="Normal Only (r)" fill={accentHex} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* 4b. Multi-Algorithm Comparison Section (Z-Score, IQR, Isolation Forest, LOF, DBSCAN) */}
          {comparison && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Multi-Algorithm Comparison (Z-Score · IQR · Isolation Forest · LOF · DBSCAN)
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sensitivity: {comparison.sensitivity} · Features: {comparison.featuresEvaluated.join(', ')} ({comparison.totalRecordsAnalyzed.toLocaleString()} rows)
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                  <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                    Unanimous (5/5): {comparison.unanimousCount}
                  </span>
                  <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                    Consensus (≥3/5): {comparison.consensusCount}
                  </span>
                  <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                    Single-Algorithm Only: {comparison.singleAlgorithmOnlyCount}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {comparison.calibrationWarning}
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Records Flagged per Algorithm
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={comparison.entries} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F8FAFC', fontSize: '12px' }}
                      />
                      <Bar dataKey="flaggedCount" name="Flagged Records" fill={accentHex} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Detector Breakdown &amp; Score Scale Semantics
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                      <tr>
                        <th className="px-2.5 py-2 font-semibold text-slate-700 dark:text-slate-200">Algorithm</th>
                        <th className="px-2.5 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">Flagged</th>
                        <th className="px-2.5 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">Rate</th>
                        <th className="px-2.5 py-2 font-semibold text-slate-700 dark:text-slate-200">Native Metric Basis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {comparison.entries.map((ent) => (
                        <tr key={ent.id}>
                          <td className="px-2.5 py-2 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {ent.label}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                            {ent.flaggedCount}
                          </td>
                          <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {ent.anomalyPct}%
                          </td>
                          <td className="px-2.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                            {ent.scoreScaleNote}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="overflow-x-auto">
                  <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Pairwise Overlap Matrix (Shared Flagged Rows · Jaccard %)
                  </div>
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                      <tr>
                        <th className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">Detector</th>
                        {comparison.entries.map((e) => (
                          <th key={e.id} className="px-2 py-2 text-center font-semibold text-slate-700 dark:text-slate-200">
                            {e.label.split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {comparison.pairwiseMatrix.map((row) => (
                        <tr key={row.algoA}>
                          <td className="px-2 py-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {row.labelA}
                          </td>
                          {row.values.map((cell) => (
                            <td key={cell.algoB} className="px-2 py-2 text-center font-mono tabular-nums text-slate-600 dark:text-slate-300">
                              {cell.overlapCount} <span className="text-[10px] text-slate-400">({cell.jaccardPct}%)</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto">
                  <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Key Disagreement Records (Caught by Some Detectors, Missed by Others)
                  </div>
                  {comparison.disagreementHighlights.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      All 5 algorithms agreed completely on every evaluated record.
                    </p>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <tr>
                          <th className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">Record</th>
                          <th className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">Agreement</th>
                          <th className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">Flagged By</th>
                          <th className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">Missed By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {comparison.disagreementHighlights.slice(0, 6).map((d) => (
                          <tr key={d.rowIndex}>
                            <td className="px-2 py-2 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {d.recordId}
                            </td>
                            <td className="px-2 py-2 font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {d.agreementRatio}
                            </td>
                            <td className="px-2 py-2 text-emerald-700 dark:text-emerald-400">
                              {d.flaggedBy.join(', ')}
                            </td>
                            <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                              {d.missedBy.join(', ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 5. Filters & Detailed Anomaly Investigation Table */}
          <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Anomaly Investigation Table ({filteredRecords.length.toLocaleString()} matching)
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click any record to open the detailed Investigation Panel. Note: Score (0–100) indicates relative anomaly intensity, not calibrated probability.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedRecordsList.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1 dark:border-indigo-900/60 dark:bg-indigo-950/30">
                    <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                      {selectedRecordsList.length} selected:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleExportAnomaliesCSV(selectedRecordsList, '_selected')}
                      className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
                    >
                      Export Selected CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportAnomaliesPDF(selectedRecordsList, '_selected')}
                      className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
                    >
                      Selected PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRowIndices([])}
                      className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400"
                    >
                      Clear
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleExplainWithAI(
                      selectedRecordsList.length > 0 ? selectedRecordsList.slice(0, 6) : filteredRecords.slice(0, 6)
                    )
                  }
                  disabled={aiExplaining || filteredRecords.length === 0}
                  style={{ backgroundColor: accentHex }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {aiExplaining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {selectedRecordsList.length > 0
                    ? `Explain ${Math.min(6, selectedRecordsList.length)} Selected with AI`
                    : 'Explain Top Anomalies with AI'}
                </button>
                <button
                  type="button"
                  onClick={() => handleExportAnomaliesCSV(filteredRecords)}
                  disabled={filteredRecords.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExportAnomaliesExcel(filteredRecords)}
                  disabled={filteredRecords.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => handleExportAnomaliesPDF(filteredRecords)}
                  disabled={filteredRecords.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDF
                </button>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
                <Filter className="h-3.5 w-3.5" />
                <span>Filters:</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search row, ID, value..."
                  className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                aria-label="Filter by severity"
                value={filterSeverity}
                onChange={(e) => {
                  setFilterSeverity(e.target.value as 'all' | AnomalySeverity);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All Severities</option>
                <option value="high">High Only</option>
                <option value="medium">Medium Only</option>
                <option value="low">Low Only</option>
              </select>

              <select
                aria-label="Filter by affected column"
                value={filterColumn}
                onChange={(e) => {
                  setFilterColumn(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All Affected Columns</option>
                {result.featuresEvaluated.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by review status"
                value={filterReview}
                onChange={(e) => {
                  setFilterReview(e.target.value as 'all' | AnomalyReviewStatus);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="all">All Review States</option>
                <option value="unreviewed">Unreviewed</option>
                <option value="reviewed">Reviewed</option>
                <option value="expected">Expected Behavior</option>
                <option value="flagged">Flagged for Audit</option>
              </select>

              {result.dateColumnUsed && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="date"
                    aria-label="Date range start"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  <span>to</span>
                  <input
                    type="date"
                    aria-label="Date range end"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setPage(1);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </div>
              )}
            </div>

            {/* Table */}
            {pagedRecords.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No anomalies match your current filter selection.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                    <tr>
                      <th className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label="Select all records on current page"
                          checked={
                            pagedRecords.length > 0 &&
                            pagedRecords.every((r) => selectedRowIndices.includes(r.rowIndex))
                          }
                          onChange={togglePageSelect}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                        <button type="button" onClick={() => handleSort('rowIndex')} className="inline-flex items-center gap-1">
                          Record ID <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Original Row Values</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Anomalous Features</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Actual Values</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Expected / Reference</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200" title="0-100 relative anomaly intensity (NOT probability)">
                        <button type="button" onClick={() => handleSort('score')} className="inline-flex items-center gap-1">
                          Score <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">
                        <button type="button" onClick={() => handleSort('severity')} className="inline-flex items-center gap-1">
                          Severity <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Algorithm</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Explanation</th>
                      <th className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {pagedRecords.map((rec) => {
                      const revStatus = reviews[rec.rowIndex]?.status || 'unreviewed';
                      const activeRow = selectedRecord?.rowIndex === rec.rowIndex;
                      const isChecked = selectedRowIndices.includes(rec.rowIndex);
                      const contextPreview = Object.entries(rec.values)
                        .filter(([k]) => !rec.affectedFeatures.includes(k))
                        .slice(0, 2)
                        .map(([k, v]) => `${k}: ${v ?? 'null'}`)
                        .join(' · ');
                      return (
                        <tr
                          key={rec.rowIndex}
                          onClick={() => handleSelectRecord(rec)}
                          className={`cursor-pointer transition-colors ${
                            activeRow
                              ? 'bg-indigo-50/70 dark:bg-indigo-950/35'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select record ${rec.recordId}`}
                              checked={isChecked}
                              onChange={() => toggleRowSelect(rec.rowIndex)}
                              className="h-3.5 w-3.5 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {rec.recordId}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px] truncate" title={contextPreview}>
                            {contextPreview || '—'}
                          </td>
                          <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                            {rec.affectedFeatures.join(', ')}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] text-slate-800 dark:text-slate-200">
                            {rec.actualValuesSummary}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-400 max-w-[200px]">
                            {rec.expectedValuesSummary}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                            {rec.score.toFixed(1)}
                          </td>
                          <td className="px-3 py-2.5 font-semibold uppercase whitespace-nowrap" style={{ color: SEVERITY_COLORS[rec.severity] }}>
                            {rec.severity}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {rec.algorithmUsed}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 max-w-xs">
                            <div>{rec.explanation}</div>
                            <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                              {rec.timeSeriesPattern ? `[${TS_PATTERN_LABELS[rec.timeSeriesPattern]}] ` : ''}
                              {rec.rawStatistic}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {REVIEW_STATUS_LABELS[revStatus]}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
                <span className="tabular-nums">
                  Page {safePage} of {totalPages} ({filteredRecords.length} rows)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* 6. Detailed Anomaly Investigation Panel & Human Review Workflow */}
          {selectedRecord && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                      Anomaly Investigation Panel — {selectedRecord.recordId}
                    </h4>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                      style={{ backgroundColor: SEVERITY_COLORS[selectedRecord.severity] }}
                    >
                      {selectedRecord.severity} · Score {selectedRecord.score}/100
                    </span>
                    <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      {selectedRecord.algorithmUsed}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {selectedRecord.explanation} Review annotations preserve history cleanly without altering original dataset rows.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleExplainWithAI([selectedRecord])}
                  disabled={aiExplaining}
                  style={{ backgroundColor: accentHex }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {aiExplaining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Explain This Anomaly with AI
                </button>
              </div>

              {/* Feature Actual vs. Expected Comparison */}
              {selectedRecord.featureComparisons.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Anomalous Feature Deviations (Actual vs. Expected Reference Range)
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <tr>
                          <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Feature</th>
                          <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Actual Value</th>
                          <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Expected / Reference Range</th>
                          <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Statistical Deviation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedRecord.featureComparisons.map((fc) => (
                          <tr key={fc.feature}>
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{fc.feature}</td>
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-white">
                              {fc.actualValue !== null ? fc.actualValue.toLocaleString() : 'null'}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                              {fc.expectedRange}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400">
                              {fc.deviationSummary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Original Row Snapshot */}
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Original Row Values Snapshot
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                  {Object.entries(selectedRecord.values).map(([col, val]) => {
                    const isAffected = selectedRecord.affectedFeatures.includes(col);
                    return (
                      <div
                        key={col}
                        className={`rounded-lg border p-2.5 text-xs ${
                          isAffected
                            ? 'border-amber-400/60 bg-amber-50/50 dark:border-amber-700/60 dark:bg-amber-950/20'
                            : 'border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/60'
                        }`}
                      >
                        <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={col}>
                          {col}
                        </div>
                        <div className="mt-0.5 truncate font-mono font-medium text-slate-900 dark:text-slate-100" title={String(val ?? 'null')}>
                          {val === null || val === undefined ? 'null' : String(val)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Quick Review Workflow Actions + Notes */}
              <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Anomaly Review Actions
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateReview(selectedRecord.rowIndex, 'reviewed', noteDraft)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        reviews[selectedRecord.rowIndex]?.status === 'reviewed'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                      }`}
                    >
                      Mark as Reviewed
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateReview(selectedRecord.rowIndex, 'expected', noteDraft)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        reviews[selectedRecord.rowIndex]?.status === 'expected'
                          ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                      }`}
                    >
                      Mark as Expected
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateReview(selectedRecord.rowIndex, 'flagged', noteDraft)}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        reviews[selectedRecord.rowIndex]?.status === 'flagged'
                          ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                      }`}
                    >
                      Flag for Investigation
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Analyst Investigation Note
                    </label>
                    <input
                      type="text"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Document context (e.g., Q4 enterprise renewal spike, verified against invoice)..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateReview(
                        selectedRecord.rowIndex,
                        reviews[selectedRecord.rowIndex]?.status || 'reviewed',
                        noteDraft
                      )
                    }
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    Save Note &amp; Review
                  </button>
                </div>

                {/* Review History Log */}
                {Array.isArray(reviews[selectedRecord.rowIndex]?.history) &&
                  (reviews[selectedRecord.rowIndex]?.history?.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        <Clock className="h-3.5 w-3.5" />
                        Preserved Review Audit History
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                        {reviews[selectedRecord.rowIndex].history!.map((h, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10px] text-slate-400">
                              {new Date(h.timestamp).toLocaleString()}
                            </span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {REVIEW_STATUS_LABELS[h.status]}
                            </span>
                            {h.note && <span className="italic">— &ldquo;{h.note}&rdquo;</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
              </div>
            </section>
          )}

          {/* 7. Gemini AI Anomaly Explanation Panel */}
          {aiError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{aiError}</span>
            </div>
          )}

          {aiResponse && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" style={{ color: accentHex }} />
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  Gemini AI Anomaly Explanation (Statistical Evidence vs. Cautious Assessment)
                </h4>
              </div>
              <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {aiResponse.executiveSummary}
              </p>
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>Methodological Boundary:</strong> {aiResponse.statisticalVsAiNote}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {aiResponse.recordExplanations.map((item) => {
                  const classMeta =
                    CLASSIFICATION_LABELS[item.classificationAssessment] ||
                    CLASSIFICATION_LABELS.requires_domain_verification;
                  return (
                    <div
                      key={item.rowIndex}
                      className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/60 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          Row #{item.rowIndex} · {item.detectionAlgorithm}
                        </span>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${classMeta.colorClass}`}>
                          {classMeta.label}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">Contributing Features: </span>
                        {item.contributingFeatures.join(', ')}
                      </div>
                      <div className="text-[11px] text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">Unusualness Magnitude: </span>
                        {item.howUnusual}
                      </div>
                      <div>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">Measured Evidence: </span>
                        <span className="text-slate-700 dark:text-slate-300">{item.statisticalEvidence}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-indigo-700 dark:text-indigo-400">AI Interpretation: </span>
                        <span className="text-slate-700 dark:text-slate-300">{item.aiInterpretation}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400">
                        <span className="font-semibold">Data Quality vs. Rare Event Rationale: </span>
                        {item.likelihoodReason}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold">Suggested Check: </span>
                        {item.suggestedCheck}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* 8. Algorithm Limitations & False-Positive Warnings */}
          {(result.limitations.length > 0 || result.falsePositiveWarnings.length > 0) && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                <span>Detector Assumptions &amp; False-Positive Guidance</span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-amber-900/90 dark:text-amber-200/90 list-disc pl-5">
                {result.falsePositiveWarnings.map((w, idx) => (
                  <li key={`fp_${idx}`}>{w}</li>
                ))}
                {result.limitations.map((lim, idx) => (
                  <li key={`lim_${idx}`}>{lim}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
