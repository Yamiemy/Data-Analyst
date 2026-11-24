import { computeRowAnomalyFeatures } from './anomalyEngine';
import { isNullish, parseDateValue, parseNumericValue } from './parser';
import type { Dataset, DatasetRow, PredictiveModelResult } from '../types/data';

function buildInputsSummary(cols: string[], vals: Array<number | string>): string {
  return cols
    .slice(0, 4)
    .map((c, idx) => `${c}: ${vals[idx]}`)
    .join(' · ');
}

function enrichDatasetWithAnomalyFeatures(
  dataset: Dataset,
  featureCols: string[],
  includeAnomalyFeatures: boolean
): { rows: DatasetRow[]; effectiveFeatures: string[]; extraNumericCols: string[] } {
  if (!includeAnomalyFeatures) {
    return { rows: dataset.rows, effectiveFeatures: featureCols, extraNumericCols: [] };
  }
  const anom = computeRowAnomalyFeatures(dataset);
  const augmentedRows: DatasetRow[] = dataset.rows.map((r, idx) => ({
    ...r,
    Anomaly_Score: anom.scores[idx] ?? 0,
    Is_Anomaly: anom.flags[idx] ? 1 : 0,
  }));
  const extra = ['Anomaly_Score', 'Is_Anomaly'];
  const combined = [...featureCols];
  for (const col of extra) {
    if (!combined.includes(col)) combined.push(col);
  }
  return { rows: augmentedRows, effectiveFeatures: combined, extraNumericCols: extra };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = Math.abs(M[col][col]) < 1e-10 ? 1e-10 : M[col][col];

    for (let j = col; j <= n; j++) M[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r !== col) {
        const factor = M[r][col];
        for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
      }
    }
  }
  return M.map((row) => row[n]);
}

function deterministicShuffle<T>(arr: T[], seed = 42): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = Math.floor((s / 4294967296) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function runLinearRegression(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  if (featureCols.length === 0) {
    throw new Error('Select at least one numeric input feature.');
  }

  const { rows: workingRows, effectiveFeatures } = enrichDatasetWithAnomalyFeatures(
    dataset,
    featureCols.filter((f) => f !== targetCol),
    includeAnomalyFeatures
  );

  const samples: Array<{ rowNum: number; x: number[]; y: number; preview: Record<string, string | number | boolean | null> }> = [];
  workingRows.forEach((row, idx) => {
    const y = parseNumericValue(row[targetCol]);
    if (y === null) return;
    const x: number[] = [];
    let valid = true;
    for (const f of effectiveFeatures) {
      const val = parseNumericValue(row[f]);
      if (val === null) {
        valid = false;
        break;
      }
      x.push(val);
    }
    if (valid) {
      const preview: Record<string, string | number | boolean | null> = { Row: `#${idx + 1}`, [targetCol]: y };
      effectiveFeatures.slice(0, 5).forEach((f, fIdx) => {
        preview[f] = x[fIdx];
      });
      samples.push({ rowNum: idx + 1, x, y, preview });
    }
  });

  if (samples.length < 10) {
    throw new Error(`Insufficient complete numeric records (${samples.length}). Need at least 10 valid rows.`);
  }

  const shuffled = deterministicShuffle(samples, 42);
  const splitIdx = Math.max(5, Math.min(shuffled.length - 3, Math.floor(shuffled.length * trainSplit)));
  const train = shuffled.slice(0, splitIdx);
  const test = shuffled.slice(splitIdx);

  // Standardize features on train set for numerical stability and comparable feature importance
  const p = effectiveFeatures.length;
  const means = Array.from({ length: p }, (_, j) => train.reduce((s, r) => s + r.x[j], 0) / train.length);
  const stds = Array.from({ length: p }, (_, j) => {
    const variance = train.reduce((s, r) => s + Math.pow(r.x[j] - means[j], 2), 0) / train.length;
    return Math.sqrt(variance) || 1;
  });

  const encode = (vec: number[]) => [1, ...vec.map((v, j) => (v - means[j]) / stds[j])];
  const dims = p + 1;
  const XtX = Array.from({ length: dims }, () => Array(dims).fill(0));
  const Xty = Array(dims).fill(0);

  for (const row of train) {
    const xv = encode(row.x);
    for (let i = 0; i < dims; i++) {
      Xty[i] += xv[i] * row.y;
      for (let j = 0; j < dims; j++) {
        XtX[i][j] += xv[i] * xv[j];
      }
    }
  }
  for (let i = 1; i < dims; i++) XtX[i][i] += 1e-4;

  const weights = solveLinearSystem(XtX, Xty);

  const predict = (vec: number[]) => {
    const xv = encode(vec);
    return xv.reduce((acc, v, idx) => acc + v * weights[idx], 0);
  };

  const preds = test.map((r) => {
    const predicted = Number(predict(r.x).toFixed(2));
    const err = Number((r.y - predicted).toFixed(2));
    return {
      rowNum: r.rowNum,
      actual: r.y,
      predicted,
      err,
      inputsSummary: buildInputsSummary(effectiveFeatures, r.x),
    };
  });
  const meanActual = preds.reduce((s, r) => s + r.actual, 0) / preds.length;
  const ssRes = preds.reduce((s, r) => s + Math.pow(r.actual - r.predicted, 2), 0);
  const ssTot = preds.reduce((s, r) => s + Math.pow(r.actual - meanActual, 2), 0);
  const r2 = ssTot > 0 ? Number((1 - ssRes / ssTot).toFixed(4)) : 0;
  const rmse = Number(Math.sqrt(ssRes / preds.length).toFixed(3));
  const mae = Number((preds.reduce((s, r) => s + Math.abs(r.actual - r.predicted), 0) / preds.length).toFixed(3));

  return {
    id: `model_${Date.now()}`,
    taskType: 'linear_regression',
    modelName: 'Ridge-Stabilized OLS Linear Regression',
    targetColumn: targetCol,
    featureColumns: effectiveFeatures,
    trainCount: train.length,
    testCount: test.length,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'R² Score', value: String(r2), description: 'Proportion of target variance explained on holdout test set.' },
      { label: 'RMSE', value: rmse.toLocaleString(), description: 'Root Mean Squared Error in target units.' },
      { label: 'MAE', value: mae.toLocaleString(), description: 'Mean Absolute Error across test predictions.' },
    ],
    featureImportances: effectiveFeatures
      .map((f, idx) => ({ feature: f, weight: Number(weights[idx + 1].toFixed(3)) }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    actualVsPredicted: preds.slice(0, 60).map((pItem, idx) => ({
      index: `#${idx + 1}`,
      actual: pItem.actual,
      predicted: pItem.predicted,
    })),
    predictionsTable: preds.slice(0, 50).map((pItem) => ({
      rowNumber: pItem.rowNum,
      actual: pItem.actual,
      predicted: pItem.predicted,
      errorOrMatch: `${pItem.err >= 0 ? '+' : ''}${pItem.err}`,
      inputsSummary: pItem.inputsSummary,
    })),
    trainSamplePreview: train.slice(0, 8).map((r) => r.preview),
    testSamplePreview: test.slice(0, 8).map((r) => r.preview),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      'Linear regression assumes an additive linear relationship between features and the target.',
      'Standardized weights show relative linear association within the observed range, not causal proof.',
      'Extreme outliers or missing rows excluded during training can shift slope estimates.',
    ],
  };
}

