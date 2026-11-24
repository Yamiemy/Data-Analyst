import { computePearsonCorrelation } from './dataAnalyzer';
import { isNullish, parseDateValue, parseNumericValue } from './parser';
import type {
  AnomalyAlgorithmComparisonEntry,
  AnomalyAlgorithmId,
  AnomalyComparisonSummary,
  AnomalyDetectionConfig,
  AnomalyDetectionResult,
  AnomalyDisagreementRecord,
  AnomalyFeatureComparison,
  AnomalyRecord,
  AnomalySeverity,
  ComparisonAlgorithmId,
  Dataset,
  DatasetRow,
  TimeSeriesAnomalyPattern,
} from '../types/data';

export interface AlgorithmMeta {
  id: AnomalyAlgorithmId;
  label: string;
  category: 'Auto' | 'Statistical' | 'Machine Learning' | 'Time-Series' | 'Multivariate';
  shortDesc: string;
}

export const ANOMALY_ALGORITHMS: AlgorithmMeta[] = [
  { id: 'auto', label: 'Auto Detect (Recommended)', category: 'Auto', shortDesc: 'Inspects distributions, dimensionality & timestamps to pick the optimal detector.' },
  { id: 'z_score', label: 'Z-Score (Standard Deviation)', category: 'Statistical', shortDesc: 'Flags values far from the arithmetic mean in standard deviation units.' },
  { id: 'modified_z_score', label: 'Modified Z-Score (MAD)', category: 'Statistical', shortDesc: 'Median & MAD-based detector resistant to extreme outliers masking the mean.' },
  { id: 'iqr', label: 'Interquartile Range (IQR)', category: 'Statistical', shortDesc: 'Non-parametric Tukey fences [Q1 - k·IQR, Q3 + k·IQR] for skewed distributions.' },
  { id: 'isolation_forest', label: 'Isolation Forest', category: 'Machine Learning', shortDesc: 'Tree ensemble isolating anomalous records in fewer random feature splits.' },
  { id: 'lof', label: 'Local Outlier Factor (LOF)', category: 'Machine Learning', shortDesc: 'Compares local neighborhood density against k-nearest neighbors.' },
  { id: 'dbscan', label: 'DBSCAN Density Noise', category: 'Machine Learning', shortDesc: 'Finds isolated noise points outside dense epsilon-neighborhood clusters.' },
  { id: 'moving_average', label: 'Moving Average Residual', category: 'Time-Series', shortDesc: 'Detects sharp spikes relative to a trailing/centered rolling mean window.' },
  { id: 'rolling_std', label: 'Rolling Std Volatility', category: 'Time-Series', shortDesc: 'Flags points exceeding local rolling volatility bands.' },
  { id: 'seasonal_trend', label: 'Seasonal & Trend Decomposition', category: 'Time-Series', shortDesc: 'Extracts linear trend & periodic cycle to isolate unexpected residual spikes.' },
  { id: 'mahalanobis', label: 'Multivariate Mahalanobis', category: 'Multivariate', shortDesc: 'Covariance-aware distance detecting unusual feature combinations.' },
];

const MAX_QUADRATIC_ROWS = 1200;

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[maxRow][col])) maxRow = r;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) return null;

    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r !== col) {
        const factor = aug[r][col];
        for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
      }
    }
  }
  return aug.map((row) => row.slice(n));
}

// Wilson-Hilferty approximation of Chi-Square inverse CDF quantile
function approxChiSquareThreshold(df: number, sensitivity: 'conservative' | 'balanced' | 'sensitive'): number {
  const z = sensitivity === 'conservative' ? 2.576 : sensitivity === 'balanced' ? 2.054 : 1.645; // 99.5%, 98%, 95%
  const term = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df));
  return Math.max(df + 1.5, df * Math.pow(term, 3));
}

function detectRecordId(row: DatasetRow, rowIndex: number, columns: string[]): string {
  const idCol = columns.find((c) => /^(order_?id|customer_?id|transaction_?id|record_?id|id)$/i.test(c.trim()));
  if (idCol && !isNullish(row[idCol])) {
    return `${String(row[idCol]).trim()} (Row #${rowIndex})`;
  }
  return `Row #${rowIndex}`;
}

export function recommendAnomalyAlgorithm(
  dataset: Dataset,
  selectedColumns: string[],
  dateColumn?: string
): { resolved: Exclude<AnomalyAlgorithmId, 'auto'>; reason: string } {
  const validDateCol =
    dateColumn && dataset.columns.includes(dateColumn)
      ? dateColumn
      : dataset.profile.columns.find((c) => c.type === 'date')?.name;

  if (validDateCol && selectedColumns.length === 1) {
    if (dataset.rows.length >= 12) {
      return {
        resolved: 'seasonal_trend',
        reason: `Auto Detect selected Seasonal & Trend Decomposition because "${validDateCol}" provides chronological timestamps for "${selectedColumns[0]}" (${dataset.rows.length} periods).`,
      };
    }
    return {
      resolved: 'moving_average',
      reason: `Auto Detect selected Moving Average Residual because "${validDateCol}" provides a compact time series (${dataset.rows.length} rows).`,
    };
  }

  if (selectedColumns.length >= 2) {
    // Check average correlation magnitude among selected columns to pick between Mahalanobis and Isolation Forest
    let corrSum = 0;
    let corrPairs = 0;
    for (let i = 0; i < Math.min(selectedColumns.length, 4); i++) {
      for (let j = i + 1; j < Math.min(selectedColumns.length, 4); j++) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const r of dataset.rows.slice(0, 500)) {
          const xv = parseNumericValue(r[selectedColumns[i]]);
          const yv = parseNumericValue(r[selectedColumns[j]]);
          if (xv !== null && yv !== null) {
            xs.push(xv);
            ys.push(yv);
          }
        }
        const corr = computePearsonCorrelation(xs, ys);
        if (corr !== null) {
          corrSum += Math.abs(corr);
          corrPairs++;
        }
      }
    }
    const avgCorr = corrPairs > 0 ? corrSum / corrPairs : 0;
    if (avgCorr >= 0.35 && selectedColumns.length <= 10) {
      return {
        resolved: 'mahalanobis',
        reason: `Auto Detect selected Multivariate Mahalanobis Distance because ${selectedColumns.length} numeric features exhibit correlated structure (mean |r| = ${avgCorr.toFixed(2)}), enabling joint-combination outlier detection.`,
      };
    }
    return {
      resolved: 'isolation_forest',
      reason: `Auto Detect selected Isolation Forest because ${selectedColumns.length} numeric features are evaluated simultaneously without strict Gaussian distribution assumptions.`,
    };
  }

  // Single feature
  const colProf = dataset.profile.columns.find((c) => c.name === selectedColumns[0]);
  const mean = colProf?.mean ?? 0;
  const med = colProf?.median ?? 0;
  const std = colProf?.stdDev || 1;
  const skewRatio = Math.abs(mean - med) / std;

  if (skewRatio > 0.22) {
    return {
      resolved: 'modified_z_score',
      reason: `Auto Detect selected Modified Z-Score (MAD) because "${selectedColumns[0]}" is skewed (mean ${mean} vs median ${med}), preventing extreme outliers from distorting the threshold.`,
    };
  }
  return {
    resolved: 'iqr',
    reason: `Auto Detect selected Interquartile Range (IQR) for robust univariate fence detection on "${selectedColumns[0]}".`,
  };
}

interface CleanMatrixData {
  originalIndices: number[]; // 0-based index in dataset.rows
  matrix: number[][]; // [sampleIdx][featureIdx], missing values imputed to column median for multivariate ops
  colMedians: number[];
  colMeans: number[];
  colStds: number[];
  colMads: number[];
  colQ1: number[];
  colQ3: number[];
  colIqr: number[];
  rawHasMissing: boolean[];
}

