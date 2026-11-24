import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Lightbulb,
  Loader2,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { CardGridSkeleton } from '../components/Skeleton';
import { useThemeCustomization } from '../context/ThemeContext';
import { generateAutomatedEDA } from '../engine/dataAnalyzer';
import { requestBIInsights } from '../services/aiService';
import type { AnomalyDetectionResult, BIInsightItem, BIInsightsResponse, Dataset, NavSectionId } from '../types/data';

interface InsightsViewProps {
  dataset: Dataset | null;
  insights: BIInsightsResponse | null;
  anomalyResult?: AnomalyDetectionResult | null;
  onSaveInsights: (res: BIInsightsResponse) => void;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

const CATEGORY_META: Record<
  BIInsightItem['category'],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  positive_trend: { label: 'Positive Trend', icon: TrendingUp, color: 'text-emerald-600 dark:text-emerald-400' },
  negative_trend: { label: 'Negative Trend', icon: TrendingDown, color: 'text-red-600 dark:text-red-400' },
  anomaly: { label: 'Anomaly', icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400' },
  opportunity: { label: 'Opportunity', icon: Lightbulb, color: 'text-indigo-600 dark:text-indigo-400' },
  risk: { label: 'Risk Indicator', icon: ShieldAlert, color: 'text-rose-600 dark:text-rose-400' },
};

export const InsightsView: React.FC<InsightsViewProps> = ({
  dataset,
  insights,
  anomalyResult,
  onSaveInsights,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex } = useThemeCustomization();
  const [filterImportance, setFilterImportance] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eda = useMemo(() => (dataset ? generateAutomatedEDA(dataset) : null), [dataset]);

  if (!dataset || !eda) {
    return (
      <EmptyDatasetState
        title="Business Intelligence & AI Insights"
        description="Upload a dataset to surface executive KPIs, positive/negative trends, anomalies, opportunities, and risk indicators."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      const edaSummary = {
        explanations: eda.automatedExplanations,
        numericSummary: eda.numericColumns.map((c) => ({
          name: c.name,
          mean: c.mean,
          median: c.median,
          min: c.min,
          max: c.max,
          sum: c.sum,
          outliers: c.outlierCount,
        })),
        topCorrelations: eda.correlations.slice(0, 5),
        categoricalLeaders: eda.categoricalColumns.slice(0, 4).map((c) => ({
          name: c.name,
          topValues: c.topValues?.slice(0, 4),
        })),
        anomalySummary: anomalyResult
          ? {
              algorithm: anomalyResult.algorithmLabel,
              totalAnomalies: anomalyResult.totalAnomalies,
              anomalyPct: anomalyResult.anomalyPct,
              severityBreakdown: {
                high: anomalyResult.highCount,
                medium: anomalyResult.mediumCount,
                low: anomalyResult.lowCount,
              },
              columnBreakdown: anomalyResult.columnBreakdown.slice(0, 5),
            }
          : null,
      };
      const res = await requestBIInsights(dataset, edaSummary);
      onSaveInsights(res);
      onRecordHistory(`BI Insights: ${dataset.name}`, res.executiveSummary.slice(0, 120));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate BI insights.');
    } finally {
      setLoading(false);
    }
  };

  const filteredInsights = (insights?.insights || []).filter(
    (item) => filterImportance === 'all' || item.importance === filterImportance
  );

  // Deterministic KPIs from actual dataset
  const primaryNumeric = eda.numericColumns[0];
  const secondaryNumeric = eda.numericColumns[1];

  return (
    <div className="space-y-6">
      {/* Header & Trigger */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Business Intelligence &amp; Strategic Insights
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Every executive finding is anchored to verified metrics calculated across {dataset.profile.rowCount.toLocaleString()} records.
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          style={{ backgroundColor: accentHex }}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0 transition-opacity"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {insights ? 'Refresh AI Insights' : 'Generate AI Insights'}
        </button>
      </section>

      {/* Verified KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">Records Evaluated</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {dataset.profile.rowCount.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500">{dataset.profile.columnCount} fields</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs text-slate-500 dark:text-slate-400">Data Integrity Score</div>
          <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {dataset.profile.qualityScore}/100
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {dataset.profile.missingPct}% missing · {dataset.profile.duplicateRowCount} duplicates
          </div>
        </div>

        {primaryNumeric && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total {primaryNumeric.name}</div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums" style={{ color: accentHex }}>
              {primaryNumeric.sum?.toLocaleString() ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              Avg {primaryNumeric.mean?.toLocaleString()} · Median {primaryNumeric.median?.toLocaleString()}
            </div>
          </div>
        )}

        {secondaryNumeric && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Average {secondaryNumeric.name}</div>
            <div className="mt-1 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {secondaryNumeric.mean?.toLocaleString() ?? '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              Range {secondaryNumeric.min?.toLocaleString()} — {secondaryNumeric.max?.toLocaleString()}
            </div>
          </div>
        )}
      </section>

      {anomalyResult && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <ScanSearch className="h-4 w-4 shrink-0" style={{ color: accentHex }} />
            <span>
              <strong className="text-slate-900 dark:text-white">Anomaly Studio ({anomalyResult.algorithmLabel}):</strong>{' '}
              <span className="font-mono tabular-nums">{anomalyResult.totalAnomalies.toLocaleString()}</span> anomalies (
              {anomalyResult.anomalyPct}% · {anomalyResult.highCount} high severity) — factored into insight synthesis.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('anomaly')}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Inspect Anomalies <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </section>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Synthesizing deterministic statistics and executive findings…
          </div>
          <CardGridSkeleton count={4} />
        </div>
      ) : insights ? (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Executive Brief
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {insights.executiveSummary}
            </p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['all', 'high', 'medium', 'low'] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setFilterImportance(lvl)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    filterImportance === lvl
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  {lvl === 'all' ? 'All Priorities' : `${lvl.charAt(0).toUpperCase() + lvl.slice(1)} Priority`}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500 tabular-nums">
              Showing {filteredInsights.length} insight(s)
            </span>
          </div>

          {(() => {
            const factualFindings = filteredInsights.filter(
              (item) =>
                item.category === 'positive_trend' ||
                item.category === 'negative_trend' ||
                item.category === 'anomaly'
            );
            const strategicSignals = filteredInsights.filter(
              (item) => item.category === 'opportunity' || item.category === 'risk'
            );

            const renderInsightCard = (item: BIInsightItem, idx: number, kindLabel: string) => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.opportunity;
              const Icon = meta.icon;
              return (
                <div
                  key={`${kindLabel}-${idx}`}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.color}`}>
                        <Icon className="h-4 w-4" />
                        {meta.label}
                      </span>
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        {kindLabel} · {item.importance.toUpperCase()}
                      </span>
                    </div>
                    <h5 className="mt-2 font-display text-sm font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </h5>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {item.summary}
                    </p>
                  </div>

                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="font-mono text-[11px]" style={{ color: accentHex }}>
                      Verified Metric: {item.supportingMetric}
                    </div>
                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold">Actionable Recommendation: </span>
                      {item.recommendation}
                    </div>
                  </div>
                </div>
              );
            };

            return (
              <div className="space-y-6">
                {factualFindings.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Verified Factual Findings ({factualFindings.length})
                      </h4>
                      <span className="text-[11px] text-slate-400">Observed trends &amp; measured anomalies</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {factualFindings.map((item, idx) => renderInsightCard(item, idx, 'Verified Fact'))}
                    </div>
                  </div>
                )}

                {strategicSignals.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Strategic Opportunities &amp; Risk Signals ({strategicSignals.length})
                      </h4>
                      <span className="text-[11px] text-slate-400">Forward-looking signals &amp; actions</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {strategicSignals.map((item, idx) => renderInsightCard(item, idx, 'Strategic Signal'))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Click &ldquo;Generate AI Insights&rdquo; above to synthesize strategic trends, anomalies, and recommendations from {dataset.name}.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Deterministic statistical foundations are already computed and ready.
          </p>
        </section>
      )}
    </div>
  );
};