interface PreparedClassificationData {
  classes: string[];
  effectiveFeatures: string[];
  featureTypes: Array<'number' | 'string' | 'date' | 'boolean'>;
  samples: Array<{ rowNum: number; vals: Array<number | string>; label: string; preview: Record<string, string | number | boolean | null> }>;
  train: Array<{ rowNum: number; vals: Array<number | string>; label: string; preview: Record<string, string | number | boolean | null> }>;
  test: Array<{ rowNum: number; vals: Array<number | string>; label: string; preview: Record<string, string | number | boolean | null> }>;
}

function prepareClassificationData(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PreparedClassificationData {
  if (featureCols.length === 0) {
    throw new Error('Select at least one feature column.');
  }

  const { rows: workingRows, effectiveFeatures, extraNumericCols } = enrichDatasetWithAnomalyFeatures(
    dataset,
    featureCols.filter((f) => f !== targetCol),
    includeAnomalyFeatures
  );

  const featureTypes = effectiveFeatures.map((f) =>
    extraNumericCols.includes(f) ? 'number' : dataset.profile.columns.find((c) => c.name === f)?.type || 'string'
  );

  const samples: PreparedClassificationData['samples'] = [];
  workingRows.forEach((row, rIdx) => {
    if (isNullish(row[targetCol])) return;
    const label = String(row[targetCol]).trim();
    const vals: Array<number | string> = [];
    let valid = true;
    for (let i = 0; i < effectiveFeatures.length; i++) {
      const raw = row[effectiveFeatures[i]];
      if (isNullish(raw)) {
        valid = false;
        break;
      }
      if (featureTypes[i] === 'number') {
        const n = parseNumericValue(raw);
        if (n === null) {
          valid = false;
          break;
        }
        vals.push(n);
      } else {
        vals.push(String(raw).trim());
      }
    }
    if (valid) {
      const preview: Record<string, string | number | boolean | null> = { Row: `#${rIdx + 1}`, [targetCol]: label };
      effectiveFeatures.slice(0, 5).forEach((f, idx) => {
        preview[f] = vals[idx];
      });
      samples.push({ rowNum: rIdx + 1, vals, label, preview });
    }
  });

  if (samples.length < 12) {
    throw new Error(`Insufficient complete rows (${samples.length}) for classification.`);
  }

  const classes = Array.from(new Set(samples.map((s) => s.label))).slice(0, 12);
  if (classes.length < 2) {
    throw new Error(`Target column "${targetCol}" must have at least 2 distinct classes.`);
  }

  const filteredSamples = samples.filter((s) => classes.includes(s.label));
  const shuffled = deterministicShuffle(filteredSamples, 77);
  const splitIdx = Math.max(6, Math.min(shuffled.length - 4, Math.floor(shuffled.length * trainSplit)));

  return {
    classes,
    effectiveFeatures,
    featureTypes,
    samples: filteredSamples,
    train: shuffled.slice(0, splitIdx),
    test: shuffled.slice(splitIdx),
  };
}

function evaluateConfusionMetrics(classes: string[], actuals: string[], predictions: string[]) {
  const matrix = Array.from({ length: classes.length }, () => Array(classes.length).fill(0));
  let correct = 0;
  for (let i = 0; i < actuals.length; i++) {
    const aIdx = classes.indexOf(actuals[i]);
    const pIdx = classes.indexOf(predictions[i]);
    if (aIdx >= 0 && pIdx >= 0) matrix[aIdx][pIdx]++;
    if (actuals[i] === predictions[i]) correct++;
  }

  const accuracy = Number(((correct / Math.max(1, actuals.length)) * 100).toFixed(1));
  let f1Sum = 0;
  let precSum = 0;
  let recSum = 0;
  for (let i = 0; i < classes.length; i++) {
    const tp = matrix[i][i];
    const fp = matrix.reduce((s, row, rIdx) => (rIdx !== i ? s + row[i] : s), 0);
    const fn = matrix[i].reduce((s, v, cIdx) => (cIdx !== i ? s + v : s), 0);
    const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
    precSum += prec;
    recSum += rec;
    f1Sum += f1;
  }

  return {
    matrix,
    correct,
    accuracy,
    macroPrecision: Number(((precSum / classes.length) * 100).toFixed(1)),
    macroRecall: Number(((recSum / classes.length) * 100).toFixed(1)),
    macroF1: Number(((f1Sum / classes.length) * 100).toFixed(1)),
  };
}

export function runClassification(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  const { classes, effectiveFeatures, featureTypes, train, test } = prepareClassificationData(
    dataset,
    targetCol,
    featureCols,
    trainSplit,
    includeAnomalyFeatures
  );

  const classStats = new Map<
    string,
    {
      prior: number;
      numStats: Map<number, { mean: number; var: number }>;
      catCounts: Map<number, Map<string, number>>;
      count: number;
    }
  >();

  for (const cls of classes) {
    const subset = train.filter((s) => s.label === cls);
    const numStats = new Map<number, { mean: number; var: number }>();
    const catCounts = new Map<number, Map<string, number>>();

    effectiveFeatures.forEach((_, idx) => {
      if (featureTypes[idx] === 'number') {
        const nums = subset.map((s) => Number(s.vals[idx]));
        const mean = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        const variance =
          nums.length > 1
            ? nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length + 1e-4
            : 1;
        numStats.set(idx, { mean, var: variance });
      } else {
        const counts = new Map<string, number>();
        for (const s of subset) {
          const k = String(s.vals[idx]);
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        catCounts.set(idx, counts);
      }
    });

    classStats.set(cls, {
      prior: (subset.length + 1) / (train.length + classes.length),
      numStats,
      catCounts,
      count: subset.length,
    });
  }

  const predictClass = (vals: Array<number | string>): string => {
    let bestCls = classes[0];
    let bestLogProb = -Infinity;
    for (const cls of classes) {
      const st = classStats.get(cls)!;
      let logP = Math.log(st.prior);
      effectiveFeatures.forEach((_, idx) => {
        if (featureTypes[idx] === 'number') {
          const x = Number(vals[idx]);
          const { mean, var: v } = st.numStats.get(idx)!;
          logP += -0.5 * Math.log(2 * Math.PI * v) - Math.pow(x - mean, 2) / (2 * v);
        } else {
          const map = st.catCounts.get(idx)!;
          const cnt = map.get(String(vals[idx])) || 0;
          logP += Math.log((cnt + 1) / (st.count + Math.max(2, map.size)));
        }
      });
      if (logP > bestLogProb) {
        bestLogProb = logP;
        bestCls = cls;
      }
    }
    return bestCls;
  };

  const preds = test.map((r) => predictClass(r.vals));
  const evalMetrics = evaluateConfusionMetrics(classes, test.map((r) => r.label), preds);

  return {
    id: `model_${Date.now()}`,
    taskType: 'classification',
    modelName: 'Hybrid Gaussian / Categorical Naive Bayes',
    targetColumn: targetCol,
    featureColumns: effectiveFeatures,
    trainCount: train.length,
    testCount: test.length,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Test Accuracy', value: `${evalMetrics.accuracy}%`, description: `${evalMetrics.correct} of ${test.length} test rows classified accurately.` },
      { label: 'Macro Precision', value: `${evalMetrics.macroPrecision}%`, description: 'Average positive predictive precision across classes.' },
      { label: 'Macro F1 Score', value: `${evalMetrics.macroF1}%`, description: 'Harmonic mean of precision and recall across classes.' },
    ],
    confusionMatrix: { labels: classes, matrix: evalMetrics.matrix },
    predictionsTable: test.slice(0, 50).map((r, i) => ({
      rowNumber: r.rowNum,
      actual: r.label,
      predicted: preds[i],
      errorOrMatch: r.label === preds[i] ? 'Match' : 'Mismatch',
      inputsSummary: buildInputsSummary(effectiveFeatures, r.vals),
    })),
    trainSamplePreview: train.slice(0, 8).map((r) => r.preview),
    testSamplePreview: test.slice(0, 8).map((r) => r.preview),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      'Naive Bayes assumes conditional independence across selected features given the target class.',
      'Class imbalance in the training split can bias prior probabilities toward majority outcomes.',
      'Evaluated on a single deterministic 80/20 holdout split; validate with cross-validation before operational deployment.',
    ],
  };
}