function buildNumericMatrix(rows: DatasetRow[], featureCols: string[]): CleanMatrixData {
  const numCols = featureCols.length;
  const perColValues: number[][] = Array.from({ length: numCols }, () => []);

  const rawGrid: Array<Array<number | null>> = rows.map((row) =>
    featureCols.map((col, j) => {
      const n = parseNumericValue(row[col]);
      if (n !== null) perColValues[j].push(n);
      return n;
    })
  );

  const colMedians = new Array<number>(numCols).fill(0);
  const colMeans = new Array<number>(numCols).fill(0);
  const colStds = new Array<number>(numCols).fill(1);
  const colMads = new Array<number>(numCols).fill(1);
  const colQ1 = new Array<number>(numCols).fill(0);
  const colQ3 = new Array<number>(numCols).fill(0);
  const colIqr = new Array<number>(numCols).fill(0);

  for (let j = 0; j < numCols; j++) {
    const vals = perColValues[j];
    if (vals.length === 0) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    const med = median(sorted);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.length > 1 ? vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length : 1;
    const std = Math.sqrt(variance) || 1;
    const absDevs = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
    let mad = median(absDevs);
    if (mad === 0) {
      // Mean absolute deviation fallback when >50% rows share median
      mad = absDevs.reduce((a, b) => a + b, 0) / Math.max(1, absDevs.length) || std * 0.6745;
    }
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);

    colMedians[j] = med;
    colMeans[j] = mean;
    colStds[j] = std;
    colMads[j] = mad;
    colQ1[j] = q1;
    colQ3[j] = q3;
    colIqr[j] = q3 - q1;
  }

  const originalIndices: number[] = [];
  const matrix: number[][] = [];
  const rawHasMissing: boolean[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowVals = rawGrid[i];
    const validCount = rowVals.filter((v) => v !== null).length;
    if (validCount === 0) continue; // completely non-numeric row across selected cols
    originalIndices.push(i);
    rawHasMissing.push(validCount < numCols);
    matrix.push(rowVals.map((v, j) => (v !== null ? v : colMedians[j])));
  }

  return { originalIndices, matrix, colMedians, colMeans, colStds, colMads, colQ1, colQ3, colIqr, rawHasMissing };
}

function zVector(row: number[], means: number[], stds: number[]): number[] {
  return row.map((v, j) => (v - means[j]) / (stds[j] || 1));
}

function classifySeverity(score: number): AnomalySeverity {
  if (score >= 72) return 'high';
  if (score >= 42) return 'medium';
  return 'low';
}

function buildFeatureDeviations(
  rowVec: number[],
  featureCols: string[],
  colMedians: number[],
  colMads: number[],
  colMeans: number[],
  colStds: number[]
): Array<{ col: string; z: number; val: number; med: number }> {
  return featureCols
    .map((col, j) => {
      const robustZ = (0.6745 * (rowVec[j] - colMedians[j])) / (colMads[j] || 1);
      const stdZ = (rowVec[j] - colMeans[j]) / (colStds[j] || 1);
      const z = Math.abs(robustZ) > Math.abs(stdZ) ? robustZ : stdZ;
      return { col, z, val: rowVec[j], med: colMedians[j] };
    })
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

// Isolation Forest helpers
interface IsoNode {
  splitFeature?: number;
  splitValue?: number;
  left?: IsoNode;
  right?: IsoNode;
  size: number;
}

function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const H = Math.log(n - 1) + 0.5772156649;
  return 2 * H - (2 * (n - 1)) / n;
}

function buildIsoTree(
  data: number[][],
  height: number,
  maxHeight: number,
  rand: () => number
): IsoNode {
  if (height >= maxHeight || data.length <= 1) {
    return { size: data.length };
  }
  const dims = data[0].length;
  // Pick a random feature that has range > 0
  const candidates: number[] = [];
  for (let d = 0; d < dims; d++) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const r of data) {
      if (r[d] < mn) mn = r[d];
      if (r[d] > mx) mx = r[d];
    }
    if (mx > mn) candidates.push(d);
  }
  if (candidates.length === 0) return { size: data.length };

  const f = candidates[Math.floor(rand() * candidates.length)];
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const r of data) {
    if (r[f] < minVal) minVal = r[f];
    if (r[f] > maxVal) maxVal = r[f];
  }
  const split = minVal + rand() * (maxVal - minVal);
  const left: number[][] = [];
  const right: number[][] = [];
  for (const r of data) {
    if (r[f] < split) left.push(r);
    else right.push(r);
  }
  return {
    splitFeature: f,
    splitValue: split,
    left: buildIsoTree(left, height + 1, maxHeight, rand),
    right: buildIsoTree(right, height + 1, maxHeight, rand),
    size: data.length,
  };
}

function isoPathLength(x: number[], node: IsoNode, currentHeight = 0): number {
  if (node.splitFeature === undefined || !node.left || !node.right) {
    return currentHeight + cFactor(node.size);
  }
  if (x[node.splitFeature] < (node.splitValue ?? 0)) {
    return isoPathLength(x, node.left, currentHeight + 1);
  }
  return isoPathLength(x, node.right, currentHeight + 1);
}

function euclidSq(a: number[], b: number[]): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    s += d * d;
  }
  return s;
}

