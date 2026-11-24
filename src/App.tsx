import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Code2,
  Database,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  Lightbulb,
  Menu,
  MessageSquareText,
  Moon,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ScanSearch,
  Search,
  Settings,
  Sun,
  Terminal,
  Wand2,
  X,
} from 'lucide-react';
import { useDatasetContext } from './context/DatasetContext';
import { ACCENT_PRESETS, CHART_PALETTE_PRESETS, useThemeCustomization } from './context/ThemeContext';
import { AIChatView } from './views/AIChatView';
import { AnomalyDetectionView } from './views/AnomalyDetectionView';
import { CleaningStudioView } from './views/CleaningStudioView';
import { DatasetsView } from './views/DatasetsView';
import { EDAView } from './views/EDAView';
import { HistoryView } from './views/HistoryView';
import { InsightsView } from './views/InsightsView';
import { OverviewView } from './views/OverviewView';
import { PredictiveView } from './views/PredictiveView';
import { PythonAssistantView } from './views/PythonAssistantView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { SQLAssistantView } from './views/SQLAssistantView';
import { VisualizationsView } from './views/VisualizationsView';
import type { NavSectionId } from './types/data';

const AVATAR_URL = '/src/assets/images/avatar_analyst_user_1795325605341.jpg';

const NAV_ITEMS: Array<{
  id: NavSectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'AI Data Chat', icon: MessageSquareText },
  { id: 'datasets', label: 'My Datasets', icon: Database },
  { id: 'cleaning', label: 'Data Cleaning', icon: Wand2 },
  { id: 'eda', label: 'Exploratory Data Analysis', icon: BarChart3 },
  { id: 'anomaly', label: 'Anomaly Detection', icon: ScanSearch },
  { id: 'visualizations', label: 'Visualizations', icon: BarChart3 },
  { id: 'predictive', label: 'Predictive Analytics', icon: BrainCircuit },
  { id: 'sql', label: 'SQL Assistant', icon: Terminal },
  { id: 'python', label: 'Python Assistant', icon: Code2 },
  { id: 'insights', label: 'BI Insights', icon: Lightbulb },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'history', label: 'Analysis History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const { accentHex, setAccentHex, chartPaletteId, setChartPaletteId, resetColors } = useThemeCustomization();
  const {
    theme,
    setTheme,
    workspaceName,
    setWorkspaceName,
    activeNav,
    setActiveNav,
    datasets,
    activeDataset,
    selectDataset,
    loadDataset,
    loadSampleDataset,
    deleteDataset,
    applyCleaning,
    undoCleaning,
    resetDataset,
    chatByDataset,
    addChatMessage,
    clearChatHistory,
    insightsByDataset,
    saveInsights,
    anomalyResultByDataset,
    saveAnomalyResult,
    anomalyReviewsByDataset,
    updateAnomalyReview,
    history,
    recordHistory,
    clearHistory,
    reportsCount,
    incrementReportsCount,
    notifications,
    pushNotification,
    markNotificationsRead,
    clearNotifications,
  } = useDatasetContext();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [pendingChatQuestion, setPendingChatQuestion] = useState<string | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);

  const handleStartNewAnalysis = () => {
    if (activeDataset) {
      setActiveNav('chat');
    } else {
      setActiveNav('datasets');
    }
  };

  const handleAskQuestionDirect = (q: string) => {
    setPendingChatQuestion(q);
    setActiveNav('chat');
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Global search results across columns & datasets
  const searchResults = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    const results: Array<{ label: string; sub: string; action: () => void }> = [];
    datasets.forEach((ds) => {
      if (ds.name.toLowerCase().includes(q)) {
        results.push({
          label: ds.name,
          sub: `Dataset · ${ds.profile.rowCount} rows`,
          action: () => {
            selectDataset(ds.id);
            setActiveNav('datasets');
            setGlobalSearch('');
          },
        });
      }
    });
    if (activeDataset) {
      activeDataset.profile.columns.forEach((col) => {
        if (col.name.toLowerCase().includes(q)) {
          results.push({
            label: col.name,
            sub: `Column (${col.type}) in ${activeDataset.name}`,
            action: () => {
              setActiveNav('eda');
              setGlobalSearch('');
            },
          });
        }
      });
    }
    return results.slice(0, 6);
  }, [globalSearch, datasets, activeDataset, selectDataset, setActiveNav]);

  const activeAnomalyResult = activeDataset ? anomalyResultByDataset[activeDataset.id] || null : null;

  // Right contextual panel deterministic observations
  const rightObservations = useMemo(() => {
    if (!activeDataset) return [];
    const obs: string[] = [];
    obs.push(
      `Data quality scores ${activeDataset.profile.qualityScore}/100 with ${activeDataset.profile.missingCells} missing cells and ${activeDataset.profile.duplicateRowCount} duplicate rows.`
    );
    const numCol = activeDataset.profile.columns.find((c) => c.type === 'number');
    if (numCol) {
      obs.push(
        `"${numCol.name}" ranges from ${numCol.min?.toLocaleString()} to ${numCol.max?.toLocaleString()} (mean ${numCol.mean?.toLocaleString()}).`
      );
    }
    const catCol = activeDataset.profile.columns.find((c) => c.type === 'string' && c.topValues?.length);
    if (catCol && catCol.topValues?.[0]) {
      obs.push(
        `Top "${catCol.name}" segment is "${catCol.topValues[0].value}" (${catCol.topValues[0].pct}% share).`
      );
    }
    if (activeAnomalyResult) {
      obs.push(
        `Anomaly Studio (${activeAnomalyResult.algorithmLabel}): ${activeAnomalyResult.totalAnomalies} flagged (${activeAnomalyResult.highCount} high severity).`
      );
    }
    return obs;
  }, [activeDataset, activeAnomalyResult]);

  const rightFollowUps = useMemo(() => {
    if (!activeDataset) return [];
    const numCol = activeDataset.profile.columns.find((c) => c.type === 'number')?.name;
    const catCol = activeDataset.profile.columns.find((c) => c.type === 'string')?.name;
    const list = ['Summarize the key findings and top 5 business recommendations.'];
    if (catCol && numCol) list.push(`Which ${catCol} contributes the highest ${numCol}?`);
    if (numCol) list.push(`Scan the dataset for statistical and multivariate anomalies`);
    return list;
  }, [activeDataset]);

  const currentNavTitle = NAV_ITEMS.find((n) => n.id === activeNav)?.label || 'Overview';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* LEFT SIDEBAR */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-200 lg:static dark:border-slate-800 dark:bg-slate-900 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Logo + Collapse */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 18V8l6 4 5-6 5 5v7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="10" cy="12" r="1.4" fill="currentColor" />
                <circle cx="15" cy="6" r="1.4" fill="currentColor" />
              </svg>
            </div>
            {!sidebarCollapsed && (
              <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
                DataMind AI
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:inline-flex dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-slate-400 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New Analysis CTA */}
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              handleStartNewAnalysis();
              setMobileMenuOpen(false);
            }}
            style={{ backgroundColor: accentHex }}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity ${
              sidebarCollapsed ? 'px-2' : 'px-3.5'
            }`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="whitespace-nowrap">New Analysis</span>}
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveNav(item.id);
                  setMobileMenuOpen(false);
                }}
                title={sidebarCollapsed ? item.label : undefined}
                style={active ? { color: accentHex, backgroundColor: `rgba(var(--dm-accent-rgb), 0.1)` } : undefined}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                  active
                    ? 'font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom Controls */}
        <div className="border-t border-slate-200 p-2.5 space-y-1 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {theme === 'light' ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
            {!sidebarCollapsed && <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <HelpCircle className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>Help &amp; Documentation</span>}
          </button>

          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
            {!avatarFailed ? (
              <img
                src={AVATAR_URL}
                alt="Lead Data Analyst profile"
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="h-7 w-7 shrink-0 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-semibold text-white">
                DA
              </div>
            )}
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900 dark:text-white">Analyst Account</div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">Workspace Admin</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN SHELL */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* TOP NAVIGATION BAR */}
        <header className="no-print flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="hidden sm:inline truncate max-w-[180px]">{workspaceName}</span>
                <span className="hidden sm:inline" aria-hidden="true">/</span>
                <span className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {currentNavTitle}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Dataset Selector */}
            <select
              aria-label="Active dataset selector"
              value={activeDataset?.id || ''}
              onChange={(e) => {
                if (e.target.value) selectDataset(e.target.value);
              }}
              className="max-w-[180px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
            >
              {datasets.length === 0 ? (
                <option value="">No datasets loaded</option>
              ) : (
                datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name}
                  </option>
                ))
              )}
            </select>

            {/* Search Input */}
            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search columns or datasets..."
                className="w-48 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {searchResults.length > 0 && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {searchResults.map((res, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={res.action}
                      className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="text-xs font-medium text-slate-900 dark:text-white">{res.label}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{res.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Colour Customization Quick Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setColorMenuOpen((o) => !o);
                  setNotifOpen(false);
                }}
                title="Customize workspace & chart colors"
                aria-label="Customize workspace and chart colors"
                className="inline-flex items-center gap-1.5 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <Palette className="h-4 w-4" style={{ color: accentHex }} />
              </button>

              {colorMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3.5 shadow-lg dark:border-slate-700 dark:bg-slate-900 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xs font-semibold text-slate-900 dark:text-white">
                      Colour Customization
                    </span>
                    <button
                      type="button"
                      onClick={resetColors}
                      className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      Reset
                    </button>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Workspace Accent
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
                            aria-label={`Set accent ${preset.name}`}
                            style={{ backgroundColor: preset.hex }}
                            className={`h-5 w-5 rounded-full transition-transform ${
                              selected ? 'ring-2 ring-slate-900 ring-offset-1 dark:ring-white scale-110' : 'hover:scale-105'
                            }`}
                          />
                        );
                      })}
                      <input
                        type="color"
                        value={accentHex}
                        onChange={(e) => setAccentHex(e.target.value)}
                        aria-label="Custom accent hex color"
                        className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Chart Palette
                    </div>
                    <select
                      aria-label="Quick chart palette selector"
                      value={chartPaletteId}
                      onChange={(e) => setChartPaletteId(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                      {CHART_PALETTE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      {chartPaletteId === 'custom' && <option value="custom">Custom Palette</option>}
                    </select>
                  </div>

                  <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveNav('settings');
                        setColorMenuOpen(false);
                      }}
                      style={{ color: accentHex }}
                      className="text-[11px] font-medium hover:underline"
                    >
                      Open full colour studio in Settings →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((o) => !o);
                  setColorMenuOpen(false);
                  markNotificationsRead();
                }}
                aria-label="Notifications"
                className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span style={{ backgroundColor: accentHex }} className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" />
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-display text-xs font-semibold text-slate-900 dark:text-white">
                      Notifications
                    </span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        onClick={clearNotifications}
                        className="text-[11px] text-indigo-600 dark:text-indigo-400"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-500">No new notifications.</p>
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {notifications.map((n) => (
                        <div key={n.id} className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-950">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{n.title}</div>
                          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{n.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Toggle Right Contextual Panel */}
            <button
              type="button"
              onClick={() => setRightPanelOpen((o) => !o)}
              title={rightPanelOpen ? 'Collapse insights panel' : 'Expand insights panel'}
              aria-label={rightPanelOpen ? 'Collapse insights panel' : 'Expand insights panel'}
              className="hidden xl:inline-flex rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {rightPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* WORKSPACE BODY + RIGHT PANEL */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <div key={activeNav} className="transition-opacity duration-150">
              {activeNav === 'overview' && (
              <OverviewView
                datasets={datasets}
                activeDataset={activeDataset}
                history={history}
                reportsCount={reportsCount}
                onSelectDataset={selectDataset}
                onDatasetLoaded={loadDataset}
                onNavigate={setActiveNav}
                onStartNewAnalysis={handleStartNewAnalysis}
                onAskQuestionDirect={handleAskQuestionDirect}
              />
            )}

            {activeNav === 'chat' && (
              <AIChatView
                dataset={activeDataset}
                messages={activeDataset ? chatByDataset[activeDataset.id] || [] : []}
                pendingQuestion={pendingChatQuestion}
                onClearPendingQuestion={() => setPendingChatQuestion(null)}
                onAddMessage={(msg) => {
                  if (!activeDataset) return;
                  addChatMessage(activeDataset.id, msg);
                }}
                onClearHistory={() => {
                  if (!activeDataset) return;
                  clearChatHistory(activeDataset.id);
                }}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('chat', title, summary)}
              />
            )}

            {activeNav === 'datasets' && (
              <DatasetsView
                datasets={datasets}
                activeDataset={activeDataset}
                onSelectDataset={selectDataset}
                onDatasetLoaded={loadDataset}
                onDeleteDataset={deleteDataset}
              />
            )}

            {activeNav === 'cleaning' && (
              <CleaningStudioView
                dataset={activeDataset}
                onApplyCleaning={applyCleaning}
                onUndoCleaning={undoCleaning}
                onResetDataset={resetDataset}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
              />
            )}

            {activeNav === 'eda' && (
              <EDAView
                dataset={activeDataset}
                anomalyResult={activeAnomalyResult}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
              />
            )}

            {activeNav === 'anomaly' && (
              <AnomalyDetectionView
                dataset={activeDataset}
                savedResult={activeAnomalyResult}
                reviews={activeDataset ? anomalyReviewsByDataset[activeDataset.id] || {} : {}}
                onSaveResult={(res) => {
                  if (!activeDataset) return;
                  saveAnomalyResult(activeDataset.id, res);
                }}
                onUpdateReview={(rowIndex, status, note) => {
                  if (!activeDataset) return;
                  updateAnomalyReview(activeDataset.id, rowIndex, status, note);
                }}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('anomaly', title, summary)}
              />
            )}

            {activeNav === 'visualizations' && (
              <VisualizationsView dataset={activeDataset} onNavigate={setActiveNav} onLoadSample={loadSampleDataset} />
            )}

            {activeNav === 'predictive' && (
              <PredictiveView
                dataset={activeDataset}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('predictive', title, summary)}
              />
            )}

            {activeNav === 'sql' && (
              <SQLAssistantView
                dataset={activeDataset}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('sql', title, summary)}
              />
            )}

            {activeNav === 'python' && (
              <PythonAssistantView
                dataset={activeDataset}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('python', title, summary)}
              />
            )}

            {activeNav === 'insights' && (
              <InsightsView
                dataset={activeDataset}
                insights={activeDataset ? insightsByDataset[activeDataset.id] || null : null}
                anomalyResult={activeAnomalyResult}
                onSaveInsights={(res) => {
                  if (!activeDataset) return;
                  saveInsights(activeDataset.id, res);
                }}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordHistory={(title, summary) => recordHistory('insights', title, summary)}
              />
            )}

            {activeNav === 'reports' && (
              <ReportsView
                dataset={activeDataset}
                insights={activeDataset ? insightsByDataset[activeDataset.id] || null : null}
                anomalyResult={activeAnomalyResult}
                anomalyReviews={activeDataset ? anomalyReviewsByDataset[activeDataset.id] || {} : {}}
                onNavigate={setActiveNav}
                onLoadSample={loadSampleDataset}
                onRecordReportExport={(format) => {
                  incrementReportsCount();
                  recordHistory('report', `Exported ${format} Report`, `Report compiled for ${activeDataset?.name}`);
                  pushNotification('Report Exported', `${format} report generated successfully.`, 'success');
                }}
              />
            )}

            {activeNav === 'history' && (
              <HistoryView history={history} onClearHistory={clearHistory} />
            )}

            {activeNav === 'settings' && (
              <SettingsView
                workspaceName={workspaceName}
                onChangeWorkspaceName={setWorkspaceName}
                theme={theme}
                onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              />
            )}
            </div>
          </main>

          {/* RIGHT CONTEXTUAL INSIGHTS PANEL */}
          {rightPanelOpen && (
            <aside className="no-print hidden w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 xl:block dark:border-slate-800 dark:bg-slate-900">
              <div className="space-y-5">
                <div>
                  <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-white">
                    Contextual Insights
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {activeDataset ? `Status: Ready · ${activeDataset.profile.rowCount.toLocaleString()} rows indexed` : 'Status: Waiting for dataset'}
                  </p>
                </div>

                {!activeDataset ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    Upload a CSV, Excel, JSON file, or Google Sheet to unlock live schema context and follow-up suggestions.
                  </div>
                ) : (
                  <>
                    {/* Dataset Info */}
                    <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Dataset Information
                      </div>
                      <div className="space-y-1 text-xs text-slate-600 tabular-nums dark:text-slate-400">
                        <div className="flex justify-between">
                          <span>Name</span>
                          <span className="font-medium text-slate-900 dark:text-slate-200 truncate max-w-[140px]">
                            {activeDataset.name}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Dimensions</span>
                          <span className="font-mono text-slate-900 dark:text-slate-200">
                            {activeDataset.profile.rowCount.toLocaleString()} × {activeDataset.profile.columnCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Missing Cells</span>
                          <span className="font-mono text-slate-900 dark:text-slate-200">
                            {activeDataset.profile.missingCells} ({activeDataset.profile.missingPct}%)
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Quality Score</span>
                          <span className="font-mono font-semibold" style={{ color: accentHex }}>
                            {activeDataset.profile.qualityScore}/100
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Deterministic Observations */}
                    <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Automated Observations
                      </div>
                      <ul className="space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {rightObservations.map((obs, idx) => (
                          <li key={idx} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950">
                            {obs}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Suggested Follow-Ups */}
                    <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Suggested Questions
                      </div>
                      <div className="space-y-1.5">
                        {rightFollowUps.map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => handleAskQuestionDirect(q)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 transition-colors"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Help & Documentation Modal */}
      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                DataMind AI Documentation
              </h3>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="Close documentation"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              <p>
                <strong className="text-slate-900 dark:text-white">1. Upload &amp; Connect:</strong> Drag and drop CSV, XLSX, XLS, or JSON files (up to 25 MB), or paste a public/published Google Sheets URL in My Datasets.
              </p>
              <p>
                <strong className="text-slate-900 dark:text-white">2. Grounded AI Data Chat:</strong> Natural-language questions are translated into deterministic analytical plans, computed directly over your actual rows, and then explained with methodology and charts.
              </p>
              <p>
                <strong className="text-slate-900 dark:text-white">3. Data Cleaning &amp; Undo:</strong> Preview affected rows and projected quality improvements before applying changes. Undo any step or reset to original anytime.
              </p>
              <p>
                <strong className="text-slate-900 dark:text-white">4. SQL &amp; Predictive ML:</strong> Query table <code className="font-mono">dataset</code> using safe read-only SELECT statements, or evaluate regression, classification, forecasting, and clustering models with explicit validation metrics.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