export function runLogisticRegression(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  const { classes, effectiveFeatures, featureTypes, train, test } = prepareClassificationData(
    dataset,
    targetCol,
    featureCols,
    trainSplit,
    includeAnomalyFeatures
  );

  // Build standardized numeric + one-hot categorical encoder on train split
  interface EncodedSpec {
    mean?: number;
    std?: number;
    categories?: string[];
    featureName: string;
    startIdx: number;
    endIdx: number;
  }
  const specs: EncodedSpec[] = [];
  let totalDim = 1; // index 0 = bias

  effectiveFeatures.forEach((f, idx) => {
    if (featureTypes[idx] === 'number') {
      const nums = train.map((r) => Number(r.vals[idx]));
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
      specs.push({ featureName: f, mean, std: Math.sqrt(variance) || 1, startIdx: totalDim, endIdx: totalDim + 1 });
      totalDim += 1;
    } else {
      const freq = new Map<string, number>();
      for (const r of train) {
        const v = String(r.vals[idx]);
        freq.set(v, (freq.get(v) || 0) + 1);
      }
      const cats = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k]) => k);
      specs.push({ featureName: f, categories: cats, startIdx: totalDim, endIdx: totalDim + cats.length });
      totalDim += cats.length;
    }
  });

  const encodeRow = (vals: Array<number | string>): number[] => {
    const vec = new Array<number>(totalDim).fill(0);
    vec[0] = 1;
    specs.forEach((spec, idx) => {
      if (spec.categories) {
        const catIdx = spec.categories.indexOf(String(vals[idx]));
        if (catIdx >= 0) vec[spec.startIdx + catIdx] = 1;
      } else {
        vec[spec.startIdx] = (Number(vals[idx]) - (spec.mean ?? 0)) / (spec.std ?? 1);
      }
    });
    return vec;
  };

  const XTrain = train.map((r) => encodeRow(r.vals));
  const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-25, Math.min(25, z))));

  const lr = 0.25;
  const reg = 0.01;
  const epochs = 220;
  const weightMatrix: number[][] = classes.map((cls) => {
    const w = new Array<number>(totalDim).fill(0);
    const yBin = train.map((r) => (r.label === cls ? 1 : 0));
    for (let ep = 0; ep < epochs; ep++) {
      const grad = new Array<number>(totalDim).fill(0);
      for (let i = 0; i < XTrain.length; i++) {
        const xi = XTrain[i];
        let z = 0;
        for (let d = 0; d < totalDim; d++) z += w[d] * xi[d];
        const diff = sigmoid(z) - yBin[i];
        for (let d = 0; d < totalDim; d++) grad[d] += diff * xi[d];
      }
      for (let d = 0; d < totalDim; d++) {
        const penalty = d === 0 ? 0 : reg * w[d];
        w[d] -= lr * (grad[d] / XTrain.length + penalty);
      }
    }
    return w;
  });

  const predict = (vals: Array<number | string>): string => {
    const x = encodeRow(vals);
    let bestCls = classes[0];
    let bestProb = -1;
    classes.forEach((cls, cIdx) => {
      let z = 0;
      const w = weightMatrix[cIdx];
      for (let d = 0; d < totalDim; d++) z += w[d] * x[d];
      const p = sigmoid(z);
      if (p > bestProb) {
        bestProb = p;
        bestCls = cls;
      }
    });
    return bestCls;
  };

  const preds = test.map((r) => predict(r.vals));
  const evalMetrics = evaluateConfusionMetrics(classes, test.map((r) => r.label), preds);

  const featureImportances = specs
    .map((spec) => {
      let sumAbs = 0;
      let count = 0;
      for (const w of weightMatrix) {
        for (let d = spec.startIdx; d < spec.endIdx; d++) {
          sumAbs += Math.abs(w[d]);
          count++;
        }
      }
      return { feature: spec.featureName, weight: Number((sumAbs / Math.max(1, count)).toFixed(3)) };
    })
    .sort((a, b) => b.weight - a.weight);

  return {
    id: `model_${Date.now()}`,
    taskType: 'logistic_regression',
    modelName: classes.length === 2 ? 'L2-Regularized Binary Logistic Regression' : 'One-vs-Rest Multinomial Logistic Regression',
    targetColumn: targetCol,
    featureColumns: effectiveFeatures,
    trainCount: train.length,
    testCount: test.length,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Test Accuracy', value: `${evalMetrics.accuracy}%`, description: `${evalMetrics.correct} of ${test.length} holdout rows classified correctly.` },
      { label: 'Macro Precision', value: `${evalMetrics.macroPrecision}%`, description: 'Average positive predictive value across target classes.' },
      { label: 'Macro F1 Score', value: `${evalMetrics.macroF1}%`, description: 'Balanced precision/recall harmonic mean on test split.' },
    ],
    featureImportances,
    confusionMatrix: { labels: classes, matrix: evalMetrics.matrix },
    predictionsTable: test.slice(0, 50).map((r, i) => ({
      rowNumber: r.rowNum,
      actual: r.label,
      predicted: preds[i],
      errorOrMatch: r.label === preds[i] ? 'Match' : 'Mismatch',
      inputsSummary: buildInputsSummary(effectiveFeatures, r.vals),
    })),
    trainSamplePreview: train.slice(0, 8).map((r) => r.preview),
    testSamplePreview: test.slice(0, 8).map((r) => r.preview),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      'Logistic Regression assumes linear log-odds decision boundaries across standardized features.',
      'High-cardinality categorical features are capped to the top 8 levels on the training split.',
      'Feature weights measure average absolute log-odds contribution, not causal effect.',
    ],
  };
}

