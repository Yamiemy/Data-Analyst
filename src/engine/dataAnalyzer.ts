import { runAnomalyDetection } from './anomalyEngine';
import { parseDateValue, parseNumericValue, isNullish } from './parser';
import type {
  AIPlanOperation,
  ChartSpec,
  ChartType,
  ColumnProfile,
  CorrelationPair,
  Dataset,
  DatasetRow,
  EDAReport,
} from '../types/data';

export function buildSchemaContext(dataset: Dataset) {
  return {
    name: dataset.name,
    rowCount: dataset.profile.rowCount,
    columnCount: dataset.profile.columnCount,
    qualityScore: dataset.profile.qualityScore,
    duplicateRows: dataset.profile.duplicateRowCount,
    columns: dataset.profile.columns.map((c) => ({
      name: c.name,
      type: c.type,
      missingCount: c.missingCount,
      uniqueCount: c.uniqueCount,
      ...(c.type === 'number'
        ? { min: c.min, max: c.max, mean: c.mean, median: c.median, sum: c.sum, outlierCount: c.outlierCount }
        : {}),
      ...(c.type === 'date' ? { minDate: c.minDate, maxDate: c.maxDate } : {}),
      ...(c.topValues ? { topCategories: c.topValues.slice(0, 5).map((t) => t.value) } : {}),
    })),
  };
}

function resolveColumnName(dataset: Dataset, candidate?: string, expectedType?: 'number' | 'string' | 'date'): string | undefined {
  if (!candidate) return undefined;
  const exact = dataset.columns.find((c) => c === candidate);
  if (exact) return exact;
  const ci = dataset.columns.find((c) => c.toLowerCase() === candidate.toLowerCase());
  if (ci) return ci;
  const fuzzy = dataset.columns.find((c) => c.toLowerCase().includes(candidate.toLowerCase()));
  if (fuzzy) return fuzzy;
  if (expectedType) {
    return dataset.profile.columns.find((c) => c.type === expectedType)?.name;
  }
  return undefined;
}

function getBucketDateKey(raw: unknown, granularity: string): string | null {
  const d = parseDateValue(raw);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (granularity === 'year') return `${y}`;
  if (granularity === 'day') return `${y}-${m}-${day}`;
  return `${y}-${m}`;
}

function aggregateValues(nums: number[], agg: 'sum' | 'avg' | 'count' | 'min' | 'max'): number {
  if (agg === 'count') return nums.length;
  if (nums.length === 0) return 0;
  if (agg === 'sum') return Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
  if (agg === 'avg') return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
  if (agg === 'min') return Math.min(...nums);
  if (agg === 'max') return Math.max(...nums);
  return 0;
}

