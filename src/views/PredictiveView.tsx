import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { AlertCircle, BrainCircuit, CheckCircle2, Play, ShieldAlert } from 'lucide-react';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { MetricTooltip } from '../components/MetricTooltip';
import { AnalysisSkeleton } from '../components/Skeleton';
import { useThemeCustomization } from '../context/ThemeContext';
import {
  runClassification,
  runClustering,
  runDecisionTree,
  runLinearRegression,
  runLogisticRegression,
  runRandomForest,
  runTimeSeriesForecast,
} from '../engine/mlEngine';
import type { Dataset, NavSectionId, PredictiveModelResult, PredictiveTaskType } from '../types/data';

const CLUSTER_COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9'];

const CLASSIFICATION_TASKS: PredictiveTaskType[] = ['logistic_regression', 'decision_tree', 'random_forest', 'classification'];

interface PredictiveViewProps {
  dataset: Dataset | null;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

export const PredictiveView: React.FC<PredictiveViewProps> = ({
  dataset,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex, chartColors } = useThemeCustomization();
  const [taskType, setTaskType] = useState<PredictiveTaskType>('linear_regression');
  const [targetCol, setTargetCol] = useState<string>('');
  const [dateCol, setDateCol] = useState<string>('');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [trainSplit, setTrainSplit] = useState<number>(0.8);
  const [forecastHorizon, setForecastHorizon] = useState<number>(6);
  const [kClusters, setKClusters] = useState<number>(3);
  const [includeAnomalyFeatures, setIncludeAnomalyFeatures] = useState<boolean>(false);
  const [samplePreviewTab, setSamplePreviewTab] = useState<'test' | 'train'>('test');
  const [training, setTraining] = useState<boolean>(false);
  const [result, setResult] = useState<PredictiveModelResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setTargetCol('');
    setDateCol('');
    setSelectedFeatures([]);
  }, [dataset?.id, dataset?.rows.length]);

  const numCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name) : []),
    [dataset]
  );
  const catCols = useMemo(
    () =>
      dataset
        ? dataset.profile.columns
            .filter((c) => (c.type === 'string' || c.type === 'boolean') && c.uniqueCount >= 2 && c.uniqueCount <= 12)
            .map((c) => c.name)
        : [],
    [dataset]
  );
  const dateCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'date').map((c) => c.name) : []),
    [dataset]
  );

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Predictive Analytics"
        description="Upload a dataset to train validated linear regression, logistic regression, decision tree, random forest, time-series forecasting, and K-Means clustering models."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const isClassificationTask = CLASSIFICATION_TASKS.includes(taskType);

  const effectiveTarget = isClassificationTask
    ? catCols.includes(targetCol)
      ? targetCol
      : catCols[0] || dataset.columns[0]
    : numCols.includes(targetCol)
      ? targetCol
      : numCols[0] || dataset.columns[0];

  const effectiveDate = dateCols.includes(dateCol) ? dateCol : dateCols[0] || '';

  const candidateFeatures =
    taskType === 'clustering'
      ? numCols
      : isClassificationTask
        ? dataset.columns.filter((c) => c !== effectiveTarget)
        : numCols.filter((c) => c !== effectiveTarget);

  const activeFeatures =
    selectedFeatures.filter((f) => candidateFeatures.includes(f)).length > 0
      ? selectedFeatures.filter((f) => candidateFeatures.includes(f))
      : candidateFeatures.slice(0, Math.min(3, candidateFeatures.length));

  const toggleFeature = (feat: string) => {
    setSelectedFeatures((prev) => {
      const base = prev.filter((f) => candidateFeatures.includes(f));
      const curr = base.length > 0 ? base : activeFeatures;
      if (curr.includes(feat)) {
        return curr.length > 1 ? curr.filter((x) => x !== feat) : curr;
      }
      return [...curr, feat];
    });
  };

  const preflightValidation = useMemo(() => {
    if (!dataset) return { ok: false, reason: 'No active dataset loaded.' };
    if (taskType === 'timeseries_forecast') {
      if (dateCols.length === 0 || !effectiveDate) {
        return { ok: false, reason: 'Time-series forecasting requires a recognized date column in your dataset.' };
      }
      if (numCols.length === 0) {
        return { ok: false, reason: 'At least one numeric metric column is required as the forecast target.' };
      }
      return { ok: true, reason: `Ready: forecasting "${effectiveTarget}" chronologically over "${effectiveDate}".` };
    }
    if (taskType === 'clustering') {
      if (numCols.length < 2) {
        return { ok: false, reason: 'K-Means clustering requires at least 2 numeric columns.' };
      }
      if (dataset.rows.length < kClusters * 3) {
        return { ok: false, reason: `Need at least ${kClusters * 3} rows to fit ${kClusters} clusters.` };
      }
      return { ok: true, reason: `Ready: segmenting ${dataset.rows.length.toLocaleString()} records into ${kClusters} clusters.` };
    }
    if (isClassificationTask) {
      if (catCols.length === 0) {
        return { ok: false, reason: 'Classification requires a categorical target column with 2 to 12 distinct classes.' };
      }
      if (activeFeatures.length === 0) {
        return { ok: false, reason: 'Select at least one predictor feature column.' };
      }
      return { ok: true, reason: `Ready: classifying "${effectiveTarget}" using ${activeFeatures.length} predictor(s).` };
    }
    if (numCols.length < 2) {
      return { ok: false, reason: 'Linear regression requires at least 2 numeric columns (1 target + ≥1 numeric feature).' };
    }
    if (activeFeatures.length === 0) {
      return { ok: false, reason: 'Select at least one numeric predictor feature.' };
    }
    return { ok: true, reason: `Ready: predicting numeric target "${effectiveTarget}" from ${activeFeatures.length} feature(s).` };
  }, [dataset, taskType, dateCols.length, effectiveDate, numCols.length, effectiveTarget, kClusters, isClassificationTask, catCols.length, activeFeatures.length]);

  const handleTrain = () => {
    if (!preflightValidation.ok) {
      setError(preflightValidation.reason);
      return;
    }
    setError(null);
    setTraining(true);
    setTimeout(() => {
      try {
        let modelRes: PredictiveModelResult;
        if (taskType === 'linear_regression') {
          modelRes = runLinearRegression(dataset, effectiveTarget, activeFeatures, trainSplit, includeAnomalyFeatures);
        } else if (taskType === 'logistic_regression') {
          modelRes = runLogisticRegression(dataset, effectiveTarget, activeFeatures, trainSplit, includeAnomalyFeatures);
        } else if (taskType === 'decision_tree') {
          modelRes = runDecisionTree(dataset, effectiveTarget, activeFeatures, trainSplit, includeAnomalyFeatures);
        } else if (taskType === 'random_forest') {
          modelRes = runRandomForest(dataset, effectiveTarget, activeFeatures, trainSplit, includeAnomalyFeatures);
        } else if (taskType === 'classification') {
          modelRes = runClassification(dataset, effectiveTarget, activeFeatures, trainSplit, includeAnomalyFeatures);
        } else if (taskType === 'timeseries_forecast') {
          if (!effectiveDate) throw new Error('A date column is required for time-series forecasting.');
          modelRes = runTimeSeriesForecast(dataset, effectiveDate, effectiveTarget, forecastHorizon);
        } else {
          modelRes = runClustering(dataset, activeFeatures, kClusters, includeAnomalyFeatures);
        }
        setResult(modelRes);
        onRecordHistory(
          `${modelRes.modelName}`,
          `Evaluated on ${dataset.name} (${modelRes.metrics.map((m) => `${m.label}: ${m.value}`).join(', ')})`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Model training failed.');
      } finally {
        setTraining(false);
      }
    }, 30);
  };

  const maxImportance =
    result?.featureImportances && result.featureImportances.length > 0
      ? Math.max(...result.featureImportances.map((f) => Math.abs(f.weight)), 0.001)
      : 1;

  return (
    <div className="space-y-6">
      {/* Model Configuration */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4" style={{ color: accentHex }} />
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Predictive Modeling Workbench
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Deterministic train/test validation — outputs real holdout metrics, feature drivers, and uncertainty bounds
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {training ? (
                'Status: Training & validating…'
              ) : result ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Trained in {result.trainingTimeMs ?? 1} ms
                </span>
              ) : (
                'Status: Ready to train'
              )}
            </span>

            <button
              type="button"
              onClick={handleTrain}
              disabled={training || !preflightValidation.ok}
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {training ? 'Training...' : 'Train & Evaluate Model'}
            </button>
          </div>
        </div>

        {/* Pre-Training Validation Banner */}
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs ${
            preflightValidation.ok
              ? 'border-emerald-200/80 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
          }`}
        >
          {preflightValidation.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{preflightValidation.reason}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Algorithm / Task</label>
            <select
              value={taskType}
              onChange={(e) => {
                setTaskType(e.target.value as PredictiveTaskType);
                setResult(null);
                setError(null);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="linear_regression">Linear Regression (Numeric Target)</option>
              <option value="logistic_regression">Logistic Regression (Classification)</option>
              <option value="decision_tree">Decision Tree (CART Classification)</option>
              <option value="random_forest">Random Forest Ensemble (Classification)</option>
              <option value="timeseries_forecast">Time-Series Forecasting (Holt Linear)</option>
              <option value="clustering">K-Means Clustering (Segmentation)</option>
            </select>
          </div>

          {taskType !== 'clustering' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Target Column</label>
              <select
                value={effectiveTarget}
                onChange={(e) => setTargetCol(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {(isClassificationTask ? catCols : numCols).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {taskType === 'timeseries_forecast' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Date Column</label>
              <select
                value={effectiveDate}
                onChange={(e) => setDateCol(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {dateCols.length === 0 ? (
                  <option value="">No date columns detected</option>
                ) : (
                  dateCols.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {(taskType === 'linear_regression' || isClassificationTask) && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Train / Test Split ({Math.round(trainSplit * 100)}% / {Math.round((1 - trainSplit) * 100)}%)
              </label>
              <select
                value={trainSplit}
                onChange={(e) => setTrainSplit(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value={0.7}>70% Train / 30% Test</option>
                <option value={0.8}>80% Train / 20% Test</option>
                <option value={0.85}>85% Train / 15% Test</option>
              </select>
            </div>
          )}

          {taskType === 'timeseries_forecast' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Forecast Horizon (Periods)</label>
              <input
                type="number"
                min={2}
                max={12}
                value={forecastHorizon}
                onChange={(e) => setForecastHorizon(Math.max(2, Math.min(12, Number(e.target.value))))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          )}

          {taskType === 'clustering' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Clusters (k)</label>
              <input
                type="number"
                min={2}
                max={6}
                value={kClusters}
                onChange={(e) => setKClusters(Math.max(2, Math.min(6, Number(e.target.value))))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          )}
        </div>

        {taskType !== 'timeseries_forecast' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Input Features ({activeFeatures.length} selected)
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAnomalyFeatures}
                  onChange={(e) => setIncludeAnomalyFeatures(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Include Anomaly Features (Anomaly_Score, Is_Anomaly)</span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {candidateFeatures.map((feat) => {
                const selected = activeFeatures.includes(feat);
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => toggleFeature(feat)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400'
                    }`}
                  >
                    {feat}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {training && <AnalysisSkeleton label="Fitting model on training split and computing holdout evaluation metrics..." />}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!training && result && (
        <div className="space-y-6">
          {/* Model Header & Metrics */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {result.modelName}
                </h3>
                <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  Train rows: {result.trainCount.toLocaleString()}
                  {result.testCount > 0 ? ` · Test rows: ${result.testCount.toLocaleString()}` : ''} · Features:{' '}
                  {result.featureColumns.join(', ')}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {result.metrics.map((m) => (
                <div key={m.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>{m.label}</span>
                    <MetricTooltip label={m.label} explanation={m.description} />
                  </div>
                  <div className="mt-1 font-display text-xl font-bold text-slate-900 tabular-nums dark:text-white">
                    {m.value}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{m.description}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Actual vs Predicted Chart */}
          {result.actualVsPredicted && result.actualVsPredicted.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {result.taskType === 'timeseries_forecast'
                  ? `Historical vs Forecast Trajectory (${result.targetColumn})`
                  : `Actual vs Predicted (${result.targetColumn})`}
              </h4>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                Comparison of observed holdout values against model predictions
              </p>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={result.actualVsPredicted} margin={{ top: 10, right: 20, left: 10, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="index" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="#0F172A" strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="predicted" name="Predicted" stroke={chartColors[0] || accentHex} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2.5 }} />
                  {result.taskType === 'timeseries_forecast' && (
                    <>
                      <Line type="monotone" dataKey="upper" name="Upper Bound" stroke="#94A3B8" strokeWidth={1} dot={false} />
                      <Line type="monotone" dataKey="lower" name="Lower Bound" stroke="#94A3B8" strokeWidth={1} dot={false} />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Feature Importance / Standardized Weights */}
          {result.featureImportances && result.featureImportances.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Feature Importance &amp; Drivers
              </h4>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Relative magnitude of each input feature in driving predictions
              </p>
              <div className="mt-4 space-y-2.5">
                {result.featureImportances.map((fi) => {
                  const pct = Math.max(4, Math.round((Math.abs(fi.weight) / maxImportance) * 100));
                  return (
                    <div key={fi.feature} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 dark:text-slate-200">{fi.feature}</span>
                        <span className={`font-mono tabular-nums ${fi.weight >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {result.taskType === 'linear_regression' && fi.weight >= 0 ? `+${fi.weight}` : fi.weight}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: fi.weight >= 0 ? accentHex : '#D97706',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Confusion Matrix */}
          {result.confusionMatrix && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Holdout Confusion Matrix (Actual rows × Predicted columns)
              </h4>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full max-w-lg border-collapse text-center text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="p-2 text-left text-slate-500">Actual \ Pred</th>
                      {result.confusionMatrix.labels.map((lbl) => (
                        <th key={lbl} className="p-2 font-semibold text-slate-700 dark:text-slate-200">
                          {lbl}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.confusionMatrix.matrix.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="p-2 text-left font-semibold text-slate-700 dark:text-slate-200">
                          {result.confusionMatrix!.labels[rIdx]}
                        </td>
                        {row.map((val, cIdx) => (
                          <td
                            key={cIdx}
                            className={`p-2 font-mono tabular-nums ${
                              rIdx === cIdx
                                ? 'bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                                : 'text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Clustering Results */}
          {result.clusters && result.clusterScatter && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Cluster Scatter ({result.featureColumns[0]} vs {result.featureColumns[1]})
                </h4>
                <ResponsiveContainer width="100%" height={280}>
                  <ScatterChart margin={{ top: 16, right: 20, left: 10, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis type="number" dataKey="x" name={result.featureColumns[0]} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis type="number" dataKey="y" name={result.featureColumns[1]} tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {result.clusters.map((cl, idx) => (
                      <Scatter
                        key={cl.clusterId}
                        name={cl.clusterId}
                        data={result.clusterScatter!.filter((p) => p.cluster === cl.clusterId)}
                        fill={CLUSTER_COLORS[idx % CLUSTER_COLORS.length]}
                      />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Segment Centroids
                </h4>
                <div className="mt-3 space-y-3">
                  {result.clusters.map((cl) => (
                    <div key={cl.clusterId} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
                        <span>{cl.clusterId}</span>
                        <span className="font-mono tabular-nums text-slate-500">{cl.size} records</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                        {Object.entries(cl.centroid).map(([k, v]) => (
                          <span key={k}>
                            {k}: {v.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Holdout Predictions Table */}
          {result.predictionsTable && result.predictionsTable.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Prediction Comparison Table ({result.predictionsTable.length} holdout rows)
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Actual observed target values vs. model predictions and residual error / classification outcome
                </p>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                    <tr>
                      <th className="px-4 py-2 font-semibold text-slate-700 dark:text-slate-200">Row</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Actual</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Predicted</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Error / Match</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Input Snapshot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.predictionsTable.map((pr, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-mono tabular-nums text-slate-500">#{pr.rowNumber}</td>
                        <td className="px-3 py-2 font-mono tabular-nums text-slate-900 dark:text-slate-100">{String(pr.actual ?? '—')}</td>
                        <td className="px-3 py-2 font-mono tabular-nums font-semibold" style={{ color: accentHex }}>{String(pr.predicted)}</td>
                        <td
                          className={`px-3 py-2 font-mono tabular-nums ${
                            pr.errorOrMatch === 'Match'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : pr.errorOrMatch === 'Mismatch'
                                ? 'text-red-500'
                                : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {pr.errorOrMatch}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-md">
                          {pr.inputsSummary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Train / Test Sample Data Preview */}
          {(result.trainSamplePreview?.length || result.testSamplePreview?.length) && (
            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3 dark:border-slate-800">
                <div>
                  <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Training &amp; Test Split Data Sample
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Inspect exact partitioned sample records fed into model fitting and holdout evaluation
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                  {result.testSamplePreview && result.testSamplePreview.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSamplePreviewTab('test')}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        samplePreviewTab === 'test'
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      Test Split ({result.testCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSamplePreviewTab('train')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      samplePreviewTab === 'train' || !result.testSamplePreview?.length
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Train Split ({result.trainCount})
                  </button>
                </div>
              </div>
              {(() => {
                const activePreview =
                  samplePreviewTab === 'test' && result.testSamplePreview?.length
                    ? result.testSamplePreview
                    : result.trainSamplePreview || [];
                const cols = activePreview.length > 0 ? Object.keys(activePreview[0]) : [];
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <tr>
                          {cols.map((c) => (
                            <th key={c} className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {activePreview.map((r, i) => (
                          <tr key={i}>
                            {cols.map((c) => (
                              <td key={c} className="px-3 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                {String(r[c] ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </section>
          )}

          {/* Model Limitations */}
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Model Assumptions &amp; Limitations
            </h4>
            <ul className="mt-1.5 space-y-1 text-xs text-amber-900/90 dark:text-amber-200/90 list-disc pl-5">
              {result.limitations.map((lim, i) => (
                <li key={i}>{lim}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
};