interface TreeNode {
  prediction: string;
  featureIdx?: number;
  threshold?: number;
  category?: string;
  left?: TreeNode;
  right?: TreeNode;
}

function giniImpurity(counts: Map<string, number>, total: number): number {
  if (total === 0) return 0;
  let sumSq = 0;
  for (const c of counts.values()) {
    const p = c / total;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

function buildCartTree(
  rows: Array<{ vals: Array<number | string>; label: string }>,
  featureTypes: Array<'number' | 'string' | 'date' | 'boolean'>,
  maxDepth: number,
  minSamplesSplit: number,
  featureSubsetIndices: number[] | null,
  importances: number[],
  depth = 0
): TreeNode {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.label, (counts.get(r.label) || 0) + 1);
  let majorityLabel = rows[0]?.label || '';
  let maxCnt = -1;
  for (const [lbl, cnt] of counts.entries()) {
    if (cnt > maxCnt) {
      maxCnt = cnt;
      majorityLabel = lbl;
    }
  }

  const parentGini = giniImpurity(counts, rows.length);
  if (depth >= maxDepth || rows.length < minSamplesSplit || counts.size <= 1) {
    return { prediction: majorityLabel };
  }

  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold: number | undefined;
  let bestCategory: string | undefined;
  let bestLeft: typeof rows = [];
  let bestRight: typeof rows = [];

  const candidates = featureSubsetIndices || featureTypes.map((_, i) => i);

  for (const fIdx of candidates) {
    if (featureTypes[fIdx] === 'number') {
      const uniqueVals = Array.from(new Set(rows.map((r) => Number(r.vals[fIdx])))).sort((a, b) => a - b);
      if (uniqueVals.length < 2) continue;
      // Sample up to 12 quantiles for speed and determinism
      const step = Math.max(1, Math.floor((uniqueVals.length - 1) / 12));
      for (let i = 0; i < uniqueVals.length - 1; i += step) {
        const thresh = (uniqueVals[i] + uniqueVals[i + 1]) / 2;
        const left: typeof rows = [];
        const right: typeof rows = [];
        const lCnt = new Map<string, number>();
        const rCnt = new Map<string, number>();
        for (const r of rows) {
          if (Number(r.vals[fIdx]) <= thresh) {
            left.push(r);
            lCnt.set(r.label, (lCnt.get(r.label) || 0) + 1);
          } else {
            right.push(r);
            rCnt.set(r.label, (rCnt.get(r.label) || 0) + 1);
          }
        }
        if (left.length === 0 || right.length === 0) continue;
        const weightedGini =
          (left.length / rows.length) * giniImpurity(lCnt, left.length) +
          (right.length / rows.length) * giniImpurity(rCnt, right.length);
        const gain = parentGini - weightedGini;
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = fIdx;
          bestThreshold = thresh;
          bestCategory = undefined;
          bestLeft = left;
          bestRight = right;
        }
      }
    } else {
      const cats = Array.from(new Set(rows.map((r) => String(r.vals[fIdx])))).slice(0, 12);
      for (const cat of cats) {
        const left: typeof rows = [];
        const right: typeof rows = [];
        const lCnt = new Map<string, number>();
        const rCnt = new Map<string, number>();
        for (const r of rows) {
          if (String(r.vals[fIdx]) === cat) {
            left.push(r);
            lCnt.set(r.label, (lCnt.get(r.label) || 0) + 1);
          } else {
            right.push(r);
            rCnt.set(r.label, (rCnt.get(r.label) || 0) + 1);
          }
        }
        if (left.length === 0 || right.length === 0) continue;
        const weightedGini =
          (left.length / rows.length) * giniImpurity(lCnt, left.length) +
          (right.length / rows.length) * giniImpurity(rCnt, right.length);
        const gain = parentGini - weightedGini;
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = fIdx;
          bestThreshold = undefined;
          bestCategory = cat;
          bestLeft = left;
          bestRight = right;
        }
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 1e-6) {
    return { prediction: majorityLabel };
  }

  importances[bestFeature] += bestGain * rows.length;

  return {
    prediction: majorityLabel,
    featureIdx: bestFeature,
    threshold: bestThreshold,
    category: bestCategory,
    left: buildCartTree(bestLeft, featureTypes, maxDepth, minSamplesSplit, featureSubsetIndices, importances, depth + 1),
    right: buildCartTree(bestRight, featureTypes, maxDepth, minSamplesSplit, featureSubsetIndices, importances, depth + 1),
  };
}

function predictTree(node: TreeNode, vals: Array<number | string>): string {
  if (node.featureIdx === undefined || !node.left || !node.right) {
    return node.prediction;
  }
  if (node.threshold !== undefined) {
    return Number(vals[node.featureIdx]) <= node.threshold
      ? predictTree(node.left, vals)
      : predictTree(node.right, vals);
  }
  return String(vals[node.featureIdx]) === node.category
    ? predictTree(node.left, vals)
    : predictTree(node.right, vals);
}

export function runDecisionTree(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  const { classes, effectiveFeatures, featureTypes, train, test } = prepareClassificationData(
    dataset,
    targetCol,
    featureCols,
    trainSplit,
    includeAnomalyFeatures
  );

  const importances = new Array<number>(effectiveFeatures.length).fill(0);
  const tree = buildCartTree(train, featureTypes, 4, 4, null, importances);
  const preds = test.map((r) => predictTree(tree, r.vals));
  const evalMetrics = evaluateConfusionMetrics(classes, test.map((r) => r.label), preds);

  const totalImp = importances.reduce((a, b) => a + b, 0) || 1;
  const featureImportances = effectiveFeatures
    .map((f, idx) => ({ feature: f, weight: Number((importances[idx] / totalImp).toFixed(3)) }))
    .sort((a, b) => b.weight - a.weight);

  return {
    id: `model_${Date.now()}`,
    taskType: 'decision_tree',
    modelName: 'CART Decision Tree Classifier (max depth 4)',
    targetColumn: targetCol,
    featureColumns: effectiveFeatures,
    trainCount: train.length,
    testCount: test.length,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Test Accuracy', value: `${evalMetrics.accuracy}%`, description: `${evalMetrics.correct} of ${test.length} holdout rows classified correctly.` },
      { label: 'Macro Precision', value: `${evalMetrics.macroPrecision}%`, description: 'Average positive predictive value across classes.' },
      { label: 'Macro F1 Score', value: `${evalMetrics.macroF1}%`, description: 'Balanced precision/recall harmonic mean on test split.' },
    ],
    featureImportances,
    confusionMatrix: { labels: classes, matrix: evalMetrics.matrix },
    predictionsTable: test.slice(0, 50).map((r, i) => ({
      rowNumber: r.rowNum,
      actual: r.label,
      predicted: preds[i],
      errorOrMatch: r.label === preds[i] ? 'Match' : 'Mismatch',
      inputsSummary: buildInputsSummary(effectiveFeatures, r.vals),
    })),
    trainSamplePreview: train.slice(0, 8).map((r) => r.preview),
    testSamplePreview: test.slice(0, 8).map((r) => r.preview),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      'Single decision trees can be sensitive to small variations in the training split.',
      'Tree depth is capped at 4 to reduce overfitting while capturing non-linear threshold rules.',
      'Gini feature importance reflects normalized impurity reduction across splits in this tree.',
    ],
  };
}