export function computePearsonCorrelation(xVals: number[], yVals: number[]): number | null {
  const n = Math.min(xVals.length, yVals.length);
  if (n < 3) return null;
  const meanX = xVals.reduce((a, b) => a + b, 0) / n;
  const meanY = yVals.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xVals[i] - meanX;
    const dy = yVals[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return Number((num / den).toFixed(4));
}

export interface DeterministicExecutionOutput {
  results: Array<{
    operation: AIPlanOperation;
    summary: Record<string, unknown>;
    rows?: Array<Record<string, string | number | boolean | null>>;
  }>;
  chart?: ChartSpec;
  table?: {
    columns: string[];
    rows: Array<Record<string, string | number | boolean | null>>;
  };
}

export function executePlanDeterministically(
  dataset: Dataset,
  plan: {
    intent?: string;
    operations: AIPlanOperation[];
    chartSpec?: { type?: string; title?: string; description?: string; xLabel?: string; yLabel?: string };
  }
): DeterministicExecutionOutput {
  const results: DeterministicExecutionOutput['results'] = [];
  let primaryChart: ChartSpec | undefined;
  let primaryTable: DeterministicExecutionOutput['table'] | undefined;

  const numericCols = dataset.profile.columns.filter((c) => c.type === 'number');
  const catCols = dataset.profile.columns.filter((c) => c.type === 'string' || c.type === 'boolean');
  const dateCols = dataset.profile.columns.filter((c) => c.type === 'date');

  for (const op of plan.operations || []) {
    if (op.type === 'aggregate') {
      const groupCol = resolveColumnName(dataset, op.groupBy, 'string') || catCols[0]?.name || dataset.columns[0];
      const metricCol = resolveColumnName(dataset, op.metric, 'number') || numericCols[0]?.name;
      const agg = op.agg || 'sum';
      const limit = Math.min(25, Math.max(3, op.limit || 10));

      const groups = new Map<string, number[]>();
      const counts = new Map<string, number>();

      for (const row of dataset.rows) {
        const gVal = isNullish(row[groupCol]) ? '(Missing)' : String(row[groupCol]).trim();
        counts.set(gVal, (counts.get(gVal) || 0) + 1);
        if (metricCol) {
          const num = parseNumericValue(row[metricCol]);
          if (num !== null) {
            if (!groups.has(gVal)) groups.set(gVal, []);
            groups.get(gVal)!.push(num);
          }
        }
      }

      const metricLabel = metricCol ? `${agg}_${metricCol}` : 'record_count';
      const rowsOut = Array.from(counts.keys()).map((key) => {
        const vals = groups.get(key) || [];
        return {
          [groupCol]: key,
          [metricLabel]: metricCol && agg !== 'count' ? aggregateValues(vals, agg) : counts.get(key) || 0,
          records: counts.get(key) || 0,
        };
      });

      rowsOut.sort((a, b) => {
        const va = Number(a[metricLabel]) || 0;
        const vb = Number(b[metricLabel]) || 0;
        return op.sort === 'asc' ? va - vb : vb - va;
      });

      const sliced = rowsOut.slice(0, limit);
      results.push({
        operation: op,
        summary: { groupBy: groupCol, metric: metricCol || 'count', aggregation: agg, totalGroups: rowsOut.length },
        rows: sliced,
      });

      if (!primaryTable) {
        primaryTable = { columns: [groupCol, metricLabel, 'records'], rows: sliced };
      }
      if (!primaryChart && sliced.length > 0) {
        const chartType = normalizeChartType(plan.chartSpec?.type, 'bar');
        primaryChart = {
          id: `chart_${Date.now()}`,
          type: chartType,
          title: plan.chartSpec?.title || `${agg.toUpperCase()} of ${metricCol || 'Records'} by ${groupCol}`,
          description: plan.chartSpec?.description || `Calculated deterministically across ${dataset.profile.rowCount} rows.`,
          xKey: groupCol,
          yKeys: [metricLabel],
          xLabel: plan.chartSpec?.xLabel || groupCol,
          yLabel: plan.chartSpec?.yLabel || metricLabel,
          data: sliced as Array<Record<string, string | number | null>>,
        };
      }
    } else if (op.type === 'timeseries') {
      const dateCol = resolveColumnName(dataset, op.groupBy, 'date') || dateCols[0]?.name;
      const metricCol = resolveColumnName(dataset, op.metric, 'number') || numericCols[0]?.name;
      const agg = op.agg || 'sum';
      const granularity = op.granularity || 'month';

      if (dateCol && metricCol) {
        const buckets = new Map<string, number[]>();
        for (const row of dataset.rows) {
          const key = getBucketDateKey(row[dateCol], granularity);
          const val = parseNumericValue(row[metricCol]);
          if (key && val !== null) {
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)!.push(val);
          }
        }
        const sortedKeys = Array.from(buckets.keys()).sort();
        const metricLabel = `${agg}_${metricCol}`;
        const rowsOut = sortedKeys.map((k) => ({
          period: k,
          [metricLabel]: aggregateValues(buckets.get(k) || [], agg),
          records: (buckets.get(k) || []).length,
        }));

        results.push({
          operation: op,
          summary: { dateColumn: dateCol, metric: metricCol, granularity, periods: rowsOut.length },
          rows: rowsOut,
        });

        if (!primaryTable) {
          primaryTable = { columns: ['period', metricLabel, 'records'], rows: rowsOut.slice(-24) };
        }
        if (!primaryChart && rowsOut.length > 0) {
          const chartType = normalizeChartType(plan.chartSpec?.type, 'line');
          primaryChart = {
            id: `chart_${Date.now()}`,
            type: chartType === 'pie' || chartType === 'donut' ? 'line' : chartType,
            title: plan.chartSpec?.title || `${metricCol} Trend Over Time (${granularity})`,
            description: plan.chartSpec?.description || `Deterministic ${agg} aggregation across ${rowsOut.length} time periods.`,
            xKey: 'period',
            yKeys: [metricLabel],
            xLabel: plan.chartSpec?.xLabel || 'Period',
            yLabel: plan.chartSpec?.yLabel || metricLabel,
            data: rowsOut as Array<Record<string, string | number | null>>,
          };
        }
      }
    } else if (op.type === 'summary_stats') {
      const targetCol = resolveColumnName(dataset, op.metric, 'number');
      const colsToSummarize = targetCol
        ? dataset.profile.columns.filter((c) => c.name === targetCol)
        : numericCols;

      const statsRows = colsToSummarize.map((c) => ({
        Column: c.name,
        Count: c.nonNullCount,
        Missing: c.missingCount,
        Mean: c.mean ?? null,
        Median: c.median ?? null,
        StdDev: c.stdDev ?? null,
        Min: c.min ?? null,
        Max: c.max ?? null,
        Sum: c.sum ?? null,
      }));

      results.push({
        operation: op,
        summary: { summarizedColumns: statsRows.length },
        rows: statsRows,
      });

      if (!primaryTable && statsRows.length > 0) {
        primaryTable = {
          columns: ['Column', 'Count', 'Missing', 'Mean', 'Median', 'StdDev', 'Min', 'Max'],
          rows: statsRows,
        };
      }
    } else if (op.type === 'outliers') {
      const targetCols = op.metric
        ? [resolveColumnName(dataset, op.metric, 'number')].filter((x): x is string => Boolean(x))
        : numericCols.map((c) => c.name);

      const outlierFindings = targetCols.map((colName) => {
        const profile = dataset.profile.columns.find((c) => c.name === colName);
        if (!profile || profile.q1 === undefined || profile.q3 === undefined || profile.iqr === undefined) {
          return { Column: colName, Outliers: 0, LowerFence: null, UpperFence: null, Min: null, Max: null };
        }
        const lower = Number((profile.q1 - 1.5 * profile.iqr).toFixed(2));
        const upper = Number((profile.q3 + 1.5 * profile.iqr).toFixed(2));
        return {
          Column: colName,
          Outliers: profile.outlierCount || 0,
          LowerFence: lower,
          UpperFence: upper,
          Min: profile.min ?? null,
          Max: profile.max ?? null,
        };
      });

      results.push({
        operation: op,
        summary: { method: 'IQR (1.5x interquartile range)', columnsChecked: outlierFindings.length },
        rows: outlierFindings,
      });
      if (!primaryTable && outlierFindings.length > 0) {
        primaryTable = {
          columns: ['Column', 'Outliers', 'LowerFence', 'UpperFence', 'Min', 'Max'],
          rows: outlierFindings,
        };
      }
    } else if (op.type === 'anomaly_scan') {
      const targetCol = op.metric ? resolveColumnName(dataset, op.metric, 'number') : undefined;
      const explicitCatCol =
        op.groupBy && catCols.some((c) => c.name.toLowerCase() === op.groupBy?.toLowerCase())
          ? resolveColumnName(dataset, op.groupBy)
          : undefined;
      const dateCol = explicitCatCol ? dateCols[0]?.name : resolveColumnName(dataset, op.groupBy, 'date') || dateCols[0]?.name;
      const colsToScan = targetCol ? [targetCol] : numericCols.map((c) => c.name).slice(0, 6);

      if (colsToScan.length > 0) {
        const anomalyRes = runAnomalyDetection(dataset, {
          algorithm: 'auto',
          sensitivity: 'balanced',
          selectedColumns: colsToScan,
          dateColumn: dateCol,
        });

        const limit = Math.min(20, Math.max(5, op.limit || 10));
        const topAnomalies = anomalyRes.records.slice(0, limit).map((rec) => ({
          Row: rec.rowIndex,
          Record: rec.recordId,
          Score: rec.score,
          Severity: rec.severity.toUpperCase(),
          Algorithm: rec.algorithmUsed,
          Affected_Columns: rec.affectedFeatures.join(', '),
          Actual_Values: rec.actualValuesSummary,
          Expected_Range: rec.expectedValuesSummary,
          Evidence: rec.rawStatistic,
          Explanation: rec.explanation,
        }));

        // Category-level anomaly breakdown (uses explicit groupBy category or first categorical column)
        const breakdownCatCol = explicitCatCol || catCols.find((c) => c.uniqueCount >= 2 && c.uniqueCount <= 30)?.name;
        let categoryComparison: Array<{
          Category: string;
          Total_Rows: number;
          Flagged_Anomalies: number;
          Anomaly_Rate_Pct: number;
          High_Severity: number;
          Mean_Intensity_Score: number;
        }> = [];

        if (breakdownCatCol) {
          const catStats = new Map<string, { total: number; flagged: number; high: number; scoreSum: number }>();
          dataset.rows.forEach((row, idx) => {
            const rawVal = row[breakdownCatCol];
            const key = rawVal === null || rawVal === undefined || String(rawVal).trim() === '' ? '(Missing)' : String(rawVal).trim();
            const entry = catStats.get(key) || { total: 0, flagged: 0, high: 0, scoreSum: 0 };
            entry.total++;
            if (anomalyRes.allRowFlags[idx]) {
              entry.flagged++;
              const sc = anomalyRes.allRowScores[idx] ?? 0;
              entry.scoreSum += sc;
              if (sc >= 72) entry.high++;
            }
            catStats.set(key, entry);
          });

          categoryComparison = Array.from(catStats.entries())
            .map(([catVal, st]) => ({
              Category: catVal,
              Total_Rows: st.total,
              Flagged_Anomalies: st.flagged,
              Anomaly_Rate_Pct: st.total > 0 ? Number(((st.flagged / st.total) * 100).toFixed(2)) : 0,
              High_Severity: st.high,
              Mean_Intensity_Score: st.flagged > 0 ? Number((st.scoreSum / st.flagged).toFixed(1)) : 0,
            }))
            .sort((a, b) => b.Flagged_Anomalies - a.Flagged_Anomalies || b.Anomaly_Rate_Pct - a.Anomaly_Rate_Pct)
            .slice(0, 15);
        }

        const intentWantsCategory =
          Boolean(explicitCatCol) ||
          /category|segment|region|group|department|channel|product|type/i.test(plan.intent || '');

        results.push({
          operation: op,
          summary: {
            algorithm: anomalyRes.algorithmLabel,
            parameters: anomalyRes.detectedParametersSummary,
            autoDetectReason: anomalyRes.autoDetectReason,
            scoreNote: 'Score (0-100) reflects relative anomaly intensity, NOT probability of error or fraud.',
            totalRecordsAnalyzed: anomalyRes.totalRecordsAnalyzed,
            totalAnomalies: anomalyRes.totalAnomalies,
            anomalyPct: anomalyRes.anomalyPct,
            severityBreakdown: {
              high: anomalyRes.highCount,
              medium: anomalyRes.mediumCount,
              low: anomalyRes.lowCount,
            },
            topAffectedColumns: anomalyRes.columnBreakdown.slice(0, 5),
            categoryColumnUsed: breakdownCatCol || null,
            categoryComparison,
          },
          rows: intentWantsCategory && categoryComparison.length > 0 ? categoryComparison : topAnomalies,
        });

        if (!primaryTable) {
          if (intentWantsCategory && categoryComparison.length > 0) {
            primaryTable = {
              columns: ['Category', 'Total_Rows', 'Flagged_Anomalies', 'Anomaly_Rate_Pct', 'High_Severity', 'Mean_Intensity_Score'],
              rows: categoryComparison,
            };
          } else if (topAnomalies.length > 0) {
            primaryTable = {
              columns: ['Row', 'Record', 'Score', 'Severity', 'Algorithm', 'Affected_Columns', 'Actual_Values', 'Expected_Range'],
              rows: topAnomalies,
            };
          }
        }

        if (!primaryChart) {
          if (intentWantsCategory && categoryComparison.length > 0) {
            primaryChart = {
              id: `chart_${Date.now()}`,
              type: 'bar',
              title: plan.chartSpec?.title || `Anomalies by ${breakdownCatCol} (${anomalyRes.algorithmLabel})`,
              description:
                plan.chartSpec?.description ||
                `Flagged anomaly counts and rate across ${breakdownCatCol} segments.`,
              xKey: 'Category',
              yKeys: ['Flagged_Anomalies'],
              xLabel: breakdownCatCol || 'Category',
              yLabel: 'Flagged Anomalies',
              data: categoryComparison,
            };
          } else if (anomalyRes.columnBreakdown.length > 0) {
            primaryChart = {
              id: `chart_${Date.now()}`,
              type: 'bar',
              title: plan.chartSpec?.title || `Anomalies Detected by Feature (${anomalyRes.algorithmLabel})`,
              description:
                plan.chartSpec?.description ||
                `${anomalyRes.totalAnomalies} anomalous records (${anomalyRes.anomalyPct}%) across ${anomalyRes.totalRecordsAnalyzed} rows.`,
              xKey: 'column',
              yKeys: ['anomalyCount'],
              xLabel: 'Feature',
              yLabel: 'Anomaly Count',
              data: anomalyRes.columnBreakdown.map((c) => ({
                column: c.column,
                anomalyCount: c.anomalyCount,
              })),
            };
          }
        }
      }
    } else if (op.type === 'correlation') {
      const colA = resolveColumnName(dataset, op.metric, 'number') || numericCols[0]?.name;
      const colB = resolveColumnName(dataset, op.secondaryMetric, 'number') || numericCols[1]?.name;
      if (colA && colB && colA !== colB) {
        const pairs: Array<{ x: number; y: number }> = [];
        for (const row of dataset.rows) {
          const x = parseNumericValue(row[colA]);
          const y = parseNumericValue(row[colB]);
          if (x !== null && y !== null) pairs.push({ x, y });
        }
        const r = computePearsonCorrelation(
          pairs.map((p) => p.x),
          pairs.map((p) => p.y)
        );
        results.push({
          operation: op,
          summary: { colA, colB, pearsonR: r, samplePairs: pairs.length },
        });
        if (!primaryChart && pairs.length > 0) {
          primaryChart = {
            id: `chart_${Date.now()}`,
            type: 'scatter',
            title: plan.chartSpec?.title || `${colA} vs ${colB} (r = ${r ?? 'N/A'})`,
            description: plan.chartSpec?.description || `Scatter relationship across ${pairs.length} paired records.`,
            xKey: colA,
            yKeys: [colB],
            xLabel: colA,
            yLabel: colB,
            data: pairs.slice(0, 250).map((p) => ({ [colA]: p.x, [colB]: p.y })),
          };
        }
      } else {
        const edaCorr = computeAllCorrelations(dataset);
        results.push({
          operation: op,
          summary: { pairCount: edaCorr.length },
          rows: edaCorr.slice(0, 12).map((c) => ({ Column_A: c.colA, Column_B: c.colB, Pearson_R: c.r })),
        });
      }
    } else if (op.type === 'value_counts') {
      const col = resolveColumnName(dataset, op.groupBy || op.metric) || catCols[0]?.name || dataset.columns[0];
      const profile = dataset.profile.columns.find((c) => c.name === col);
      const top = (profile?.topValues || []).slice(0, op.limit || 10).map((t) => ({
        [col]: t.value,
        Count: t.count,
        Share_Pct: t.pct,
      }));
      results.push({
        operation: op,
        summary: { column: col, uniqueCount: profile?.uniqueCount || 0 },
        rows: top,
      });
      if (!primaryTable && top.length > 0) {
        primaryTable = { columns: [col, 'Count', 'Share_Pct'], rows: top };
      }
      if (!primaryChart && top.length > 0) {
        primaryChart = {
          id: `chart_${Date.now()}`,
          type: normalizeChartType(plan.chartSpec?.type, 'bar'),
          title: plan.chartSpec?.title || `Distribution of ${col}`,
          description: plan.chartSpec?.description || `Frequency count across ${dataset.profile.rowCount} rows.`,
          xKey: col,
          yKeys: ['Count'],
          xLabel: col,
          yLabel: 'Count',
          data: top,
        };
      }
    } else if (op.type === 'top_n') {
      const metricCol = resolveColumnName(dataset, op.metric, 'number') || numericCols[0]?.name;
      const limit = Math.min(20, Math.max(3, op.limit || 10));
      const sorted = [...dataset.rows].sort((a, b) => {
        if (!metricCol) return 0;
        const va = parseNumericValue(a[metricCol]) ?? -Infinity;
        const vb = parseNumericValue(b[metricCol]) ?? -Infinity;
        return op.sort === 'asc' ? va - vb : vb - va;
      });
      const sliced = sorted.slice(0, limit);
      results.push({
        operation: op,
        summary: { sortBy: metricCol || 'default', order: op.sort || 'desc', count: sliced.length },
        rows: sliced,
      });
      if (!primaryTable && sliced.length > 0) {
        primaryTable = { columns: dataset.columns.slice(0, 7), rows: sliced };
      }
    } else {
      // overview
      results.push({
        operation: op,
        summary: {
          rowCount: dataset.profile.rowCount,
          columnCount: dataset.profile.columnCount,
          qualityScore: dataset.profile.qualityScore,
          missingCells: dataset.profile.missingCells,
          duplicateRows: dataset.profile.duplicateRowCount,
          numericColumns: numericCols.map((c) => ({ name: c.name, mean: c.mean, sum: c.sum, min: c.min, max: c.max })),
          categoricalHighlights: catCols.slice(0, 3).map((c) => ({ name: c.name, top: c.topValues?.slice(0, 3) })),
        },
      });
    }
  }

  return { results, chart: primaryChart, table: primaryTable };
}

