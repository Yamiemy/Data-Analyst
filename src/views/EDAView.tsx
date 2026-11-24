import React, { useMemo } from 'react';
import { ArrowRight, ScanSearch } from 'lucide-react';
import { ChartRenderer } from '../components/ChartRenderer';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { MetricTooltip } from '../components/MetricTooltip';
import { computeMissingHeatmap, generateAutomatedEDA } from '../engine/dataAnalyzer';
import type { AnomalyDetectionResult, Dataset, NavSectionId } from '../types/data';

interface EDAViewProps {
  dataset: Dataset | null;
  anomalyResult?: AnomalyDetectionResult | null;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
}

export const EDAView: React.FC<EDAViewProps> = ({ dataset, anomalyResult, onNavigate, onLoadSample }) => {
  const eda = useMemo(() => (dataset ? generateAutomatedEDA(dataset) : null), [dataset]);
  const missingHeatmap = useMemo(() => (dataset ? computeMissingHeatmap(dataset, 10) : null), [dataset]);

  if (!dataset || !eda) {
    return (
      <EmptyDatasetState
        title="Exploratory Data Analysis"
        description="Upload a dataset to automatically generate descriptive statistics, quartiles, missing-value diagnostics, distributions, correlations, and outlier reports."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const missingChartData = dataset.profile.columns.map((c) => ({
    column: c.name,
    Missing_Pct: c.missingPct,
    Missing_Count: c.missingCount,
  }));

  const numericNames = eda.numericColumns.map((c) => c.name);
  const corrLookup = new Map<string, number>();
  eda.correlations.forEach((p) => {
    corrLookup.set(`${p.colA}|${p.colB}`, p.r);
    corrLookup.set(`${p.colB}|${p.colA}`, p.r);
  });

  return (
    <div className="space-y-6">
      {/* Automated Explanations */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Automated EDA Highlights — {dataset.name}
        </h3>
        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300 list-disc pl-5">
          {eda.automatedExplanations.map((exp, i) => (
            <li key={i}>{exp}</li>
          ))}
        </ul>
      </section>

      {/* Descriptive Statistics Table */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Numeric Descriptive Statistics
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Mean, median, quartiles (Q1/Q3), standard deviation, variance, and range computed across all non-null records
          </p>
        </div>
        {eda.numericColumns.length === 0 ? (
          <div className="p-5 text-xs text-slate-500 dark:text-slate-400">No numeric columns detected in this dataset.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-200">Column</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Count</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Missing</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Mean</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Median</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">
                    <span className="inline-flex items-center gap-1">
                      Std Dev
                      <MetricTooltip
                        label="Standard Deviation"
                        explanation="Measures typical spread around the mean in the original column units."
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">
                    <span className="inline-flex items-center gap-1">
                      Variance
                      <MetricTooltip
                        label="Variance"
                        explanation="Average squared deviation from the mean (Std Dev²). Higher variance indicates wider dispersion."
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Min</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Q1</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Q3</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">Max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {eda.numericColumns.map((col) => (
                  <tr key={col.name} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{col.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {col.nonNullCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {col.missingCount}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {col.mean?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {col.median?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.stdDev?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.variance?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.min?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.q1?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.q3?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                      {col.max?.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Distribution Histograms */}
      {eda.histograms.length > 0 && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {eda.histograms.map((hist) => (
            <ChartRenderer
              key={hist.column}
              height={240}
              chart={{
                id: `eda_hist_${hist.column}`,
                type: 'histogram',
                title: `Distribution: ${hist.column}`,
                description: `Frequency histogram across ${dataset.profile.rowCount.toLocaleString()} records.`,
                xKey: 'range',
                yKeys: ['count'],
                xLabel: hist.column,
                yLabel: 'Frequency',
                data: hist.bins,
              }}
            />
          ))}
        </section>
      )}

      {/* Missing-Value Heatmap Across Row Slices */}
      {missingHeatmap && missingHeatmap.buckets.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Missing-Value Heatmap (Row Slices × Columns)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Spot concentrated gaps or missing data patterns across record ranges (0% = complete, darker amber/red = higher missingness)
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500/20 border border-emerald-400/50" /> 0% missing
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-xs bg-amber-500/45 border border-amber-500/60" /> Partial
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-xs bg-red-600/60 border border-red-600/70" /> Heavy (&gt;35%)
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-[11px]">
              <thead>
                <tr>
                  <th className="p-1.5 text-left font-medium text-slate-500">Row Slice</th>
                  {missingHeatmap.columns.map((col) => (
                    <th key={col} className="p-1.5 font-medium text-slate-600 dark:text-slate-300 max-w-[90px] truncate" title={col}>
                      {col.slice(0, 12)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {missingHeatmap.buckets.map((bucket) => (
                  <tr key={bucket.label}>
                    <td className="p-1.5 text-left font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {bucket.label}
                    </td>
                    {bucket.values.map((pct, cIdx) => {
                      const bg =
                        pct === 0
                          ? 'rgba(16, 185, 129, 0.14)'
                          : pct < 35
                            ? `rgba(245, 158, 11, ${Math.max(0.22, pct / 60)})`
                            : `rgba(220, 38, 38, ${Math.min(0.75, pct / 100 + 0.2)})`;
                      return (
                        <td
                          key={missingHeatmap.columns[cIdx]}
                          style={{ backgroundColor: bg }}
                          title={`${bucket.label} · ${missingHeatmap.columns[cIdx]}: ${pct}% missing`}
                          className="border border-slate-100 p-1.5 font-mono tabular-nums text-slate-800 dark:border-slate-800 dark:text-slate-100"
                        >
                          {pct === 0 ? '0%' : `${pct}%`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Missing Value Analysis + Correlation Matrix */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartRenderer
          height={260}
          chart={{
            id: 'eda_missing_chart',
            type: 'horizontal_bar',
            title: 'Missing Value Percentage by Column',
            description: `Total missing cells: ${dataset.profile.missingCells.toLocaleString()} (${dataset.profile.missingPct}%)`,
            xKey: 'column',
            yKeys: ['Missing_Pct'],
            xLabel: 'Missing %',
            yLabel: 'Column',
            data: missingChartData,
          }}
        />

        {/* Correlation Matrix Heatmap */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Pearson Correlation Matrix
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Linear association strength (-1.0 inverse to +1.0 direct)
          </p>

          {numericNames.length < 2 ? (
            <p className="mt-4 text-xs text-slate-500">At least 2 numeric columns are needed for correlation analysis.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-center text-[11px]">
                <thead>
                  <tr>
                    <th className="p-1.5 text-left font-medium text-slate-500" />
                    {numericNames.slice(0, 7).map((name) => (
                      <th key={name} className="p-1.5 font-medium text-slate-600 dark:text-slate-300 truncate max-w-[70px]">
                        {name.slice(0, 10)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {numericNames.slice(0, 7).map((rowCol) => (
                    <tr key={rowCol}>
                      <td className="p-1.5 text-left font-medium text-slate-700 dark:text-slate-300 truncate max-w-[90px]">
                        {rowCol.slice(0, 12)}
                      </td>
                      {numericNames.slice(0, 7).map((colCol) => {
                        const r = rowCol === colCol ? 1 : corrLookup.get(`${rowCol}|${colCol}`) ?? 0;
                        const intensity = Math.min(1, Math.abs(r));
                        const bg =
                          rowCol === colCol
                            ? 'rgba(79, 70, 229, 0.25)'
                            : r >= 0
                              ? `rgba(37, 99, 235, ${intensity * 0.45})`
                              : `rgba(220, 38, 38, ${intensity * 0.45})`;
                        return (
                          <td
                            key={colCol}
                            style={{ backgroundColor: bg }}
                            className="border border-slate-100 p-2 font-mono tabular-nums text-slate-900 dark:border-slate-800 dark:text-slate-100"
                          >
                            {r.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Category Frequency & Outlier Analysis */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Category Frequency Breakdown
          </h3>
          {eda.categoricalColumns.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No categorical columns detected.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {eda.categoricalColumns.slice(0, 4).map((cat) => (
                <div key={cat.name} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span>{cat.name}</span>
                    <span className="font-normal text-slate-500 tabular-nums">{cat.uniqueCount} unique</span>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {(cat.topValues || []).slice(0, 4).map((tv) => (
                      <div key={tv.value} className="flex items-center gap-2 text-xs">
                        <span className="w-32 truncate text-slate-600 dark:text-slate-300">{tv.value}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full bg-indigo-500" style={{ width: `${tv.pct}%` }} />
                        </div>
                        <span className="w-16 text-right font-mono text-[11px] tabular-nums text-slate-500">
                          {tv.count} ({tv.pct}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Statistical Outlier Detection (1.5x IQR)
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('anomaly')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-indigo-400"
            >
              <ScanSearch className="h-3.5 w-3.5" />
              Open Anomaly Detection Studio
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          {anomalyResult && (
            <div className="mt-3 rounded-lg border border-indigo-200/70 bg-indigo-50/50 px-3 py-2 text-xs text-slate-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-slate-300">
              <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                Anomaly Studio ({anomalyResult.algorithmLabel}):
              </span>{' '}
              <span className="font-mono tabular-nums">
                {anomalyResult.totalAnomalies.toLocaleString()}
              </span>{' '}
              anomalies flagged ({anomalyResult.anomalyPct}% · {anomalyResult.highCount} high severity).
            </div>
          )}
          {eda.outliersSummary.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No numeric columns available for outlier inspection.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {eda.outliersSummary.map((item) => (
                <div
                  key={item.column}
                  className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-900 dark:text-slate-100">
                    <span>{item.column}</span>
                    <span
                      className={`font-mono tabular-nums ${
                        item.outlierCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {item.outlierCount} outlier(s)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{item.explanation}</p>
                  {item.sampleOutliers.length > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                      Examples: {item.sampleOutliers.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