export function runRandomForest(
  dataset: Dataset,
  targetCol: string,
  featureCols: string[],
  trainSplit = 0.8,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  const { classes, effectiveFeatures, featureTypes, train, test } = prepareClassificationData(
    dataset,
    targetCol,
    featureCols,
    trainSplit,
    includeAnomalyFeatures
  );

  const numTrees = 15;
  const subsetSize = Math.max(1, Math.min(effectiveFeatures.length, Math.ceil(Math.sqrt(effectiveFeatures.length))));
  const importances = new Array<number>(effectiveFeatures.length).fill(0);
  const forest: TreeNode[] = [];

  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let t = 0; t < numTrees; t++) {
    const bootSample = Array.from({ length: train.length }, () => train[Math.floor(nextRand() * train.length)]);
    const allFeatureIdx = effectiveFeatures.map((_, i) => i);
    for (let i = allFeatureIdx.length - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      [allFeatureIdx[i], allFeatureIdx[j]] = [allFeatureIdx[j], allFeatureIdx[i]];
    }
    const featSubset = allFeatureIdx.slice(0, subsetSize);
    forest.push(buildCartTree(bootSample, featureTypes, 5, 3, featSubset, importances));
  }

  const preds = test.map((r) => {
    const votes = new Map<string, number>();
    for (const tree of forest) {
      const p = predictTree(tree, r.vals);
      votes.set(p, (votes.get(p) || 0) + 1);
    }
    let winner = classes[0];
    let bestVotes = -1;
    for (const [lbl, cnt] of votes.entries()) {
      if (cnt > bestVotes) {
        bestVotes = cnt;
        winner = lbl;
      }
    }
    return winner;
  });

  const evalMetrics = evaluateConfusionMetrics(classes, test.map((r) => r.label), preds);
  const totalImp = importances.reduce((a, b) => a + b, 0) || 1;
  const featureImportances = effectiveFeatures
    .map((f, idx) => ({ feature: f, weight: Number((importances[idx] / totalImp).toFixed(3)) }))
    .sort((a, b) => b.weight - a.weight);

  return {
    id: `model_${Date.now()}`,
    taskType: 'random_forest',
    modelName: `Random Forest Ensemble (${numTrees} Bootstrapped CART Trees)`,
    targetColumn: targetCol,
    featureColumns: effectiveFeatures,
    trainCount: train.length,
    testCount: test.length,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Test Accuracy', value: `${evalMetrics.accuracy}%`, description: `${evalMetrics.correct} of ${test.length} holdout rows classified via majority vote.` },
      { label: 'Macro Precision', value: `${evalMetrics.macroPrecision}%`, description: 'Average precision across target classes on test split.' },
      { label: 'Macro F1 Score', value: `${evalMetrics.macroF1}%`, description: 'Balanced precision/recall harmonic mean across classes.' },
    ],
    featureImportances,
    confusionMatrix: { labels: classes, matrix: evalMetrics.matrix },
    predictionsTable: test.slice(0, 50).map((r, i) => ({
      rowNumber: r.rowNum,
      actual: r.label,
      predicted: preds[i],
      errorOrMatch: r.label === preds[i] ? 'Match' : 'Mismatch',
      inputsSummary: buildInputsSummary(effectiveFeatures, r.vals),
    })),
    trainSamplePreview: train.slice(0, 8).map((r) => r.preview),
    testSamplePreview: test.slice(0, 8).map((r) => r.preview),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      `Ensemble averages ${numTrees} depth-limited bootstrapped trees with √p feature subsampling per tree.`,
      'Majority voting improves stability over a single tree, though severe class imbalance can still bias votes.',
      'Verify generalization using k-fold validation or fresh out-of-time samples for production decisions.',
    ],
  };
}