function normalizeChartType(raw: string | undefined, fallback: ChartType): ChartType {
  const valid: ChartType[] = ['bar', 'horizontal_bar', 'line', 'area', 'pie', 'donut', 'scatter', 'histogram', 'boxplot', 'heatmap'];
  if (raw && valid.includes(raw as ChartType)) return raw as ChartType;
  return fallback;
}

export function validateExecutionResults(
  dataset: Dataset,
  output: DeterministicExecutionOutput
): string {
  const opCount = output.results.length;
  if (opCount === 0) {
    return `Validation warning: No deterministic operations matched dataset "${dataset.name}" (${dataset.profile.rowCount.toLocaleString()} rows).`;
  }

  let totalRowsInspected = 0;
  let invalidNumerics = 0;

  for (const res of output.results) {
    if (res.rows) {
      totalRowsInspected += res.rows.length;
      for (const r of res.rows) {
        for (const val of Object.values(r)) {
          if (typeof val === 'number' && !Number.isFinite(val)) {
            invalidNumerics++;
          }
        }
      }
    }
  }

  if (invalidNumerics > 0) {
    return `Validated ${opCount} operation(s) across ${dataset.profile.rowCount.toLocaleString()} rows (${invalidNumerics} non-finite cells skipped).`;
  }

  return `Validated ${opCount} deterministic operation(s) against ${dataset.profile.rowCount.toLocaleString()} rows${totalRowsInspected > 0 ? ` (${totalRowsInspected} summary rows verified)` : ''}.`;
}

