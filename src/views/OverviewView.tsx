import React, { useMemo } from 'react';
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Code2,
  Database,
  FileText,
  MessageSquareText,
  Sparkles,
  Terminal,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import { DatasetUploader } from '../components/DatasetUploader';
import { MetricTooltip } from '../components/MetricTooltip';
import { useThemeCustomization } from '../context/ThemeContext';
import type { AnalysisHistoryEntry, Dataset, NavSectionId } from '../types/data';

interface OverviewViewProps {
  datasets: Dataset[];
  activeDataset: Dataset | null;
  history: AnalysisHistoryEntry[];
  reportsCount: number;
  onSelectDataset: (id: string) => void;
  onDatasetLoaded: (ds: Dataset) => void;
  onNavigate: (section: NavSectionId) => void;
  onStartNewAnalysis: () => void;
  onAskQuestionDirect: (q: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  datasets,
  activeDataset,
  history,
  reportsCount,
  onSelectDataset,
  onDatasetLoaded,
  onNavigate,
  onStartNewAnalysis,
  onAskQuestionDirect,
}) => {
  const { accentHex, chartColors } = useThemeCustomization();

  const totalRecords = useMemo(
    () => datasets.reduce((sum, d) => sum + d.profile.rowCount, 0),
    [datasets]
  );

  const avgQuality = useMemo(() => {
    if (datasets.length === 0) return null;
    const sum = datasets.reduce((acc, d) => acc + d.profile.qualityScore, 0);
    return Number((sum / datasets.length).toFixed(1));
  }, [datasets]);

  const datasetChartData = useMemo(
    () =>
      datasets.map((d) => ({
        name: d.name.replace(/\.(csv|xlsx|xls|json)$/i, '').slice(0, 16),
        Rows: d.profile.rowCount,
        OriginalQuality: d.originalProfile.qualityScore,
        CurrentQuality: d.profile.qualityScore,
      })),
    [datasets]
  );

  const activityByModule = useMemo(() => {
    const counts = new Map<string, number>();
    const order = ['chat', 'eda', 'cleaning', 'visualization', 'predictive', 'sql', 'python', 'insights', 'report'];
    order.forEach((m) => counts.set(m, 0));
    history.forEach((h) => counts.set(h.module, (counts.get(h.module) || 0) + 1));
    return order.map((m) => ({
      module: m.charAt(0).toUpperCase() + m.slice(1),
      analyses: counts.get(m) || 0,
    }));
  }, [history]);

  const recommendedActions = useMemo(() => {
    if (!activeDataset) return [];
    const actions: Array<{ title: string; detail: string; cta: string; action: () => void }> = [];
    if (activeDataset.profile.missingCells > 0 || activeDataset.profile.duplicateRowCount > 0) {
      actions.push({
        title: 'Resolve data quality issues',
        detail: `${activeDataset.profile.missingCells} missing cells and ${activeDataset.profile.duplicateRowCount} duplicate rows detected.`,
        cta: 'Open Cleaning Studio',
        action: () => onNavigate('cleaning'),
      });
    }
    const numCol = activeDataset.profile.columns.find((c) => c.type === 'number');
    const catCol = activeDataset.profile.columns.find((c) => c.type === 'string');
    if (numCol && catCol) {
      actions.push({
        title: `Analyze ${numCol.name} by ${catCol.name}`,
        detail: `Ask AI Data Chat to compute top segments and trends across ${activeDataset.profile.rowCount.toLocaleString()} rows.`,
        cta: 'Ask AI Chat',
        action: () => onAskQuestionDirect(`Which ${catCol.name} drives the highest ${numCol.name}?`),
      });
    }
    actions.push({
      title: 'Run automated exploratory profiling',
      detail: 'Inspect distributions, quartiles, correlations, and statistical outliers.',
      cta: 'Explore EDA',
      action: () => onNavigate('eda'),
    });
    return actions.slice(0, 3);
  }, [activeDataset, onNavigate, onAskQuestionDirect]);

  const quickTools: Array<{ id: NavSectionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'chat', label: 'AI Data Chat', desc: 'Natural-language Q&A', icon: MessageSquareText },
    { id: 'cleaning', label: 'Data Cleaning', desc: 'Fix nulls & duplicates', icon: Wand2 },
    { id: 'eda', label: 'Automated EDA', desc: 'Stats & correlations', icon: BarChart3 },
    { id: 'predictive', label: 'Predictive ML', desc: 'Forecast & cluster', icon: BrainCircuit },
    { id: 'sql', label: 'SQL Assistant', desc: 'Read-only SQL engine', icon: Terminal },
    { id: 'python', label: 'Python Studio', desc: 'Pandas & scikit-learn', icon: Code2 },
  ];

  const primaryChartColor = chartColors[0] || accentHex;
  const secondaryChartColor = chartColors[1] || '#2563EB';
  const tertiaryChartColor = chartColors[4] || '#10B981';

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <section className="flex flex-col justify-between gap-6 rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-indigo-50/50 p-6 sm:flex-row sm:items-center dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/30">
        <div className="max-w-2xl">
          <p className="text-xs font-medium" style={{ color: accentHex }}>
            DataMind AI Workspace
          </p>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white [text-wrap:balance]">
            Your data has stories. Let&apos;s discover them.
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Upload spreadsheets or connect Google Sheets, audit data quality, query in plain English, and export executive reports backed by deterministic math.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onStartNewAnalysis}
            style={{ backgroundColor: accentHex }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-4 w-4" />
            Start New Analysis
          </button>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Datasets</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {datasets.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">
            {activeDataset ? `Active: ${activeDataset.name}` : 'No dataset loaded'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Records Analyzed</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {totalRecords.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {activeDataset ? `${activeDataset.profile.columnCount} active columns` : 'Across all datasets'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Analyses</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {history.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Logged across workspace tools
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Data Quality Score</span>
            <MetricTooltip
              label="Data Quality Score"
              explanation="Weighted deterministic score (0–100) combining completeness (missing cells), uniqueness (duplicate rows), and format consistency."
            />
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {avgQuality !== null ? `${avgQuality}/100` : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {avgQuality !== null
              ? avgQuality >= 90
                ? 'Nominal completeness'
                : 'Cleaning recommended'
              : 'Upload data to score'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Exported Reports</div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
            {reportsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {history[0] ? `Last activity: ${history[0].module}` : 'No exports yet'}
          </div>
        </div>
      </section>

      {/* If no dataset uploaded yet, show immediate uploader */}
      {datasets.length === 0 ? (
        <section className="space-y-3">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
            Connect Your First Dataset
          </h3>
          <DatasetUploader onDatasetLoaded={onDatasetLoaded} />
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Dataset Usage / Volume Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Dataset Usage &amp; Volume
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Row counts across loaded datasets
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('datasets')}
                className="text-xs font-medium hover:underline"
                style={{ color: accentHex }}
              >
                Manage
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={datasetChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
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
                <Bar dataKey="Rows" fill={primaryChartColor} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Analysis Activity Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Analysis Activity
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Operations logged by module
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('history')}
                className="text-xs font-medium hover:underline"
                style={{ color: accentHex }}
              >
                History
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={activityByModule} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <defs>
                  <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={secondaryChartColor} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={secondaryChartColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="module" tick={{ fontSize: 10, fill: '#64748B' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="analyses" stroke={secondaryChartColor} strokeWidth={2} fill="url(#actGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Data Quality Trends Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Data Quality Trends
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Original vs. current quality scores
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('cleaning')}
                className="text-xs font-medium hover:underline"
                style={{ color: accentHex }}
              >
                Clean
              </button>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={datasetChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line
                  type="monotone"
                  dataKey="OriginalQuality"
                  name="Original"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  strokeWidth={1.8}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="CurrentQuality"
                  name="Current"
                  stroke={tertiaryChartColor}
                  strokeWidth={2.2}
                  dot={{ r: 3.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Frequently Used Tools */}
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Analytical Workspace Tools
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onNavigate(tool.id)}
                className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-indigo-950/60 dark:group-hover:text-indigo-400 transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {tool.label}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{tool.desc}</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 group-hover:text-indigo-600 transition-transform" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Bottom Grid: Recent Datasets + Recommended AI Actions + Recent Analyses */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Datasets */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Datasets
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('datasets')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400"
            >
              View all
            </button>
          </div>
          {datasets.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No datasets uploaded yet. Upload a file above to get started.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {datasets.slice(0, 4).map((ds) => (
                <button
                  key={ds.id}
                  type="button"
                  onClick={() => {
                    onSelectDataset(ds.id);
                    onNavigate('datasets');
                  }}
                  className="flex w-full items-center justify-between py-2.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-lg px-2 transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      <Database className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span className="truncate">{ds.name}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                      {ds.profile.rowCount.toLocaleString()} rows · {ds.profile.columnCount} cols · Quality {ds.profile.qualityScore}/100
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Recommended AI Actions */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recommended Actions
            </h3>
            <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          {recommendedActions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Recommendations appear automatically after profiling your dataset.
            </p>
          ) : (
            <div className="space-y-3">
              {recommendedActions.map((act, idx) => (
                <div key={idx} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{act.title}</div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{act.detail}</p>
                  <button
                    type="button"
                    onClick={act.action}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    {act.cta}
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Analyses & Reports */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Analyses & Reports
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400"
            >
              Create report
            </button>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ask a question in AI Data Chat, run EDA, or train a model to log analysis history.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.slice(0, 4).map((item) => (
                <div key={item.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-900 dark:text-slate-100">
                    <span className="truncate flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      {item.title}
                    </span>
                    <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.module} · {item.datasetName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