export function runTimeSeriesForecast(
  dataset: Dataset,
  dateCol: string,
  targetCol: string,
  horizon = 6
): PredictiveModelResult {
  const t0 = performance.now();
  const buckets = new Map<string, number>();
  for (const row of dataset.rows) {
    const d = parseDateValue(row[dateCol]);
    const val = parseNumericValue(row[targetCol]);
    if (d && val !== null) {
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, (buckets.get(key) || 0) + val);
    }
  }

  const periods = Array.from(buckets.keys()).sort();
  if (periods.length < 6) {
    throw new Error(`Need at least 6 distinct time periods to fit a forecast (found ${periods.length}).`);
  }

  const series = periods.map((p) => Number((buckets.get(p) || 0).toFixed(2)));
  const testCount = Math.max(2, Math.floor(series.length * 0.2));
  const trainCount = series.length - testCount;
  const trainSeries = series.slice(0, trainCount);
  const testSeries = series.slice(trainCount);

  // Holt's Linear Trend Exponential Smoothing
  const alpha = 0.45;
  const beta = 0.25;
  let level = trainSeries[0];
  let trend = trainSeries.length > 1 ? trainSeries[1] - trainSeries[0] : 0;

  const fitted: number[] = [level];
  for (let i = 1; i < trainSeries.length; i++) {
    const prevLevel = level;
    level = alpha * trainSeries[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    fitted.push(Number((prevLevel + trend).toFixed(2)));
  }

  const testPreds: number[] = [];
  for (let h = 1; h <= testCount; h++) {
    testPreds.push(Number((level + h * trend).toFixed(2)));
  }

  const residuals = testSeries.map((act, idx) => act - testPreds[idx]);
  const rmse = Number(Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / testCount).toFixed(2));
  const mae = Number((residuals.reduce((s, r) => s + Math.abs(r), 0) / testCount).toFixed(2));
  const mapeVals = testSeries
    .map((act, idx) => (act !== 0 ? Math.abs((act - testPreds[idx]) / act) : null))
    .filter((v): v is number => v !== null);
  const mape = mapeVals.length > 0 ? `${((mapeVals.reduce((a, b) => a + b, 0) / mapeVals.length) * 100).toFixed(1)}%` : 'N/A';

  // Refit on full series for future horizon forecast
  let fullLevel = series[0];
  let fullTrend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    const prev = fullLevel;
    fullLevel = alpha * series[i] + (1 - alpha) * (fullLevel + fullTrend);
    fullTrend = beta * (fullLevel - prev) + (1 - beta) * fullTrend;
  }

  const actualVsPredicted: PredictiveModelResult['actualVsPredicted'] = periods.map((p, idx) => ({
    index: p,
    actual: series[idx],
    predicted: idx < trainCount ? fitted[idx] : testPreds[idx - trainCount],
  }));

  const [lastYear, lastMonth] = periods[periods.length - 1].split('-').map(Number);
  for (let h = 1; h <= horizon; h++) {
    const d = new Date(Date.UTC(lastYear, lastMonth - 1 + h, 1));
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')} (Proj.)`;
    const pred = Number((fullLevel + h * fullTrend).toFixed(2));
    const band = Number((1.28 * rmse * Math.sqrt(h)).toFixed(2));
    actualVsPredicted.push({
      index: label,
      actual: null,
      predicted: pred,
      lower: Number((pred - band).toFixed(2)),
      upper: Number((pred + band).toFixed(2)),
    });
  }

  return {
    id: `model_${Date.now()}`,
    taskType: 'timeseries_forecast',
    modelName: "Holt's Linear Trend Exponential Smoothing",
    targetColumn: targetCol,
    dateColumn: dateCol,
    featureColumns: [dateCol],
    trainCount,
    testCount,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Holdout RMSE', value: rmse.toLocaleString(), description: 'Forecast error over the final holdout window.' },
      { label: 'Holdout MAE', value: mae.toLocaleString(), description: 'Average absolute period deviation on test window.' },
      { label: 'Holdout MAPE', value: mape, description: 'Mean Absolute Percentage Error on test periods.' },
    ],
    actualVsPredicted,
    predictionsTable: actualVsPredicted.slice(-horizon - testCount).map((pt, idx) => ({
      rowNumber: idx + 1,
      actual: pt.actual !== null ? pt.actual : 'Future Horizon',
      predicted: pt.predicted,
      errorOrMatch:
        pt.actual !== null
          ? `${pt.actual - pt.predicted >= 0 ? '+' : ''}${(pt.actual - pt.predicted).toFixed(2)}`
          : `[${pt.lower ?? pt.predicted} .. ${pt.upper ?? pt.predicted}]`,
      inputsSummary: `${dateCol}: ${pt.index}`,
    })),
    trainSamplePreview: periods.slice(0, Math.min(8, trainCount)).map((p, idx) => ({
      Period: p,
      [targetCol]: series[idx],
      Fitted: fitted[idx],
    })),
    testSamplePreview: periods.slice(trainCount).map((p, idx) => ({
      Period: p,
      [targetCol]: testSeries[idx],
      Predicted: testPreds[idx],
    })),
    limitations: [
      'Forecasts project historical level and linear trend forward; sudden market shifts or external shocks are not modeled.',
      'Confidence bands widen proportionally with horizon step (√h), reflecting growing future uncertainty.',
      'Results are statistical projections for planning scenarios, not guaranteed future outcomes.',
    ],
  };
}