export function runAnomalyDetection(dataset: Dataset, config: AnomalyDetectionConfig): AnomalyDetectionResult {
  const t0 = performance.now();
  const numericCols = dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name);
  if (numericCols.length === 0) {
    throw new Error('This dataset has no numeric columns to evaluate for anomalies.');
  }

  const selectedColumns =
    config.selectedColumns && config.selectedColumns.length > 0
      ? config.selectedColumns.filter((c) => numericCols.includes(c))
      : numericCols.slice(0, 6);

  if (selectedColumns.length === 0) {
    throw new Error('Select at least one valid numeric column.');
  }

  const dateColumnUsed =
    config.dateColumn && dataset.columns.includes(config.dateColumn)
      ? config.dateColumn
      : dataset.profile.columns.find((c) => c.type === 'date')?.name;

  let resolvedAlgorithm: Exclude<AnomalyAlgorithmId, 'auto'>;
  let autoDetectReason: string;
  if (config.algorithm === 'auto') {
    const rec = recommendAnomalyAlgorithm(dataset, selectedColumns, dateColumnUsed);
    resolvedAlgorithm = rec.resolved;
    autoDetectReason = rec.reason;
  } else {
    resolvedAlgorithm = config.algorithm;
    const meta = ANOMALY_ALGORITHMS.find((a) => a.id === resolvedAlgorithm);
    autoDetectReason = `Manual mode: running ${meta?.label || resolvedAlgorithm} on ${selectedColumns.length} selected feature(s).`;
  }

  // Fallback safeguards when user explicitly picks multivariate/time-series without matching data
  const limitations: string[] = [];
  const falsePositiveWarnings: string[] = [];

  if (resolvedAlgorithm === 'mahalanobis' && selectedColumns.length < 2) {
    limitations.push('Mahalanobis Distance requires at least 2 numeric columns; switched automatically to Modified Z-Score for single-column evaluation.');
    resolvedAlgorithm = 'modified_z_score';
  }

  const matrixData = buildNumericMatrix(dataset.rows, selectedColumns);
  const { originalIndices, matrix, colMedians, colMeans, colStds, colMads, colQ1, colQ3, colIqr } = matrixData;

  if (matrix.length < 5) {
    throw new Error(`Insufficient complete numeric records (${matrix.length}). At least 5 numeric rows are required for statistical anomaly detection.`);
  }

  const N = matrix.length;
  const D = selectedColumns.length;
  const sens = config.sensitivity || 'balanced';

  // Deterministic sampling for O(N^2) algorithms
  let evalSampleIndices = originalIndices.map((_, i) => i);
  let isSampled = false;
  if ((resolvedAlgorithm === 'lof' || resolvedAlgorithm === 'dbscan') && N > MAX_QUADRATIC_ROWS) {
    isSampled = true;
    const stride = N / MAX_QUADRATIC_ROWS;
    evalSampleIndices = Array.from({ length: MAX_QUADRATIC_ROWS }, (_, k) => Math.floor(k * stride));
    limitations.push(
      `Dataset has ${N.toLocaleString()} numeric rows; ${resolvedAlgorithm.toUpperCase()} was computed over a deterministic ${MAX_QUADRATIC_ROWS.toLocaleString()}-row representative sample for interactive responsiveness.`
    );
  }

  // Per-matrix-row outputs
  const rowFlagged = new Array<boolean>(N).fill(false);
  const rowScore = new Array<number>(N).fill(0); // normalized 0–100 (NOT probability)
  const rowRawStat = new Array<string>(N).fill('');
  const rowExplanation = new Array<string>(N).fill('');
  const rowAffected = Array.from({ length: N }, () => [] as string[]);
  const rowTsPattern = new Array<TimeSeriesAnomalyPattern | undefined>(N).fill(undefined);
  const tsExpectedByMatIdx = new Array<number | undefined>(N).fill(undefined);
  const tsBandHalfByMatIdx = new Array<number | undefined>(N).fill(undefined);

  const colAnomalyCounts = new Array<number>(D).fill(0);
  const colSigmaSums = new Array<number>(D).fill(0);

  let windowSizeUsed: number | undefined;
  let kNeighborsUsed: number | undefined;
  let tsCutoffUsed = sens === 'conservative' ? 3.2 : sens === 'balanced' ? 2.5 : 1.95;

  if (resolvedAlgorithm === 'z_score') {
    const cutoff = sens === 'conservative' ? 3.2 : sens === 'balanced' ? 2.6 : 2.0;
    for (let i = 0; i < N; i++) {
      let maxAbsZ = 0;
      const hitCols: string[] = [];
      for (let j = 0; j < D; j++) {
        const z = Math.abs((matrix[i][j] - colMeans[j]) / (colStds[j] || 1));
        if (z > maxAbsZ) maxAbsZ = z;
        if (z >= cutoff) {
          hitCols.push(selectedColumns[j]);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += z;
        }
      }
      rowScore[i] = Math.min(100, Number(((maxAbsZ / (cutoff * 1.6)) * 100).toFixed(1)));
      rowRawStat[i] = `|z| = ${maxAbsZ.toFixed(2)} (threshold ≥ ${cutoff})`;
      if (maxAbsZ >= cutoff) {
        rowFlagged[i] = true;
        rowAffected[i] = hitCols;
        const devs = buildFeatureDeviations(matrix[i], selectedColumns, colMedians, colMads, colMeans, colStds);
        const top = devs[0];
        rowExplanation[i] = `"${top.col}" = ${top.val.toLocaleString()} deviates by ${Math.abs(top.z).toFixed(2)} standard deviations from column mean (${colMeans[selectedColumns.indexOf(top.col)].toFixed(2)}).`;
      }
    }
    limitations.push('Z-Score assumes approximate symmetry; extreme outliers inflate the arithmetic mean and standard deviation.');
    if (N < 30) falsePositiveWarnings.push('Small sample sizes (< 30 rows) can widen z-score sensitivity.');
  } else if (resolvedAlgorithm === 'modified_z_score') {
    const cutoff = sens === 'conservative' ? 3.5 : sens === 'balanced' ? 2.8 : 2.2;
    for (let i = 0; i < N; i++) {
      let maxModZ = 0;
      const hitCols: string[] = [];
      for (let j = 0; j < D; j++) {
        const mz = Math.abs((0.6745 * (matrix[i][j] - colMedians[j])) / (colMads[j] || 1));
        if (mz > maxModZ) maxModZ = mz;
        if (mz >= cutoff) {
          hitCols.push(selectedColumns[j]);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += mz;
        }
      }
      rowScore[i] = Math.min(100, Number(((maxModZ / (cutoff * 1.6)) * 100).toFixed(1)));
      rowRawStat[i] = `Mod-Z = ${maxModZ.toFixed(2)} (threshold ≥ ${cutoff})`;
      if (maxModZ >= cutoff) {
        rowFlagged[i] = true;
        rowAffected[i] = hitCols;
        const devs = buildFeatureDeviations(matrix[i], selectedColumns, colMedians, colMads, colMeans, colStds);
        const top = devs[0];
        rowExplanation[i] = `"${top.col}" = ${top.val.toLocaleString()} lies ${Math.abs(top.z).toFixed(2)} MAD units from median (${top.med.toLocaleString()}).`;
      }
    }
    limitations.push('Modified Z-Score evaluates columns independently and may miss joint multivariate combinations.');
  } else if (resolvedAlgorithm === 'iqr') {
    const k = sens === 'conservative' ? 2.0 : sens === 'balanced' ? 1.5 : 1.15;
    for (let i = 0; i < N; i++) {
      let maxFenceRatio = 0;
      const hitCols: string[] = [];
      for (let j = 0; j < D; j++) {
        const iqr = colIqr[j];
        if (iqr <= 0) continue;
        const low = colQ1[j] - k * iqr;
        const high = colQ3[j] + k * iqr;
        const val = matrix[i][j];
        let distRatio = 0;
        if (val < low) distRatio = (low - val) / iqr;
        else if (val > high) distRatio = (val - high) / iqr;

        if (distRatio > maxFenceRatio) maxFenceRatio = distRatio;
        if (val < low || val > high) {
          hitCols.push(selectedColumns[j]);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += Math.abs((val - colMeans[j]) / (colStds[j] || 1));
        }
      }
      rowScore[i] = maxFenceRatio > 0 ? Math.min(100, Number((45 + maxFenceRatio * 22).toFixed(1))) : 8;
      rowRawStat[i] = maxFenceRatio > 0 ? `${(k + maxFenceRatio).toFixed(2)}× IQR beyond Q1/Q3` : `Inside ${k}× IQR fence`;
      if (hitCols.length > 0) {
        rowFlagged[i] = true;
        rowAffected[i] = hitCols;
        const topCol = hitCols[0];
        const j = selectedColumns.indexOf(topCol);
        const low = (colQ1[j] - k * colIqr[j]).toFixed(2);
        const high = (colQ3[j] + k * colIqr[j]).toFixed(2);
        rowExplanation[i] = `"${topCol}" = ${matrix[i][j].toLocaleString()} falls outside the ${k}× IQR Tukey fence [${low}, ${high}].`;
      }
    }
    limitations.push('IQR fences can flag long-tailed business metrics (e.g. enterprise revenue orders) even when valid.');
  } else if (resolvedAlgorithm === 'isolation_forest') {
    const zData = matrix.map((r) => zVector(r, colMeans, colStds));
    const numTrees = 40;
    const subSize = Math.min(128, N);
    const maxHeight = Math.ceil(Math.log2(subSize));
    let seed = 202505;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const forest: IsoNode[] = [];
    for (let t = 0; t < numTrees; t++) {
      const sub: number[][] = [];
      for (let s = 0; s < subSize; s++) {
        sub.push(zData[Math.floor(rand() * N)]);
      }
      forest.push(buildIsoTree(sub, 0, maxHeight, rand));
    }

    const cn = cFactor(subSize) || 1;
    const rawScores = zData.map((x) => {
      let avgH = 0;
      for (const tree of forest) avgH += isoPathLength(x, tree);
      avgH /= numTrees;
      return Math.pow(2, -avgH / cn);
    });

    const sortedIso = [...rawScores].sort((a, b) => a - b);
    const pctThreshold = sens === 'conservative' ? quantile(sortedIso, 0.96) : sens === 'balanced' ? quantile(sortedIso, 0.92) : quantile(sortedIso, 0.86);
    const absoluteFloor = sens === 'conservative' ? 0.61 : sens === 'balanced' ? 0.57 : 0.53;
    const cutoff = Math.max(absoluteFloor, pctThreshold);

    const minIso = sortedIso[0];
    const maxIso = sortedIso[sortedIso.length - 1];
    const span = Math.max(0.05, maxIso - minIso);

    for (let i = 0; i < N; i++) {
      const s = rawScores[i];
      rowScore[i] = Math.min(100, Math.max(0, Number((((s - minIso) / span) * 100).toFixed(1))));
      rowRawStat[i] = `IsoScore = ${s.toFixed(3)} (cutoff ≥ ${cutoff.toFixed(3)})`;
      if (s >= cutoff) {
        rowFlagged[i] = true;
        const devs = buildFeatureDeviations(matrix[i], selectedColumns, colMedians, colMads, colMeans, colStds);
        const topCols = devs.filter((d, idx) => idx === 0 || Math.abs(d.z) >= 1.8).slice(0, 3);
        rowAffected[i] = topCols.map((d) => d.col);
        for (const d of topCols) {
          const j = selectedColumns.indexOf(d.col);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += Math.abs(d.z);
        }
        rowExplanation[i] = `Isolated rapidly in ${numTrees} random partition trees (score ${s.toFixed(3)}); primary deviation in "${topCols[0].col}" = ${topCols[0].val.toLocaleString()} (${Math.abs(topCols[0].z).toFixed(1)}σ from median).`;
      }
    }
    limitations.push('Isolation Forest path scores depend on subsample size and random feature splits; borderline scores near the cutoff may shift slightly under different random seeds.');
  } else if (resolvedAlgorithm === 'lof') {
    const subZ = evalSampleIndices.map((idx) => zVector(matrix[idx], colMeans, colStds));
    const M = subZ.length;
    const k = Math.max(3, Math.min(config.kNeighbors || 10, M - 2));
    kNeighborsUsed = k;

    // Precompute k-nearest neighbors within sample
    const kDist = new Array<number>(M).fill(0);
    const knnIdx: number[][] = Array.from({ length: M }, () => []);
    const knnDist: number[][] = Array.from({ length: M }, () => []);

    for (let i = 0; i < M; i++) {
      const dists: Array<{ j: number; d: number }> = [];
      for (let j = 0; j < M; j++) {
        if (i === j) continue;
        dists.push({ j, d: Math.sqrt(euclidSq(subZ[i], subZ[j])) });
      }
      dists.sort((a, b) => a.d - b.d);
      const topK = dists.slice(0, k);
      kDist[i] = topK[topK.length - 1]?.d ?? 0;
      knnIdx[i] = topK.map((x) => x.j);
      knnDist[i] = topK.map((x) => x.d);
    }

    const lrd = new Array<number>(M).fill(1);
    for (let i = 0; i < M; i++) {
      let reachSum = 0;
      for (let t = 0; t < knnIdx[i].length; t++) {
        const nb = knnIdx[i][t];
        reachSum += Math.max(kDist[nb], knnDist[i][t]);
      }
      lrd[i] = reachSum > 1e-8 ? k / reachSum : 1e6;
    }

    const lofVals = new Array<number>(M).fill(1);
    for (let i = 0; i < M; i++) {
      let ratioSum = 0;
      for (const nb of knnIdx[i]) {
        ratioSum += lrd[nb] / (lrd[i] || 1e-6);
      }
      lofVals[i] = Math.min(20, ratioSum / Math.max(1, knnIdx[i].length));
    }

    const cutoff = sens === 'conservative' ? 1.65 : sens === 'balanced' ? 1.38 : 1.2;
    for (let sIdx = 0; sIdx < M; sIdx++) {
      const origMatIdx = evalSampleIndices[sIdx];
      const lof = lofVals[sIdx];
      rowScore[origMatIdx] = Math.min(100, Math.max(0, Number((((lof - 0.9) / 1.5) * 100).toFixed(1))));
      rowRawStat[origMatIdx] = `LOF(k=${k}) = ${lof.toFixed(2)} (threshold ≥ ${cutoff})`;
      if (lof >= cutoff) {
        rowFlagged[origMatIdx] = true;
        const devs = buildFeatureDeviations(matrix[origMatIdx], selectedColumns, colMedians, colMads, colMeans, colStds);
        const topCols = devs.filter((d, idx) => idx === 0 || Math.abs(d.z) >= 1.6).slice(0, 3);
        rowAffected[origMatIdx] = topCols.map((d) => d.col);
        for (const d of topCols) {
          const j = selectedColumns.indexOf(d.col);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += Math.abs(d.z);
        }
        rowExplanation[origMatIdx] = `Local density is ${lof.toFixed(2)}× lower than its ${k} nearest neighbors; strongest difference in "${topCols[0].col}" = ${topCols[0].val.toLocaleString()}.`;
      }
    }
    limitations.push(`LOF compares local neighborhood density (k=${k}); duplicate clusters can collapse neighbor distances to 0 and elevate neighboring scores.`);
  } else if (resolvedAlgorithm === 'dbscan') {
    const subZ = evalSampleIndices.map((idx) => zVector(matrix[idx], colMeans, colStds));
    const M = subZ.length;
    const baseScale = sens === 'conservative' ? 2.1 : sens === 'balanced' ? 1.55 : 1.15;
    const eps = config.dbscanEps && config.dbscanEps > 0 ? config.dbscanEps : baseScale * Math.sqrt(Math.max(1, D) / 2);
    const epsSq = eps * eps;
    const minPts = config.dbscanMinPts || Math.max(3, Math.min(7, Math.round(Math.log2(M) + 1)));

    const labels = new Array<number>(M).fill(0); // 0 = unvisited, -1 = noise, >0 = clusterId
    let clusterId = 0;

    const regionQuery = (idx: number): number[] => {
      const res: number[] = [];
      for (let j = 0; j < M; j++) {
        if (euclidSq(subZ[idx], subZ[j]) <= epsSq) res.push(j);
      }
      return res;
    };

    for (let i = 0; i < M; i++) {
      if (labels[i] !== 0) continue;
      const neighbors = regionQuery(i);
      if (neighbors.length < minPts) {
        labels[i] = -1;
      } else {
        clusterId++;
        labels[i] = clusterId;
        const queue = [...neighbors];
        let qPtr = 0;
        while (qPtr < queue.length) {
          const nb = queue[qPtr++];
          if (labels[nb] === -1) labels[nb] = clusterId;
          if (labels[nb] !== 0) continue;
          labels[nb] = clusterId;
          const nbNeighbors = regionQuery(nb);
          if (nbNeighbors.length >= minPts) {
            for (const cand of nbNeighbors) {
              if (!queue.includes(cand)) queue.push(cand);
            }
          }
        }
      }
    }

    for (let sIdx = 0; sIdx < M; sIdx++) {
      const origMatIdx = evalSampleIndices[sIdx];
      // Nearest neighbor distance for scoring
      let nearestDist = Infinity;
      for (let j = 0; j < M; j++) {
        if (j === sIdx || labels[j] === -1) continue;
        const d = Math.sqrt(euclidSq(subZ[sIdx], subZ[j]));
        if (d < nearestDist) nearestDist = d;
      }
      if (!Number.isFinite(nearestDist)) nearestDist = eps * 1.5;

      rowScore[origMatIdx] =
        labels[sIdx] === -1
          ? Math.min(100, Math.max(48, Number(((nearestDist / Math.max(0.5, eps)) * 62).toFixed(1))))
          : Math.min(35, Number(((nearestDist / Math.max(0.5, eps)) * 28).toFixed(1)));
      rowRawStat[origMatIdx] =
        labels[sIdx] === -1
          ? `DBSCAN Noise (eps=${eps.toFixed(2)}, minPts=${minPts}, d=${nearestDist.toFixed(2)})`
          : `Cluster #${labels[sIdx]}`;

      if (labels[sIdx] === -1) {
        rowFlagged[origMatIdx] = true;
        const devs = buildFeatureDeviations(matrix[origMatIdx], selectedColumns, colMedians, colMads, colMeans, colStds);
        const topCols = devs.slice(0, 2);
        rowAffected[origMatIdx] = topCols.map((d) => d.col);
        for (const d of topCols) {
          const j = selectedColumns.indexOf(d.col);
          colAnomalyCounts[j]++;
          colSigmaSums[j] += Math.abs(d.z);
        }
        rowExplanation[origMatIdx] = `Classified as DBSCAN density noise (< ${minPts} neighbors within ε = ${eps.toFixed(2)}); farthest from typical "${topCols[0].col}" values (${topCols[0].val.toLocaleString()}).`;
      }
    }
    limitations.push(`DBSCAN discovered ${clusterId} dense cluster(s) with ε=${eps.toFixed(2)} and minPts=${minPts}; sparse peripheral clusters can appear as noise when features have varying density.`);
  } else if (resolvedAlgorithm === 'moving_average' || resolvedAlgorithm === 'rolling_std' || resolvedAlgorithm === 'seasonal_trend') {
    // Chronological ordering of matrix indices
    const targetColIdx = 0;
    const targetColName = selectedColumns[targetColIdx];
    const order = originalIndices.map((origRowIdx, matIdx) => {
      const d = dateColumnUsed ? parseDateValue(dataset.rows[origRowIdx][dateColumnUsed]) : null;
      return { matIdx, origRowIdx, ts: d ? d.getTime() : origRowIdx };
    });
    order.sort((a, b) => a.ts - b.ts);

    const series = order.map((o) => matrix[o.matIdx][targetColIdx]);
    const W = Math.max(3, Math.min(config.windowSize || Math.round(Math.max(4, series.length * 0.12)), Math.floor(series.length / 2) || 3));
    windowSizeUsed = W;

    const residuals = new Array<number>(series.length).fill(0);
    const signedResiduals = new Array<number>(series.length).fill(0);
    const localScales = new Array<number>(series.length).fill(1);
    const expectedVals = new Array<number>(series.length).fill(0);
    let seasonalAmplitude = 0;

    if (resolvedAlgorithm === 'seasonal_trend') {
      // OLS linear trend + periodic cycle component
      const n = series.length;
      const meanT = (n - 1) / 2;
      const meanY = series.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (let t = 0; t < n; t++) {
        num += (t - meanT) * (series[t] - meanY);
        den += (t - meanT) * (t - meanT);
      }
      const slope = den > 0 ? num / den : 0;
      const intercept = meanY - slope * meanT;
      const detrended = series.map((y, t) => y - (intercept + slope * t));

      const period = n >= 24 ? 12 : Math.max(2, Math.min(7, Math.floor(n / 3)));
      const seasonal = new Array<number>(period).fill(0);
      const seasonalCounts = new Array<number>(period).fill(0);
      for (let t = 0; t < n; t++) {
        seasonal[t % period] += detrended[t];
        seasonalCounts[t % period]++;
      }
      for (let p = 0; p < period; p++) {
        if (seasonalCounts[p] > 0) seasonal[p] /= seasonalCounts[p];
      }
      seasonalAmplitude = n >= 12 ? Math.max(...seasonal) - Math.min(...seasonal) : 0;

      for (let t = 0; t < n; t++) {
        const exp = intercept + slope * t + seasonal[t % period];
        expectedVals[t] = exp;
        signedResiduals[t] = series[t] - exp;
        residuals[t] = Math.abs(signedResiduals[t]);
      }
      const sortedRes = [...residuals].sort((a, b) => a - b);
      const resMed = median(sortedRes);
      const resMad = median(residuals.map((r) => Math.abs(r - resMed)).sort((a, b) => a - b)) || colStds[targetColIdx] * 0.5 || 1;
      for (let t = 0; t < n; t++) localScales[t] = resMad / 0.6745;
      if (!dateColumnUsed) {
        falsePositiveWarnings.push('No date column was selected; Seasonal & Trend decomposition used sequential row order.');
      }
    } else {
      // Moving average / Rolling Std using leave-one-out centered window so a spike does not inflate its own baseline!
      const half = Math.max(1, Math.floor(W / 2));
      for (let t = 0; t < series.length; t++) {
        const winVals: number[] = [];
        for (let k = Math.max(0, t - half); k <= Math.min(series.length - 1, t + half); k++) {
          if (k !== t) winVals.push(series[k]);
        }
        if (winVals.length === 0) winVals.push(series[t]);
        const winSorted = [...winVals].sort((a, b) => a - b);
        const baseline = resolvedAlgorithm === 'moving_average' ? median(winSorted) : winVals.reduce((a, b) => a + b, 0) / winVals.length;
        const winMean = winVals.reduce((a, b) => a + b, 0) / winVals.length;
        const winStd = Math.sqrt(winVals.reduce((s, v) => s + Math.pow(v - winMean, 2), 0) / Math.max(1, winVals.length));
        expectedVals[t] = baseline;
        signedResiduals[t] = series[t] - baseline;
        residuals[t] = Math.abs(signedResiduals[t]);
        localScales[t] = resolvedAlgorithm === 'rolling_std' ? Math.max(winStd, colStds[targetColIdx] * 0.2, 1e-6) : 1;
      }
      if (resolvedAlgorithm === 'moving_average') {
        const sortedRes = [...residuals].sort((a, b) => a - b);
        const globalResMad = (median(sortedRes) / 0.6745) || colStds[targetColIdx] * 0.35 || 1;
        for (let t = 0; t < series.length; t++) localScales[t] = globalResMad;
      }
    }

    const cutoff = sens === 'conservative' ? 3.2 : sens === 'balanced' ? 2.5 : 1.95;
    tsCutoffUsed = cutoff;

    // Classify time-series anomaly pattern using local neighborhood, sign alternation, and sustained shifts
    const classifyTsPattern = (t: number, zRes: number): TimeSeriesAnomalyPattern => {
      const signed = signedResiduals[t];
      // Check sustained trend deviation: 3+ consecutive residuals with same sign around t
      const prevSameSign =
        (t > 0 && Math.sign(signedResiduals[t - 1]) === Math.sign(signed) && residuals[t - 1] / (localScales[t - 1] || 1) >= cutoff * 0.65) ||
        (t < series.length - 1 && Math.sign(signedResiduals[t + 1]) === Math.sign(signed) && residuals[t + 1] / (localScales[t + 1] || 1) >= cutoff * 0.65);
      // Check unexpected rapid fluctuation (rolling volatility / oscillating signs across adjacent steps)
      const signFlips =
        (t > 0 && Math.sign(signedResiduals[t - 1]) !== 0 && Math.sign(signedResiduals[t - 1]) !== Math.sign(signed) && residuals[t - 1] / (localScales[t - 1] || 1) >= 1.2) ||
        (t < series.length - 1 && Math.sign(signedResiduals[t + 1]) !== 0 && Math.sign(signedResiduals[t + 1]) !== Math.sign(signed) && residuals[t + 1] / (localScales[t + 1] || 1) >= 1.2);

      if (resolvedAlgorithm === 'seasonal_trend' && series.length >= 12 && seasonalAmplitude > colStds[targetColIdx] * 0.25 && zRes < cutoff * 1.45) {
        return 'seasonal_deviation';
      }
      if (resolvedAlgorithm === 'rolling_std' && signFlips) {
        return 'unexpected_fluctuation';
      }
      if (prevSameSign) {
        return 'trend_deviation';
      }
      if (signFlips && zRes < cutoff * 1.35) {
        return 'unexpected_fluctuation';
      }
      return signed >= 0 ? 'sudden_spike' : 'sudden_drop';
    };

    const PATTERN_READABLE: Record<TimeSeriesAnomalyPattern, string> = {
      sudden_spike: 'Sudden Spike',
      sudden_drop: 'Sudden Drop',
      unexpected_fluctuation: 'Unexpected Fluctuation',
      trend_deviation: 'Trend Deviation',
      seasonal_deviation: 'Seasonal Deviation',
    };

    for (let t = 0; t < order.length; t++) {
      const matIdx = order[t].matIdx;
      tsExpectedByMatIdx[matIdx] = expectedVals[t];
      tsBandHalfByMatIdx[matIdx] = cutoff * (localScales[t] || 1);
      const zRes = residuals[t] / (localScales[t] || 1);
      rowScore[matIdx] = Math.min(100, Number(((zRes / (cutoff * 1.55)) * 100).toFixed(1)));
      rowRawStat[matIdx] = `Residual = ${signedResiduals[t] >= 0 ? '+' : ''}${signedResiduals[t].toFixed(2)} (${zRes.toFixed(2)}σ vs expected ${expectedVals[t].toFixed(1)})`;
      if (zRes >= cutoff) {
        const pattern = classifyTsPattern(t, zRes);
        rowTsPattern[matIdx] = pattern;
        rowFlagged[matIdx] = true;
        rowAffected[matIdx] = [targetColName];
        colAnomalyCounts[targetColIdx]++;
        colSigmaSums[targetColIdx] += zRes;
        rowExplanation[matIdx] = `${PATTERN_READABLE[pattern]}: "${targetColName}" = ${series[t].toLocaleString()} deviated ${zRes.toFixed(2)}σ from expected baseline (${expectedVals[t].toFixed(2)}).`;
      }
    }
    if (selectedColumns.length > 1) {
      limitations.push(`Time-series detector evaluated primary column "${targetColName}"; select a different primary column or multivariate detector to check other metrics.`);
    }
  } else if (resolvedAlgorithm === 'mahalanobis') {
    const kCols = Math.min(selectedColumns.length, 10);
    const zData = matrix.map((r) => zVector(r.slice(0, kCols), colMeans.slice(0, kCols), colStds.slice(0, kCols)));

    // Build covariance matrix + small Ridge regularization (1e-4)
    const cov = Array.from({ length: kCols }, () => Array(kCols).fill(0));
    for (const row of zData) {
      for (let a = 0; a < kCols; a++) {
        for (let b = 0; b < kCols; b++) {
          cov[a][b] += row[a] * row[b];
        }
      }
    }
    for (let a = 0; a < kCols; a++) {
      for (let b = 0; b < kCols; b++) {
        cov[a][b] = cov[a][b] / Math.max(1, N - 1) + (a === b ? 1e-3 : 0);
      }
    }

    const invCov = invertMatrix(cov);
    const cutoffD2 = approxChiSquareThreshold(kCols, sens);

    for (let i = 0; i < N; i++) {
      const z = zData[i];
      let d2 = 0;
      if (invCov) {
        for (let a = 0; a < kCols; a++) {
          let sum = 0;
          for (let b = 0; b < kCols; b++) sum += invCov[a][b] * z[b];
          d2 += z[a] * sum;
        }
      } else {
        d2 = z.reduce((s, v) => s + v * v, 0);
      }

      rowScore[i] = Math.min(100, Math.max(0, Number(((d2 / (cutoffD2 * 1.6)) * 100).toFixed(1))));
      rowRawStat[i] = `D² = ${d2.toFixed(2)} (χ² cutoff ${cutoffD2.toFixed(1)}, df=${kCols})`;

      if (d2 >= cutoffD2) {
        rowFlagged[i] = true;
        // Identify top contributing features via marginal z-scores AND pairwise residual check
        const devs = buildFeatureDeviations(matrix[i], selectedColumns, colMedians, colMads, colMeans, colStds);
        const topCols = devs.filter((d, idx) => idx < 2 || Math.abs(d.z) >= 1.5).slice(0, 3);
        rowAffected[i] = topCols.map((d) => d.col);
        for (const d of topCols) {
          const j = selectedColumns.indexOf(d.col);
          if (j >= 0) {
            colAnomalyCounts[j]++;
            colSigmaSums[j] += Math.abs(d.z);
          }
        }
        const maxMargZ = Math.max(...devs.map((d) => Math.abs(d.z)));
        const jointNote =
          maxMargZ < 2.2
            ? 'Note: individual column values appear normal in isolation, making this a true multivariate combination anomaly.'
            : `Led by "${topCols[0].col}" = ${topCols[0].val.toLocaleString()}.`;
        rowExplanation[i] = `Mahalanobis D² = ${d2.toFixed(2)} breaks the joint covariance pattern across ${kCols} features. ${jointNote}`;
      }
    }
    limitations.push('Mahalanobis Distance assumes roughly elliptical joint covariance; constant/zero-variance columns are regularized automatically.');
  }

  const formatNumCompact = (v: number): string => {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
    if (Math.abs(v) >= 10) return Number(v.toFixed(1)).toLocaleString();
    return Number(v.toFixed(2)).toLocaleString();
  };

  // Build per-feature actual vs expected reference range for every flagged row
  const buildFeatureComparisonsForRow = (matIdx: number, affected: string[]): AnomalyFeatureComparison[] => {
    const focusCols = affected.length > 0 ? affected : [selectedColumns[0]];
    const extras = selectedColumns.filter((c) => !focusCols.includes(c)).slice(0, Math.max(0, 3 - focusCols.length));
    const inspectCols = [...focusCols, ...extras].slice(0, 4);

    return inspectCols.map((col) => {
      const j = selectedColumns.indexOf(col);
      const actualVal = parseNumericValue(dataset.rows[originalIndices[matIdx]][col]);
      const actNum = actualVal ?? matrix[matIdx][j];
      const isPrimaryTs =
        (resolvedAlgorithm === 'moving_average' || resolvedAlgorithm === 'rolling_std' || resolvedAlgorithm === 'seasonal_trend') &&
        j === 0 &&
        tsExpectedByMatIdx[matIdx] !== undefined &&
        tsBandHalfByMatIdx[matIdx] !== undefined;

      let expectedRange = '';
      if (isPrimaryTs) {
        const exp = tsExpectedByMatIdx[matIdx] as number;
        const half = tsBandHalfByMatIdx[matIdx] as number;
        expectedRange = `${formatNumCompact(exp - half)} to ${formatNumCompact(exp + half)} (baseline ${formatNumCompact(exp)})`;
      } else if (resolvedAlgorithm === 'iqr') {
        const k = sens === 'conservative' ? 2.0 : sens === 'balanced' ? 1.5 : 1.15;
        const low = colQ1[j] - k * colIqr[j];
        const high = colQ3[j] + k * colIqr[j];
        expectedRange = `${formatNumCompact(low)} to ${formatNumCompact(high)} (${k}×IQR)`;
      } else if (resolvedAlgorithm === 'z_score') {
        const cutoff = sens === 'conservative' ? 3.2 : sens === 'balanced' ? 2.6 : 2.0;
        const low = colMeans[j] - cutoff * colStds[j];
        const high = colMeans[j] + cutoff * colStds[j];
        expectedRange = `${formatNumCompact(low)} to ${formatNumCompact(high)} (mean ± ${cutoff}σ)`;
      } else {
        const low = colQ1[j];
        const high = colQ3[j];
        expectedRange = `IQR ${formatNumCompact(low)}–${formatNumCompact(high)} (med ${formatNumCompact(colMedians[j])})`;
      }

      const z = (actNum - colMeans[j]) / (colStds[j] || 1);
      const devSummary = `${z >= 0 ? '+' : ''}${z.toFixed(2)}σ vs mean (${formatNumCompact(colMeans[j])})`;
      return {
        feature: col,
        actualValue: actualVal,
        expectedRange,
        deviationSummary: devSummary,
      };
    });
  };

  // Build final aligned arrays across full dataset.rows length
  const allRowScores = new Array<number>(dataset.rows.length).fill(0);
  const allRowFlags = new Array<boolean>(dataset.rows.length).fill(false);
  const records: AnomalyRecord[] = [];
  const metaLabel = ANOMALY_ALGORITHMS.find((a) => a.id === resolvedAlgorithm)?.label || resolvedAlgorithm;

  for (let i = 0; i < N; i++) {
    const origIdx = originalIndices[i];
    allRowScores[origIdx] = rowScore[i];
    allRowFlags[origIdx] = rowFlagged[i];
    if (rowFlagged[i]) {
      const row = dataset.rows[origIdx];
      const d = dateColumnUsed ? parseDateValue(row[dateColumnUsed]) : null;
      const affected = rowAffected[i].length > 0 ? rowAffected[i] : [selectedColumns[0]];
      const featureComparisons = buildFeatureComparisonsForRow(i, affected);
      const actualValuesSummary = featureComparisons
        .slice(0, 2)
        .map((fc) => `${fc.feature}: ${fc.actualValue !== null ? formatNumCompact(fc.actualValue) : 'null'}`)
        .join(' · ');
      const expectedValuesSummary = featureComparisons
        .slice(0, 2)
        .map((fc) => `${fc.feature}: ${fc.expectedRange}`)
        .join(' · ');

      records.push({
        rowIndex: origIdx + 1,
        recordId: detectRecordId(row, origIdx + 1, dataset.columns),
        values: row,
        score: rowScore[i],
        rawStatistic: rowRawStat[i],
        severity: classifySeverity(rowScore[i]),
        affectedFeatures: affected,
        actualValuesSummary,
        expectedValuesSummary,
        featureComparisons,
        algorithmUsed: metaLabel,
        explanation: rowExplanation[i],
        dateValue: d ? d.toISOString().slice(0, 10) : dateColumnUsed && !isNullish(row[dateColumnUsed]) ? String(row[dateColumnUsed]) : undefined,
        timeSeriesPattern: rowTsPattern[i],
      });
    }
  }

  records.sort((a, b) => b.score - a.score);

  const highCount = records.filter((r) => r.severity === 'high').length;
  const mediumCount = records.filter((r) => r.severity === 'medium').length;
  const lowCount = records.filter((r) => r.severity === 'low').length;
  const totalAnomalies = records.length;
  const totalRecordsAnalyzed = N;
  const normalRecords = totalRecordsAnalyzed - totalAnomalies;
  const anomalyPct = totalRecordsAnalyzed > 0 ? Number(((totalAnomalies / totalRecordsAnalyzed) * 100).toFixed(2)) : 0;

  if (anomalyPct > 18) {
    falsePositiveWarnings.push(`Flagged ${anomalyPct}% of records, which is higher than typical rarity thresholds (1–8%). Consider switching sensitivity to "Conservative" or inspecting data skewness.`);
  }
  if (totalAnomalies === 0) {
    falsePositiveWarnings.push('Zero anomalies exceeded the active threshold. Try switching sensitivity to "Sensitive" or testing another detector like Isolation Forest / Mahalanobis.');
  }

  // Column Breakdown
  const columnBreakdown = selectedColumns
    .map((col, j) => ({
      column: col,
      anomalyCount: colAnomalyCounts[j],
      pct: totalRecordsAnalyzed > 0 ? Number(((colAnomalyCounts[j] / totalRecordsAnalyzed) * 100).toFixed(2)) : 0,
      avgDeviationSigma: colAnomalyCounts[j] > 0 ? Number((colSigmaSums[j] / colAnomalyCounts[j]).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.anomalyCount - a.anomalyCount);

  // Scatter chart points (first 2 selected columns, or 1st col vs rowIndex)
  const scatterAxes =
    selectedColumns.length >= 2
      ? { xCol: selectedColumns[0], yCol: selectedColumns[1] }
      : { xCol: 'Row Index', yCol: selectedColumns[0] };

  const normalScatter: AnomalyDetectionResult['scatterPoints'] = [];
  const anomalyScatter: AnomalyDetectionResult['scatterPoints'] = [];
  for (let i = 0; i < N; i++) {
    const xVal = selectedColumns.length >= 2 ? matrix[i][0] : originalIndices[i] + 1;
    const yVal = selectedColumns.length >= 2 ? matrix[i][1] : matrix[i][0];
    const pt = {
      x: Number(xVal.toFixed(2)),
      y: Number(yVal.toFixed(2)),
      severity: rowFlagged[i] ? classifySeverity(rowScore[i]) : ('normal' as const),
      rowIndex: originalIndices[i] + 1,
      score: rowScore[i],
    };
    if (rowFlagged[i]) anomalyScatter.push(pt);
    else if (normalScatter.length < 240) normalScatter.push(pt);
  }
  const scatterPoints = [...normalScatter, ...anomalyScatter.slice(0, 240)];

  // Time-series / Sequential points (include expected baseline & tolerance bands)
  const seqOrder = originalIndices.map((origIdx, matIdx) => {
    const d = dateColumnUsed ? parseDateValue(dataset.rows[origIdx][dateColumnUsed]) : null;
    return {
      matIdx,
      origIdx,
      ts: d ? d.getTime() : origIdx,
      label: d ? d.toISOString().slice(0, 10) : `#${origIdx + 1}`,
    };
  });
  seqOrder.sort((a, b) => a.ts - b.ts);

  // If non-TS algorithm was run, compute a reference leave-one-out baseline for visual guidance on time-series chart
  if (tsExpectedByMatIdx[seqOrder[0]?.matIdx] === undefined && seqOrder.length > 0) {
    const halfRef = Math.max(2, Math.floor((config.windowSize || 7) / 2));
    const vals = seqOrder.map((o) => matrix[o.matIdx][0]);
    const refStd = colStds[0] || 1;
    for (let k = 0; k < seqOrder.length; k++) {
      const win: number[] = [];
      for (let m = Math.max(0, k - halfRef); m <= Math.min(seqOrder.length - 1, k + halfRef); m++) {
        if (m !== k) win.push(vals[m]);
      }
      const base = win.length > 0 ? median([...win].sort((a, b) => a - b)) : vals[k];
      tsExpectedByMatIdx[seqOrder[k].matIdx] = base;
      tsBandHalfByMatIdx[seqOrder[k].matIdx] = tsCutoffUsed * refStd;
    }
  }

  const seqStep = Math.max(1, Math.floor(seqOrder.length / 180));
  const timeSeriesPoints: AnomalyDetectionResult['timeSeriesPoints'] = [];
  for (let k = 0; k < seqOrder.length; k++) {
    const item = seqOrder[k];
    if (k % seqStep !== 0 && !rowFlagged[item.matIdx]) continue;
    const expVal = tsExpectedByMatIdx[item.matIdx];
    const halfBand = tsBandHalfByMatIdx[item.matIdx];
    timeSeriesPoints.push({
      label: item.label,
      value: Number(matrix[item.matIdx][0].toFixed(2)),
      expectedValue: expVal !== undefined ? Number(expVal.toFixed(2)) : undefined,
      lowerBand: expVal !== undefined && halfBand !== undefined ? Number((expVal - halfBand).toFixed(2)) : undefined,
      upperBand: expVal !== undefined && halfBand !== undefined ? Number((expVal + halfBand).toFixed(2)) : undefined,
      isAnomaly: rowFlagged[item.matIdx],
      severity: rowFlagged[item.matIdx] ? classifySeverity(rowScore[item.matIdx]) : 'normal',
      score: rowScore[item.matIdx],
      rowIndex: item.origIdx + 1,
      patternType: rowTsPattern[item.matIdx],
    });
  }

  const timeSeriesPatternBreakdown =
    resolvedAlgorithm === 'moving_average' || resolvedAlgorithm === 'rolling_std' || resolvedAlgorithm === 'seasonal_trend'
      ? {
          sudden_spike: records.filter((r) => r.timeSeriesPattern === 'sudden_spike').length,
          sudden_drop: records.filter((r) => r.timeSeriesPattern === 'sudden_drop').length,
          unexpected_fluctuation: records.filter((r) => r.timeSeriesPattern === 'unexpected_fluctuation').length,
          trend_deviation: records.filter((r) => r.timeSeriesPattern === 'trend_deviation').length,
          seasonal_deviation: records.filter((r) => r.timeSeriesPattern === 'seasonal_deviation').length,
        }
      : undefined;

  // Score Distribution (10 bins: 0-10 .. 90-100)
  const scoreDistribution = Array.from({ length: 10 }, (_, b) => ({
    range: `${b * 10}–${(b + 1) * 10}`,
    normalCount: 0,
    anomalyCount: 0,
  }));
  for (let i = 0; i < N; i++) {
    let bin = Math.floor(rowScore[i] / 10);
    if (bin >= 10) bin = 9;
    if (bin < 0) bin = 0;
    if (rowFlagged[i]) scoreDistribution[bin].anomalyCount++;
    else scoreDistribution[bin].normalCount++;
  }

  // Correlation impact analysis (Full vs Normal records)
  const correlationComparison: AnomalyDetectionResult['correlationComparison'] = [];
  if (selectedColumns.length >= 2) {
    for (let a = 0; a < Math.min(selectedColumns.length, 4); a++) {
      for (let b = a + 1; b < Math.min(selectedColumns.length, 4); b++) {
        const allX = matrix.map((r) => r[a]);
        const allY = matrix.map((r) => r[b]);
        const normX: number[] = [];
        const normY: number[] = [];
        for (let i = 0; i < N; i++) {
          if (!rowFlagged[i]) {
            normX.push(matrix[i][a]);
            normY.push(matrix[i][b]);
          }
        }
        const allR = computePearsonCorrelation(allX, allY) ?? 0;
        const normalR = computePearsonCorrelation(normX, normY) ?? allR;
        correlationComparison.push({
          pair: `${selectedColumns[a]} vs ${selectedColumns[b]}`,
          normalR,
          allR,
        });
      }
    }
  }

  const meta = ANOMALY_ALGORITHMS.find((a) => a.id === resolvedAlgorithm);
  const paramParts = [`Sensitivity: ${sens}`, `Features (${selectedColumns.length}): ${selectedColumns.join(', ')}`];
  if (dateColumnUsed) paramParts.push(`Date axis: ${dateColumnUsed}`);
  if (windowSizeUsed) paramParts.push(`Window: ${windowSizeUsed}`);
  if (kNeighborsUsed) paramParts.push(`k-Neighbors: ${kNeighborsUsed}`);

  return {
    id: `anom_${Date.now()}`,
    datasetId: dataset.id,
    requestedAlgorithm: config.algorithm,
    resolvedAlgorithm,
    algorithmLabel: meta?.label || resolvedAlgorithm,
    autoDetectReason,
    sensitivity: sens,
    featuresEvaluated: selectedColumns,
    dateColumnUsed,
    windowSizeUsed,
    kNeighborsUsed,
    detectedParametersSummary: paramParts.join(' · '),
    totalRecordsAnalyzed,
    sampledRecordsCount: isSampled ? evalSampleIndices.length : totalRecordsAnalyzed,
    isSampled,
    totalAnomalies,
    normalRecords,
    anomalyPct,
    highCount,
    mediumCount,
    lowCount,
    records,
    allRowScores,
    allRowFlags,
    columnBreakdown,
    scatterPoints,
    scatterAxes,
    timeSeriesPoints: timeSeriesPoints.slice(0, 260),
    timeSeriesPatternBreakdown,
    scoreDistribution,
    correlationComparison: correlationComparison.slice(0, 6),
    limitations,
    falsePositiveWarnings,
    executionTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    generatedAt: new Date().toISOString(),
  };
}

// Multi-Algorithm Comparison across Z-Score, IQR, Isolation Forest, LOF, DBSCAN
// Strictly avoids pooling raw heterogeneous scores as calibrated probabilities.
const COMPARISON_ALGORITHMS: Array<{ id: ComparisonAlgorithmId; label: string; scoreScaleNote: string }> = [
  { id: 'z_score', label: 'Z-Score', scoreScaleNote: 'Unbounded |z| distance from column mean (σ units)' },
  { id: 'iqr', label: 'IQR (Tukey)', scoreScaleNote: 'Quartile fence excess ratio outside [Q1 - k·IQR, Q3 + k·IQR]' },
  { id: 'isolation_forest', label: 'Isolation Forest', scoreScaleNote: 'Expected random tree split path score (0.5–1.0 native)' },
  { id: 'lof', label: 'Local Outlier Factor', scoreScaleNote: 'Local density ratio relative to k-nearest neighbors (≥1.0 baseline)' },
  { id: 'dbscan', label: 'DBSCAN', scoreScaleNote: 'Binary cluster core/border vs. isolated density noise (-1)' },
];

export function compareAnomalyAlgorithms(
  dataset: Dataset,
  options: {
    selectedColumns: string[];
    sensitivity: 'conservative' | 'balanced' | 'sensitive';
    kNeighbors?: number;
  }
): AnomalyComparisonSummary {
  const { selectedColumns, sensitivity, kNeighbors = 10 } = options;

  const runs = COMPARISON_ALGORITHMS.map((meta) => {
    const res = runAnomalyDetection(dataset, {
      algorithm: meta.id,
      sensitivity,
      selectedColumns,
      kNeighbors,
    });
    return { meta, res };
  });

  const entries: AnomalyAlgorithmComparisonEntry[] = runs.map(({ meta, res }) => ({
    id: meta.id,
    label: meta.label,
    flaggedCount: res.totalAnomalies,
    anomalyPct: res.anomalyPct,
    highCount: res.highCount,
    mediumCount: res.mediumCount,
    lowCount: res.lowCount,
    isSampled: res.isSampled,
    executionTimeMs: res.executionTimeMs,
    scoreScaleNote: meta.scoreScaleNote,
    flaggedRowIndices: res.records.map((r) => r.rowIndex),
  }));

  const rowToAlgos = new Map<number, ComparisonAlgorithmId[]>();
  const rowToSampleSummary = new Map<number, { recordId: string; summaryValues: string }>();

  for (const { meta, res } of runs) {
    for (const rec of res.records) {
      const list = rowToAlgos.get(rec.rowIndex) || [];
      list.push(meta.id);
      rowToAlgos.set(rec.rowIndex, list);
      if (!rowToSampleSummary.has(rec.rowIndex)) {
        rowToSampleSummary.set(rec.rowIndex, {
          recordId: rec.recordId,
          summaryValues: rec.actualValuesSummary,
        });
      }
    }
  }

  let unanimousCount = 0;
  let consensusCount = 0;
  let singleAlgorithmOnlyCount = 0;
  const disagreementHighlights: AnomalyDisagreementRecord[] = [];
  const allAlgoIds = COMPARISON_ALGORITHMS.map((a) => a.id);

  rowToAlgos.forEach((flaggedBy, rowIndex) => {
    if (flaggedBy.length === allAlgoIds.length) unanimousCount++;
    if (flaggedBy.length >= 3) consensusCount++;
    if (flaggedBy.length === 1) singleAlgorithmOnlyCount++;

    if (flaggedBy.length < allAlgoIds.length) {
      const missedBy = allAlgoIds.filter((id) => !flaggedBy.includes(id));
      const meta = rowToSampleSummary.get(rowIndex);
      disagreementHighlights.push({
        rowIndex,
        recordId: meta?.recordId || `Row #${rowIndex}`,
        flaggedBy,
        missedBy,
        summaryValues: meta?.summaryValues || '',
        agreementRatio: `${flaggedBy.length}/${allAlgoIds.length}`,
      });
    }
  });

  // Sort disagreements to prioritize interesting partial agreements (e.g., 2–4 detectors agree, or multivariate vs univariate split)
  disagreementHighlights.sort((a, b) => b.flaggedBy.length - a.flaggedBy.length || a.rowIndex - b.rowIndex);

  const setByAlgo = new Map<ComparisonAlgorithmId, Set<number>>(
    entries.map((e) => [e.id, new Set(e.flaggedRowIndices)])
  );

  const pairwiseMatrix = COMPARISON_ALGORITHMS.map((a) => ({
    algoA: a.id,
    labelA: a.label,
    values: COMPARISON_ALGORITHMS.map((b) => {
      const setA = setByAlgo.get(a.id) || new Set<number>();
      const setB = setByAlgo.get(b.id) || new Set<number>();
      let overlap = 0;
      setA.forEach((idx) => {
        if (setB.has(idx)) overlap++;
      });
      const unionSize = setA.size + setB.size - overlap;
      const jaccardPct = unionSize > 0 ? Number(((overlap / unionSize) * 100).toFixed(1)) : 100;
      return { algoB: b.id, overlapCount: overlap, jaccardPct };
    }),
  }));

  return {
    featuresEvaluated: runs[0].res.featuresEvaluated,
    sensitivity,
    totalRecordsAnalyzed: runs[0].res.totalRecordsAnalyzed,
    entries,
    unanimousCount,
    consensusCount,
    singleAlgorithmOnlyCount,
    pairwiseMatrix,
    disagreementHighlights: disagreementHighlights.slice(0, 20),
    calibrationWarning:
      'Methodological Caution: Z-Score (σ units), IQR fences, Isolation Forest path depth, LOF neighbor density ratios, and DBSCAN cluster membership measure fundamentally different mathematical properties. Compare agreement on flagged record sets—never average or compare their raw scores as calibrated probabilities.',
    generatedAt: new Date().toISOString(),
  };
}

// Lightweight deterministic row-level anomaly feature extractor used by Predictive ML & Chat
export function computeRowAnomalyFeatures(dataset: Dataset): {
  scores: number[];
  flags: boolean[];
  summary: AnomalyDetectionResult;
} {
  const numericCols = dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name);
  const summary = runAnomalyDetection(dataset, {
    algorithm: numericCols.length >= 2 ? 'isolation_forest' : 'modified_z_score',
    sensitivity: 'balanced',
    selectedColumns: numericCols.slice(0, 8),
  });
  return {
    scores: summary.allRowScores,
    flags: summary.allRowFlags,
    summary,
  };
}
