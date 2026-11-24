import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileSpreadsheet, FileText, Loader2, Palette, Printer, ScanSearch } from 'lucide-react';
import { ChartRenderer } from '../components/ChartRenderer';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { ACCENT_PRESETS, useThemeCustomization } from '../context/ThemeContext';
import { executePlanDeterministically, generateAutomatedEDA } from '../engine/dataAnalyzer';
import { exportDatasetAsCSV, exportDatasetAsExcel, exportReportAsPDF } from '../engine/reportExporter';
import type { AnomalyDetectionResult, AnomalyReviewState, BIInsightsResponse, Dataset, NavSectionId } from '../types/data';

interface ReportsViewProps {
  dataset: Dataset | null;
  insights: BIInsightsResponse | null;
  anomalyResult?: AnomalyDetectionResult | null;
  anomalyReviews?: Record<number, AnomalyReviewState>;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordReportExport: (format: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  dataset,
  insights,
  anomalyResult,
  anomalyReviews = {},
  onNavigate,
  onLoadSample,
  onRecordReportExport,
}) => {
  const { accentHex, setAccentHex } = useThemeCustomization();
  const eda = useMemo(() => (dataset ? generateAutomatedEDA(dataset) : null), [dataset]);

  const defaultExecSummary = useMemo(() => {
    if (!dataset) return '';
    if (insights?.executiveSummary) return insights.executiveSummary;
    return `This analytical report evaluates "${dataset.name}" comprising ${dataset.profile.rowCount.toLocaleString()} records across ${dataset.profile.columnCount} fields. Overall data quality scores ${dataset.profile.qualityScore}/100 with ${dataset.profile.missingPct}% missing cell density and ${dataset.profile.duplicateRowCount} duplicate records.`;
  }, [dataset, insights]);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const anomalyChartContainerRef = useRef<HTMLDivElement>(null);
  const [execSummary, setExecSummary] = useState('');
  const [conclusion, setConclusion] = useState(
    'Decisions grounded in this analysis should prioritize high-completeness segments, address identified data quality anomalies before operational automation, and validate predictive projections against fresh incoming records.'
  );
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    setExecSummary('');
    setExportError(null);
  }, [dataset?.id]);

  const keyChart = useMemo(() => {
    if (!dataset) return null;
    const cat = dataset.profile.columns.find((c) => c.type === 'string')?.name;
    const num = dataset.profile.columns.find((c) => c.type === 'number')?.name;
    if (!cat || !num) return null;
    return executePlanDeterministically(dataset, {
      operations: [{ type: 'aggregate', groupBy: cat, metric: num, agg: 'sum', limit: 8 }],
      chartSpec: { type: 'bar', title: `Total ${num} by ${cat}` },
    }).chart || null;
  }, [dataset]);

  const anomalyChartSpec = useMemo(() => {
    if (!anomalyResult || anomalyResult.columnBreakdown.length === 0) return null;
    return {
      id: `anom_rep_chart_${anomalyResult.id}`,
      type: 'bar' as const,
      title: `Anomaly Driver Breakdown (${anomalyResult.algorithmLabel})`,
      description: `${anomalyResult.totalAnomalies} flagged records (${anomalyResult.anomalyPct}%) across evaluated features`,
      xKey: 'column',
      yKeys: ['anomalyCount'],
      xLabel: 'Feature',
      yLabel: 'Flagged Count',
      data: anomalyResult.columnBreakdown.map((c) => ({
        column: c.column,
        anomalyCount: c.anomalyCount,
      })),
    };
  }, [anomalyResult]);

  if (!dataset || !eda) {
    return (
      <EmptyDatasetState
        title="Executive Report Generator"
        description="Upload a dataset to compile a print-ready, exportable PDF, Excel, or CSV report with EDA findings and recommendations."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const activeExecSummary = execSummary || defaultExecSummary;

  const handlePDF = async () => {
    setExportError(null);
    setExportingPdf(true);
    try {
      const chartSvg =
        (chartContainerRef.current?.querySelector('.recharts-wrapper svg') as SVGSVGElement | null) ||
        (chartContainerRef.current?.querySelector('svg') as SVGSVGElement | null) ||
        null;
      const anomalyChartSvg =
        (anomalyChartContainerRef.current?.querySelector('.recharts-wrapper svg') as SVGSVGElement | null) ||
        (anomalyChartContainerRef.current?.querySelector('svg') as SVGSVGElement | null) ||
        null;
      await exportReportAsPDF({
        dataset,
        eda,
        insights,
        anomalyResult,
        anomalyReviews,
        executiveSummary: activeExecSummary,
        conclusion,
        accentHex,
        chartSvg,
        anomalyChartSvg,
      });
      onRecordReportExport('PDF');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleCSV = () => {
    exportDatasetAsCSV(dataset, '_report_data');
    onRecordReportExport('CSV');
  };

  const handleExcel = () => {
    exportDatasetAsExcel(dataset, '_report_workbook');
    onRecordReportExport('Excel');
  };

  const handlePrint = () => {
    onRecordReportExport('Print');
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Export Toolbar */}
      <section className="no-print space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Export &amp; Distribution Controls
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize executive narrative and accent color below, or export directly to PDF, Excel, CSV, or Print
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePDF}
              disabled={exportingPdf}
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {exportingPdf ? 'Compiling PDF…' : 'Export PDF Report'}
            </button>
            <button
              type="button"
              onClick={handleExcel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleCSV}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <FileText className="h-3.5 w-3.5" />
              CSV Data
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Report
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Palette className="h-3.5 w-3.5" />
            <span>PDF &amp; Report Accent:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => {
              const selected = accentHex.toUpperCase() === preset.hex.toUpperCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setAccentHex(preset.hex)}
                  title={preset.name}
                  aria-label={`Set report accent to ${preset.name}`}
                  style={{ backgroundColor: preset.hex }}
                  className={`h-5 w-5 rounded-full transition-transform ${
                    selected ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900 scale-110' : 'hover:scale-105'
                  }`}
                />
              );
            })}
            <label className="ml-1 inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer">
              <span>Custom:</span>
              <input
                type="color"
                value={accentHex}
                onChange={(e) => setAccentHex(e.target.value)}
                aria-label="Custom report accent hex color"
                className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
              />
            </label>
          </div>
        </div>
      </section>

      {exportError && (
        <div className="no-print flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* Printable Report Document */}
      <article className="print-report mx-auto max-w-4xl space-y-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
        {/* Report Title Block */}
        <header className="border-b border-slate-200 pb-6 dark:border-slate-800">
          <div className="text-xs font-semibold" style={{ color: accentHex }}>
            DataMind AI Analytical Report
          </div>
          <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white">
            {dataset.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 tabular-nums dark:text-slate-400">
            <span>Generated {new Date().toLocaleDateString()}</span>
            <span aria-hidden="true">·</span>
            <span>{dataset.profile.rowCount.toLocaleString()} Records</span>
            <span aria-hidden="true">·</span>
            <span>{dataset.profile.columnCount} Columns</span>
            <span aria-hidden="true">·</span>
            <span>Quality Score {dataset.profile.qualityScore}/100</span>
          </div>
        </header>

        {/* 1. Executive Summary */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            1. Executive Summary
          </h2>
          <textarea
            value={activeExecSummary}
            onChange={(e) => setExecSummary(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          />
        </section>

        {/* 2. Dataset Description & Data Quality Assessment */}
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            2. Dataset Description &amp; Data Quality Assessment
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-[11px] text-slate-500">Completeness</div>
              <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {dataset.profile.completenessScore}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-[11px] text-slate-500">Uniqueness</div>
              <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {dataset.profile.uniquenessScore}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-[11px] text-slate-500">Consistency</div>
              <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {dataset.profile.consistencyScore}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
              <div className="text-[11px] text-slate-500">Duplicates</div>
              <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {dataset.profile.duplicateRowCount}
              </div>
            </div>
          </div>
        </section>

        {/* 3. Exploratory Analysis & Important Findings */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            3. Exploratory Analysis &amp; Important Findings
          </h2>
          <ul className="space-y-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300 list-disc pl-5">
            {eda.automatedExplanations.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>

        {/* 4. Key Visualization */}
        {keyChart && (
          <section className="space-y-3">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              4. Key Visualizations
            </h2>
            <div ref={chartContainerRef}>
              <ChartRenderer chart={keyChart} height={260} />
            </div>
          </section>
        )}

        {/* Anomaly Detection Summary */}
        <section className="space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {keyChart ? '5.' : '4.'} Anomaly Detection &amp; Investigation Summary
          </h2>
          {anomalyResult ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">Detection Configuration: </span>
                {anomalyResult.algorithmLabel} · {anomalyResult.detectedParametersSummary}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500">Algorithm</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-900 dark:text-white">
                    {anomalyResult.algorithmLabel}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500">Total Flagged</div>
                  <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {anomalyResult.totalAnomalies.toLocaleString()} ({anomalyResult.anomalyPct}%)
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500">High Severity</div>
                  <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
                    {anomalyResult.highCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500">Medium Severity</div>
                  <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {anomalyResult.mediumCount}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-[11px] text-slate-500">Low Severity</div>
                  <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-sky-500">
                    {anomalyResult.lowCount}
                  </div>
                </div>
              </div>

              {anomalyChartSpec && (
                <div ref={anomalyChartContainerRef}>
                  <ChartRenderer chart={anomalyChartSpec} height={220} />
                </div>
              )}

              {anomalyResult.records.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                      <tr>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Record</th>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Actual vs. Expected</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">Score</th>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Severity</th>
                        <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Review &amp; Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {anomalyResult.records.slice(0, 8).map((rec) => {
                        const rev = anomalyReviews[rec.rowIndex];
                        return (
                          <tr key={rec.rowIndex}>
                            <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {rec.recordId}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                              <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                                {rec.actualValuesSummary}
                              </div>
                              <div className="text-[11px]">Expected: {rec.expectedValuesSummary}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums" style={{ color: accentHex }}>
                              {rec.score.toFixed(1)}
                            </td>
                            <td className="px-3 py-2 font-semibold uppercase text-slate-700 dark:text-slate-300">
                              {rec.severity}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400">
                              <span className="font-semibold uppercase text-slate-800 dark:text-slate-200">
                                {rev?.status || 'unreviewed'}
                              </span>
                              {rev?.note ? ` — ${rev.note}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {(anomalyResult.limitations.length > 0 || anomalyResult.falsePositiveWarnings.length > 0) && (
                <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
                  <div className="font-semibold">Methodological Limitations &amp; Recommendations</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[11px]">
                    <li>
                      Relative 0–100 anomaly intensity scores reflect statistical deviation distance and are not calibrated fraud or error probabilities.
                    </li>
                    {anomalyResult.falsePositiveWarnings.map((w, i) => (
                      <li key={`rw_${i}`}>{w}</li>
                    ))}
                    {anomalyResult.limitations.map((l, i) => (
                      <li key={`rl_${i}`}>{l}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <span>Run Anomaly Detection Studio to embed statistical/multivariate anomaly charts, investigation findings, and PDF tables here.</span>
              <button
                type="button"
                onClick={() => onNavigate('anomaly')}
                className="no-print inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <ScanSearch className="h-3.5 w-3.5" /> Open Studio
              </button>
            </div>
          )}
        </section>

        {/* Business Insights & Recommendations */}
        <section className="space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {keyChart ? '6.' : '5.'} Business Insights &amp; Recommendations
          </h2>
          {insights && insights.insights.length > 0 ? (
            <div className="space-y-2.5">
              {insights.insights.slice(0, 5).map((item, idx) => (
                <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    {item.title} <span className="font-normal text-indigo-600 dark:text-indigo-400">({item.supportingMetric})</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.summary}</p>
                  <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200">
                    Action: {item.recommendation}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tip: Visit BI Insights and click &ldquo;Generate AI Insights&rdquo; to embed synthesized business recommendations into this report automatically.
            </p>
          )}
        </section>

        {/* Conclusion */}
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {keyChart ? '7.' : '6.'} Conclusion
          </h2>
          <textarea
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-800 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          />
        </section>
      </article>
    </div>
  );
};
