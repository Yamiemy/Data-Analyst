import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyCleaningAction, resetToOriginalDataset, undoLastCleaning } from '../engine/cleaner';
import { createSampleRetailSalesDataset } from '../engine/parser';
import type {
  AnalysisHistoryEntry,
  AnomalyDetectionResult,
  AnomalyReviewState,
  AnomalyReviewStatus,
  AppNotification,
  BIInsightsResponse,
  ChatMessage,
  CleaningAction,
  Dataset,
  NavSectionId,
} from '../types/data';

const WORKSPACE_STORAGE_KEY = 'datamind_workspace_v1';
const MAX_PERSISTED_BYTES = 2_500_000;

interface PersistedWorkspace {
  theme?: 'light' | 'dark';
  workspaceName?: string;
  activeNav?: NavSectionId;
  datasets?: Dataset[];
  activeDatasetId?: string | null;
  chatByDataset?: Record<string, ChatMessage[]>;
  insightsByDataset?: Record<string, BIInsightsResponse>;
  anomalyReviewsByDataset?: Record<string, Record<number, AnomalyReviewState>>;
  history?: AnalysisHistoryEntry[];
  reportsCount?: number;
}

function loadPersistedWorkspace(): PersistedWorkspace {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface DatasetContextValue {
  theme: 'light' | 'dark';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark'>>;
  workspaceName: string;
  setWorkspaceName: React.Dispatch<React.SetStateAction<string>>;
  activeNav: NavSectionId;
  setActiveNav: React.Dispatch<React.SetStateAction<NavSectionId>>;
  datasets: Dataset[];
  activeDatasetId: string | null;
  activeDataset: Dataset | null;
  selectDataset: (id: string) => void;
  loadDataset: (ds: Dataset) => void;
  loadSampleDataset: () => void;
  deleteDataset: (id: string) => void;
  applyCleaning: (action: CleaningAction) => void;
  undoCleaning: () => void;
  resetDataset: () => void;
  chatByDataset: Record<string, ChatMessage[]>;
  addChatMessage: (datasetId: string, msg: ChatMessage) => void;
  clearChatHistory: (datasetId: string) => void;
  insightsByDataset: Record<string, BIInsightsResponse>;
  saveInsights: (datasetId: string, res: BIInsightsResponse) => void;
  anomalyResultByDataset: Record<string, AnomalyDetectionResult>;
  saveAnomalyResult: (datasetId: string, res: AnomalyDetectionResult) => void;
  anomalyReviewsByDataset: Record<string, Record<number, AnomalyReviewState>>;
  updateAnomalyReview: (datasetId: string, rowIndex: number, status: AnomalyReviewStatus, note?: string) => void;
  history: AnalysisHistoryEntry[];
  recordHistory: (module: AnalysisHistoryEntry['module'], title: string, summary: string) => void;
  clearHistory: () => void;
  reportsCount: number;
  incrementReportsCount: () => void;
  notifications: AppNotification[];
  pushNotification: (title: string, detail: string, type?: AppNotification['type']) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

export const DatasetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialState] = useState<PersistedWorkspace>(() => loadPersistedWorkspace());

  const [theme, setTheme] = useState<'light' | 'dark'>(
    initialState.theme === 'light' ? 'light' : 'dark'
  );
  const [workspaceName, setWorkspaceName] = useState(
    initialState.workspaceName || 'Executive Analytics Workspace'
  );
  const [activeNav, setActiveNav] = useState<NavSectionId>(initialState.activeNav || 'overview');

  const [datasets, setDatasets] = useState<Dataset[]>(
    Array.isArray(initialState.datasets) ? initialState.datasets : []
  );
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(
    initialState.activeDatasetId ?? null
  );

  const [chatByDataset, setChatByDataset] = useState<Record<string, ChatMessage[]>>(
    initialState.chatByDataset && typeof initialState.chatByDataset === 'object'
      ? initialState.chatByDataset
      : {}
  );
  const [insightsByDataset, setInsightsByDataset] = useState<Record<string, BIInsightsResponse>>(
    initialState.insightsByDataset && typeof initialState.insightsByDataset === 'object'
      ? initialState.insightsByDataset
      : {}
  );
  const [anomalyResultByDataset, setAnomalyResultByDataset] = useState<Record<string, AnomalyDetectionResult>>({});
  const [anomalyReviewsByDataset, setAnomalyReviewsByDataset] = useState<
    Record<string, Record<number, AnomalyReviewState>>
  >(
    initialState.anomalyReviewsByDataset && typeof initialState.anomalyReviewsByDataset === 'object'
      ? initialState.anomalyReviewsByDataset
      : {}
  );
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>(
    Array.isArray(initialState.history) ? initialState.history : []
  );
  const [reportsCount, setReportsCount] = useState(
    typeof initialState.reportsCount === 'number' ? initialState.reportsCount : 0
  );
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  useEffect(() => {
    try {
      const fullPayload: PersistedWorkspace = {
        theme,
        workspaceName,
        activeNav,
        datasets,
        activeDatasetId,
        chatByDataset,
        insightsByDataset,
        anomalyReviewsByDataset,
        history: history.slice(0, 100),
        reportsCount,
      };
      const serialized = JSON.stringify(fullPayload);
      if (serialized.length <= MAX_PERSISTED_BYTES) {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, serialized);
      } else {
        const litePayload: PersistedWorkspace = {
          theme,
          workspaceName,
          activeNav,
          history: history.slice(0, 100),
          reportsCount,
          chatByDataset,
          insightsByDataset,
          anomalyReviewsByDataset,
        };
        const liteSerialized = JSON.stringify(litePayload);
        if (liteSerialized.length <= MAX_PERSISTED_BYTES) {
          window.localStorage.setItem(WORKSPACE_STORAGE_KEY, liteSerialized);
        }
      }
    } catch {
      // Ignore storage quota or private browsing errors gracefully
    }
  }, [theme, workspaceName, activeNav, datasets, activeDatasetId, chatByDataset, insightsByDataset, anomalyReviewsByDataset, history, reportsCount]);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) || datasets[0] || null,
    [datasets, activeDatasetId]
  );

  const pushNotification = useCallback(
    (title: string, detail: string, type: AppNotification['type'] = 'info') => {
      setNotifications((prev) => [
        {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          timestamp: new Date().toISOString(),
          title,
          detail,
          type,
          read: false,
        },
        ...prev.slice(0, 19),
      ]);
    },
    []
  );

  const recordHistory = useCallback(
    (module: AnalysisHistoryEntry['module'], title: string, summary: string) => {
      if (!activeDataset) return;
      setHistory((prev) => [
        {
          id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          timestamp: new Date().toISOString(),
          datasetId: activeDataset.id,
          datasetName: activeDataset.name,
          module,
          title,
          summary,
        },
        ...prev,
      ]);
    },
    [activeDataset]
  );

  const selectDataset = useCallback((id: string) => {
    setActiveDatasetId(id);
  }, []);

  const loadDataset = useCallback(
    (ds: Dataset) => {
      setDatasets((prev) => [ds, ...prev]);
      setActiveDatasetId(ds.id);
      pushNotification(
        'Dataset Indexed',
        `${ds.name} (${ds.profile.rowCount.toLocaleString()} rows · ${ds.profile.columnCount} columns)`,
        'success'
      );
    },
    [pushNotification]
  );

  const loadSampleDataset = useCallback(() => {
    const sample = createSampleRetailSalesDataset();
    loadDataset(sample);
  }, [loadDataset]);

  const deleteDataset = useCallback(
    (id: string) => {
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      if (activeDatasetId === id) {
        setActiveDatasetId(null);
      }
    },
    [activeDatasetId]
  );

  const invalidateDerivedForDataset = useCallback((datasetId: string) => {
    setAnomalyResultByDataset((prev) => {
      if (!prev[datasetId]) return prev;
      const copy = { ...prev };
      delete copy[datasetId];
      return copy;
    });
    setInsightsByDataset((prev) => {
      if (!prev[datasetId]) return prev;
      const copy = { ...prev };
      delete copy[datasetId];
      return copy;
    });
  }, []);

  const applyCleaning = useCallback(
    (action: CleaningAction) => {
      if (!activeDataset) return;
      const updated = applyCleaningAction(activeDataset, action);
      setDatasets((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      invalidateDerivedForDataset(updated.id);
      const latestSnap = updated.cleaningHistory[updated.cleaningHistory.length - 1];
      if (latestSnap) {
        recordHistory('cleaning', latestSnap.actionDescription, `Quality score: ${updated.profile.qualityScore}/100`);
        pushNotification('Cleaning Applied', latestSnap.actionDescription, 'success');
      }
    },
    [activeDataset, invalidateDerivedForDataset, pushNotification, recordHistory]
  );

  const undoCleaning = useCallback(() => {
    if (!activeDataset) return;
    const reverted = undoLastCleaning(activeDataset);
    setDatasets((prev) => prev.map((d) => (d.id === reverted.id ? reverted : d)));
    invalidateDerivedForDataset(reverted.id);
    pushNotification('Cleaning Undone', `Restored previous state of ${reverted.name}.`, 'info');
  }, [activeDataset, invalidateDerivedForDataset, pushNotification]);

  const resetDataset = useCallback(() => {
    if (!activeDataset) return;
    const reset = resetToOriginalDataset(activeDataset);
    setDatasets((prev) => prev.map((d) => (d.id === reset.id ? reset : d)));
    invalidateDerivedForDataset(reset.id);
    pushNotification('Dataset Reset', `Restored original upload state of ${reset.name}.`, 'info');
  }, [activeDataset, invalidateDerivedForDataset, pushNotification]);

  const addChatMessage = useCallback((datasetId: string, msg: ChatMessage) => {
    setChatByDataset((prev) => ({
      ...prev,
      [datasetId]: [...(prev[datasetId] || []), msg],
    }));
  }, []);

  const clearChatHistory = useCallback((datasetId: string) => {
    setChatByDataset((prev) => ({ ...prev, [datasetId]: [] }));
  }, []);

  const saveInsights = useCallback((datasetId: string, res: BIInsightsResponse) => {
    setInsightsByDataset((prev) => ({ ...prev, [datasetId]: res }));
  }, []);

  const saveAnomalyResult = useCallback((datasetId: string, res: AnomalyDetectionResult) => {
    setAnomalyResultByDataset((prev) => ({ ...prev, [datasetId]: res }));
  }, []);

  const updateAnomalyReview = useCallback(
    (datasetId: string, rowIndex: number, status: AnomalyReviewStatus, note?: string) => {
      setAnomalyReviewsByDataset((prev) => {
        const dsReviews = { ...(prev[datasetId] || {}) };
        const existing = dsReviews[rowIndex];
        const finalNote = note !== undefined ? note : existing?.note || '';
        const timestamp = new Date().toISOString();
        const prevHistory = Array.isArray(existing?.history)
          ? existing.history
          : existing
            ? [{ status: existing.status, note: existing.note, timestamp: existing.updatedAt }]
            : [];
        const last = prevHistory[prevHistory.length - 1];
        const nextHistory =
          last && last.status === status && last.note === finalNote
            ? prevHistory
            : [...prevHistory, { status, note: finalNote, timestamp }];
        dsReviews[rowIndex] = {
          status,
          note: finalNote,
          updatedAt: timestamp,
          history: nextHistory,
        };
        return { ...prev, [datasetId]: dsReviews };
      });
    },
    []
  );

  const clearHistory = useCallback(() => setHistory([]), []);
  const incrementReportsCount = useCallback(() => setReportsCount((c) => c + 1), []);
  const markNotificationsRead = useCallback(
    () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))),
    []
  );
  const clearNotifications = useCallback(() => setNotifications([]), []);

  return (
    <DatasetContext.Provider
      value={{
        theme,
        setTheme,
        workspaceName,
        setWorkspaceName,
        activeNav,
        setActiveNav,
        datasets,
        activeDatasetId,
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
      }}
    >
      {children}
    </DatasetContext.Provider>
  );
};

export function useDatasetContext(): DatasetContextValue {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDatasetContext must be used inside DatasetProvider.');
  return ctx;
}