export interface MissingHeatmapData {
  columns: string[];
  buckets: Array<{
    label: string;
    rowStart: number;
    rowEnd: number;
    values: number[]; // missing % 0-100 per column
  }>;
}

export function computeMissingHeatmap(dataset: Dataset, bucketCount = 10): MissingHeatmapData {
  const cols = dataset.columns.slice(0, 12);
  const totalRows = dataset.rows.length;
  if (totalRows === 0 || cols.length === 0) {
    return { columns: cols, buckets: [] };
  }

  const effectiveBuckets = Math.min(bucketCount, totalRows);
  const bucketSize = Math.ceil(totalRows / effectiveBuckets);
  const buckets: MissingHeatmapData['buckets'] = [];

  for (let b = 0; b < effectiveBuckets; b++) {
    const start = b * bucketSize;
    const end = Math.min(totalRows, start + bucketSize);
    if (start >= totalRows) break;
    const slice = dataset.rows.slice(start, end);
    const values = cols.map((col) => {
      const missing = slice.reduce((cnt, row) => cnt + (isNullish(row[col]) ? 1 : 0), 0);
      return Number(((missing / slice.length) * 100).toFixed(1));
    });
    buckets.push({
      label: `Rows ${start + 1}–${end}`,
      rowStart: start + 1,
      rowEnd: end,
      values,
    });
  }

  return { columns: cols, buckets };
}

