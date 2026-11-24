import { buildSchemaContext } from '../engine/dataAnalyzer';
import type {
  AIAnomalyExplanationResponse,
  AIPlanOperation,
  AnalysisMode,
  AnomalyDetectionResult,
  AnomalyRecord,
  BIInsightsResponse,
  ChatRecommendation,
  Dataset,
} from '../types/data';

async function postJson<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = (data as { error?: string })?.error || `Request failed with status ${res.status}.`;
    const err = new Error(errMsg) as Error & { code?: string; status?: number };
    err.code = (data as { code?: string })?.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export async function checkServerHealth(): Promise<{ ok: boolean; geminiConfigured: boolean }> {
  const res = await fetch('/api/health');
  if (!res.ok) return { ok: false, geminiConfigured: false };
  return res.json();
}

export interface AIPlanResponse {
  intent: string;
  operations: AIPlanOperation[];
  chartSpec: {
    type: string;
    title: string;
    description?: string;
    xLabel?: string;
    yLabel?: string;
  };
}

export interface AISynthesizeResponse {
  keyTakeaway?: string;
  answer: string;
  methodology: string;
  verifiedFindings: string[];
  assumptionsAndCaveats: string[];
  recommendations: ChatRecommendation[];
  followUpQuestions: string[];
}

export async function requestAnalysisPlan(
  dataset: Dataset,
  question: string,
  history: Array<{ role: string; content: string }>,
  analysisMode: AnalysisMode = 'exploratory'
): Promise<AIPlanResponse> {
  const schema = buildSchemaContext(dataset);
  const profileSummary = {
    rowCount: dataset.profile.rowCount,
    columnCount: dataset.profile.columnCount,
    qualityScore: dataset.profile.qualityScore,
    missingCells: dataset.profile.missingCells,
    duplicateRowCount: dataset.profile.duplicateRowCount,
  };
  return postJson<AIPlanResponse>('/api/ai/plan', { question, schema, profileSummary, history, analysisMode });
}

export async function requestAnalysisSynthesis(
  dataset: Dataset,
  question: string,
  computedResults: unknown,
  history: Array<{ role: string; content: string }>,
  analysisMode: AnalysisMode = 'exploratory'
): Promise<AISynthesizeResponse> {
  const schema = buildSchemaContext(dataset);
  return postJson<AISynthesizeResponse>('/api/ai/synthesize', {
    question,
    schema,
    computedResults,
    history,
    analysisMode,
  });
}

export async function requestSQLGeneration(
  dataset: Dataset,
  question: string
): Promise<{ sql: string; explanation: string[] }> {
  const schema = buildSchemaContext(dataset);
  const sampleRows = dataset.rows.slice(0, 3);
  return postJson<{ sql: string; explanation: string[] }>('/api/ai/sql', {
    question,
    schema,
    sampleRows,
  });
}

export async function requestPythonGeneration(
  dataset: Dataset,
  question: string
): Promise<{ code: string; libraries: string[]; explanation: string[]; expectedOutput: string }> {
  const schema = buildSchemaContext(dataset);
  const profileSummary = {
    rowCount: dataset.profile.rowCount,
    columnCount: dataset.profile.columnCount,
    missingCells: dataset.profile.missingCells,
    numericHighlights: dataset.profile.columns
      .filter((c) => c.type === 'number')
      .map((c) => ({ name: c.name, mean: c.mean, median: c.median, min: c.min, max: c.max })),
  };
  return postJson('/api/ai/python', {
    question,
    schema,
    profileSummary,
    datasetName: dataset.name,
  });
}

export async function requestBIInsights(
  dataset: Dataset,
  edaSummary: unknown
): Promise<BIInsightsResponse> {
  const schema = buildSchemaContext(dataset);
  const profileSummary = {
    rowCount: dataset.profile.rowCount,
    columnCount: dataset.profile.columnCount,
    qualityScore: dataset.profile.qualityScore,
    missingPct: dataset.profile.missingPct,
    duplicateRowCount: dataset.profile.duplicateRowCount,
  };
  const data = await postJson<Omit<BIInsightsResponse, 'generatedAt'>>('/api/ai/insights', {
    datasetName: dataset.name,
    schema,
    profileSummary,
    edaSummary,
  });
  return {
    ...data,
    generatedAt: new Date().toISOString(),
  };
}

export async function importGoogleSheet(params: {
  url: string;
  sheetName?: string;
  accessToken?: string;
}): Promise<{
  mode: 'csv_export' | 'oauth_api';
  title: string;
  csvText?: string;
  values?: unknown[][];
  sheetNames?: string[];
  activeSheet?: string;
}> {
  const headers: Record<string, string> = {};
  if (params.accessToken?.trim()) {
    headers.Authorization = `Bearer ${params.accessToken.trim()}`;
  }
  return postJson('/api/sheets/import', { url: params.url, sheetName: params.sheetName }, headers);
}

export async function requestAnomalyExplanations(
  dataset: Dataset,
  result: AnomalyDetectionResult,
  targetRecords: AnomalyRecord[]
): Promise<AIAnomalyExplanationResponse> {
  const schema = buildSchemaContext(dataset);
  const summary = {
    algorithm: result.algorithmLabel,
    parameters: result.detectedParametersSummary,
    sensitivity: result.sensitivity,
    totalRecordsAnalyzed: result.totalRecordsAnalyzed,
    totalAnomalies: result.totalAnomalies,
    anomalyPct: result.anomalyPct,
    highCount: result.highCount,
    mediumCount: result.mediumCount,
    lowCount: result.lowCount,
    topAffectedColumns: result.columnBreakdown.slice(0, 5),
  };

  const compactRecords = targetRecords.slice(0, 8).map((r) => ({
    rowIndex: r.rowIndex,
    recordId: r.recordId,
    algorithmUsed: r.algorithmUsed,
    intensityScoreOutOf100: r.score,
    severity: r.severity,
    rawStatistic: r.rawStatistic,
    affectedFeatures: r.affectedFeatures,
    actualValuesSummary: r.actualValuesSummary,
    expectedValuesSummary: r.expectedValuesSummary,
    featureComparisons: r.featureComparisons,
    statisticalExplanation: r.explanation,
    timeSeriesPattern: r.timeSeriesPattern,
    observedValues: Object.fromEntries(
      result.featuresEvaluated.slice(0, 8).map((col) => [col, r.values[col] ?? null])
    ),
  }));

  return postJson<AIAnomalyExplanationResponse>('/api/ai/anomalies', {
    datasetName: dataset.name,
    schema,
    summary,
    records: compactRecords,
  });
}