export function runClustering(
  dataset: Dataset,
  featureCols: string[],
  k = 3,
  includeAnomalyFeatures = false
): PredictiveModelResult {
  const t0 = performance.now();
  if (featureCols.length < 2) {
    throw new Error('Select at least 2 numeric columns for K-Means clustering.');
  }

  const { rows: workingRows, effectiveFeatures } = enrichDatasetWithAnomalyFeatures(
    dataset,
    featureCols,
    includeAnomalyFeatures
  );

  const points: number[][] = [];
  const origRowNums: number[] = [];
  workingRows.forEach((row, rIdx) => {
    const vec: number[] = [];
    let valid = true;
    for (const f of effectiveFeatures) {
      const v = parseNumericValue(row[f]);
      if (v === null) {
        valid = false;
        break;
      }
      vec.push(v);
    }
    if (valid) {
      points.push(vec);
      origRowNums.push(rIdx + 1);
    }
  });

  if (points.length < k * 3) {
    throw new Error(`Need at least ${k * 3} complete numeric rows for ${k} clusters.`);
  }

  const dims = effectiveFeatures.length;
  const means = Array.from({ length: dims }, (_, j) => points.reduce((s, p) => s + p[j], 0) / points.length);
  const stds = Array.from({ length: dims }, (_, j) => {
    const v = points.reduce((s, p) => s + Math.pow(p[j] - means[j], 2), 0) / points.length;
    return Math.sqrt(v) || 1;
  });

  const zPoints = points.map((p) => p.map((val, j) => (val - means[j]) / stds[j]));

  const step = Math.max(1, Math.floor(zPoints.length / k));
  let centroids = Array.from({ length: k }, (_, idx) => [...zPoints[Math.min(idx * step, zPoints.length - 1)]]);
  const assignments = new Array<number>(zPoints.length).fill(0);

  const distSq = (a: number[], b: number[]) => a.reduce((s, v, j) => s + Math.pow(v - b[j], 2), 0);

  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < zPoints.length; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = distSq(zPoints[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }

    const nextCentroids = Array.from({ length: k }, () => Array(dims).fill(0));
    const counts = Array(k).fill(0);
    for (let i = 0; i < zPoints.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let j = 0; j < dims; j++) nextCentroids[c][j] += zPoints[i][j];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let j = 0; j < dims; j++) nextCentroids[c][j] /= counts[c];
      } else {
        nextCentroids[c] = [...centroids[c]];
      }
    }
    centroids = nextCentroids;
    if (!changed) break;
  }

  let inertia = 0;
  for (let i = 0; i < zPoints.length; i++) {
    inertia += distSq(zPoints[i], centroids[assignments[i]]);
  }

  const clusters = Array.from({ length: k }, (_, c) => {
    const memberIndices = assignments.map((a, idx) => (a === c ? idx : -1)).filter((idx) => idx >= 0);
    const centroidObj: Record<string, number> = {};
    effectiveFeatures.forEach((f, j) => {
      const avg =
        memberIndices.length > 0
          ? memberIndices.reduce((s, idx) => s + points[idx][j], 0) / memberIndices.length
          : means[j];
      centroidObj[f] = Number(avg.toFixed(2));
    });
    return {
      clusterId: `Cluster ${c + 1}`,
      size: memberIndices.length,
      centroid: centroidObj,
    };
  });

  const clusterScatter = points.slice(0, 300).map((p, idx) => ({
    x: p[0],
    y: p[1],
    cluster: `Cluster ${assignments[idx] + 1}`,
  }));

  return {
    id: `model_${Date.now()}`,
    taskType: 'clustering',
    modelName: `K-Means Clustering (k = ${k})`,
    featureColumns: effectiveFeatures,
    trainCount: points.length,
    testCount: 0,
    trainingTimeMs: Math.max(1, Math.round(performance.now() - t0)),
    metrics: [
      { label: 'Clusters (k)', value: String(k), description: 'Number of unsupervised segments discovered.' },
      { label: 'Records Clustered', value: points.length.toLocaleString(), description: 'Complete numeric records assigned to segments.' },
      { label: 'Within-Cluster Inertia', value: inertia.toFixed(1), description: 'Sum of squared z-score distances to centroids (lower is tighter).' },
    ],
    clusters,
    clusterScatter,
    predictionsTable: points.slice(0, 40).map((p, idx) => ({
      rowNumber: origRowNums[idx],
      actual: 'Unsupervised',
      predicted: `Cluster ${assignments[idx] + 1}`,
      errorOrMatch: `d=${Math.sqrt(distSq(zPoints[idx], centroids[assignments[idx]])).toFixed(2)}σ`,
      inputsSummary: buildInputsSummary(effectiveFeatures, p),
    })),
    trainSamplePreview: points.slice(0, 8).map((p, idx) => {
      const obj: Record<string, string | number | boolean | null> = { Row: `#${origRowNums[idx]}` };
      effectiveFeatures.slice(0, 5).forEach((f, fIdx) => {
        obj[f] = p[fIdx];
      });
      return obj;
    }),
    usedAnomalyFeatures: includeAnomalyFeatures,
    limitations: [
      'K-Means assumes spherical, similarly sized clusters in z-score standardized space.',
      'Segment boundaries depend on the chosen value of k and selected features.',
      'Outliers can pull cluster centroids outward; inspect Data Cleaning Studio or Anomaly Detection if clusters appear skewed.',
    ],
  };
}