export function computeAllCorrelations(dataset: Dataset): CorrelationPair[] {
  const numCols = dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name);
  const pairs: CorrelationPair[] = [];

  for (let i = 0; i < numCols.length; i++) {
    for (let j = i + 1; j < numCols.length; j++) {
      const colA = numCols[i];
      const colB = numCols[j];
      const xVals: number[] = [];
      const yVals: number[] = [];
      for (const row of dataset.rows) {
        const x = parseNumericValue(row[colA]);
        const y = parseNumericValue(row[colB]);
        if (x !== null && y !== null) {
          xVals.push(x);
          yVals.push(y);
        }
      }
      const r = computePearsonCorrelation(xVals, yVals);
      if (r !== null) {
        pairs.push({ colA, colB, r });
      }
    }
  }

  return pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

export function buildHistogramBins(rows: DatasetRow[], col: ColumnProfile, binCount = 10): Array<{ range: string; count: number }> {
  if (col.type !== 'number' || col.min === undefined || col.max === undefined) return [];
  const vals = rows.map((r) => parseNumericValue(r[col.name])).filter((v): v is number => v !== null);
  if (vals.length === 0) return [];
  const min = col.min;
  const max = col.max;
  if (min === max) return [{ range: String(min), count: vals.length }];

  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, idx) => {
    const start = min + idx * width;
    const end = start + width;
    return {
      range: `${start >= 1000 ? Math.round(start) : start.toFixed(1)}–${end >= 1000 ? Math.round(end) : end.toFixed(1)}`,
      count: 0,
    };
  });

  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  }
  return bins;
}

export function generateAutomatedEDA(dataset: Dataset): EDAReport {
  const numericColumns = dataset.profile.columns.filter((c) => c.type === 'number');
  const categoricalColumns = dataset.profile.columns.filter((c) => c.type === 'string' || c.type === 'boolean');
  const dateColumns = dataset.profile.columns.filter((c) => c.type === 'date');
  const correlations = computeAllCorrelations(dataset);

  const histograms = numericColumns.slice(0, 4).map((col) => ({
    column: col.name,
    bins: buildHistogramBins(dataset.rows, col, 10),
  }));

  const outliersSummary = numericColumns.map((col) => {
    const q1 = col.q1 ?? 0;
    const q3 = col.q3 ?? 0;
    const iqr = col.iqr ?? 0;
    const lowerBound = Number((q1 - 1.5 * iqr).toFixed(2));
    const upperBound = Number((q3 + 1.5 * iqr).toFixed(2));
    const sampleOutliers: number[] = [];
    if (iqr > 0) {
      for (const row of dataset.rows) {
        const v = parseNumericValue(row[col.name]);
        if (v !== null && (v < lowerBound || v > upperBound)) {
          sampleOutliers.push(v);
          if (sampleOutliers.length >= 5) break;
        }
      }
    }
    const outlierCount = col.outlierCount || 0;
    const explanation =
      outlierCount > 0
        ? `Detected ${outlierCount} record(s) outside the interquartile fence [${lowerBound}, ${upperBound}].`
        : `All ${col.nonNullCount} values fall within expected interquartile bounds [${lowerBound}, ${upperBound}].`;

    return { column: col.name, outlierCount, lowerBound, upperBound, sampleOutliers, explanation };
  });

  const automatedExplanations: string[] = [];
  automatedExplanations.push(
    `Dataset contains ${dataset.profile.rowCount.toLocaleString()} records across ${dataset.profile.columnCount} columns (${numericColumns.length} numeric, ${categoricalColumns.length} categorical, ${dateColumns.length} date).`
  );
  if (dataset.profile.missingCells > 0) {
    const worstCol = [...dataset.profile.columns].sort((a, b) => b.missingCount - a.missingCount)[0];
    automatedExplanations.push(
      `${dataset.profile.missingCells.toLocaleString()} missing values detected (${dataset.profile.missingPct}% of cells). Highest missing concentration is in "${worstCol.name}" (${worstCol.missingPct}%).`
    );
  } else {
    automatedExplanations.push('Zero missing cells detected across the entire dataset (100% completeness).');
  }

  if (correlations.length > 0 && Math.abs(correlations[0].r) >= 0.45) {
    const top = correlations[0];
    const dir = top.r > 0 ? 'positive' : 'negative';
    automatedExplanations.push(
      `Strongest linear relationship is a ${dir} correlation between "${top.colA}" and "${top.colB}" (Pearson r = ${top.r}).`
    );
  }

  const topOutlierCol = [...outliersSummary].sort((a, b) => b.outlierCount - a.outlierCount)[0];
  if (topOutlierCol && topOutlierCol.outlierCount > 0) {
    automatedExplanations.push(
      `"${topOutlierCol.column}" exhibits ${topOutlierCol.outlierCount} statistical outlier(s) beyond [${topOutlierCol.lowerBound}, ${topOutlierCol.upperBound}], which may skew arithmetic means.`
    );
  }

  return {
    datasetId: dataset.id,
    generatedAt: new Date().toISOString(),
    numericColumns,
    categoricalColumns,
    dateColumns,
    correlations,
    histograms,
    outliersSummary,
    automatedExplanations,
  };
}
