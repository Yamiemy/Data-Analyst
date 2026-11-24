export type ColumnType = 'number' | 'string' | 'date' | 'boolean';

export type DatasetRow = Record<string, string | number | boolean | null>;

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  nonNullCount: number;
  missingCount: number;
  missingPct: number;
  uniqueCount: number;
  // Numeric stats
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  mode?: string | number | null;
  stdDev?: number;
  variance?: number;
  q1?: number;
  q3?: number;
  iqr?: number;
  outlierCount?: number;
  sum?: number;
  // Categorical stats
  topValues?: Array<{ value: string; count: number; pct: number }>;
  // Date stats
  minDate?: string;
  maxDate?: string;
  // Quality flags
  inconsistentFormatCount?: number;
  leadingTrailingSpaceCount?: number;
  mixedCaseCount?: number;
}

export interface DatasetProfile {
  rowCount: number;
  columnCount: number;
  totalCells: number;
  missingCells: number;
  missingPct: number;
  duplicateRowCount: number;
  qualityScore: number; // 0-100 deterministic score
  completenessScore: number;
  uniquenessScore: number;
  consistencyScore: number;
  columns: ColumnProfile[];
}

export interface DatasetSnapshot {
  id: string;
  timestamp: string;
  actionDescription: string;
  rows: DatasetRow[];
  columns: string[];
  profile: DatasetProfile;
}

export interface Dataset {
  id: string;
  name: string;
  source: 'csv' | 'xlsx' | 'xls' | 'json' | 'google_sheets' | 'sample';
  fileSizeBytes: number;
  uploadedAt: string;
  columns: string[];
  rows: DatasetRow[];
  originalColumns: string[];
  originalRows: DatasetRow[];
  profile: DatasetProfile;
  originalProfile: DatasetProfile;
  cleaningHistory: DatasetSnapshot[];
}

export type ChartType =
  | 'bar'
  | 'horizontal_bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'histogram'
  | 'boxplot'
  | 'heatmap';

export interface ChartSpec {
  id: string;
  type: ChartType;
  title: string;
  description: string;
  xKey: string;
  yKeys: string[];
  xLabel?: string;
  yLabel?: string;
  data: Array<Record<string, string | number | null>>;
}

export interface ChatRecommendation {
  title: string;
  impact: string;
  action: string;
}

export type AnalysisMode = 'quick' | 'exploratory' | 'business' | 'statistical' | 'data_science';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  analysisMode?: AnalysisMode;
  keyTakeaway?: string;
  validationNote?: string;
  methodology?: string;
  verifiedFindings?: string[];
  assumptionsAndCaveats?: string[];
  recommendations?: ChatRecommendation[];
  followUpQuestions?: string[];
  chart?: ChartSpec;
  table?: {
    columns: string[];
    rows: Array<Record<string, string | number | boolean | null>>;
  };
  error?: string;
}

export interface AIPlanOperation {
  type:
    | 'aggregate'
    | 'timeseries'
    | 'summary_stats'
    | 'outliers'
    | 'anomaly_scan'
    | 'correlation'
    | 'value_counts'
    | 'top_n'
    | 'overview';
  groupBy?: string;
  metric?: string;
  secondaryMetric?: string;
  agg?: 'sum' | 'avg' | 'count' | 'min' | 'max';
  sort?: 'asc' | 'desc';
  limit?: number;
  granularity?: 'day' | 'month' | 'year' | 'auto';
}

export interface CleaningAction {
  type:
    | 'remove_duplicates'
    | 'fill_missing'
    | 'remove_missing_rows'
    | 'standardize_text'
    | 'standardize_dates'
    | 'convert_type'
    | 'handle_outliers'
    | 'rename_column';
  column?: string;
  fillStrategy?: 'mean' | 'median' | 'mode' | 'zero' | 'custom';
  customValue?: string;
  textMode?: 'trim' | 'lowercase' | 'uppercase' | 'titlecase';
  targetType?: ColumnType;
  outlierStrategy?: 'cap' | 'remove';
  newColumnName?: string;
}

export interface CleaningPreview {
  actionLabel: string;
  affectedRowsCount: number;
  affectedCellsCount: number;
  beforeQualityScore: number;
  afterQualityScore: number;
  beforeRowCount: number;
  afterRowCount: number;
  sampleDiffs: Array<{
    rowIndex: number;
    column: string;
    before: string;
    after: string;
  }>;
}

export interface CorrelationPair {
  colA: string;
  colB: string;
  r: number;
}

export interface EDAReport {
  datasetId: string;
  generatedAt: string;
  numericColumns: ColumnProfile[];
  categoricalColumns: ColumnProfile[];
  dateColumns: ColumnProfile[];
  correlations: CorrelationPair[];
  histograms: Array<{
    column: string;
    bins: Array<{ range: string; count: number }>;
  }>;
  outliersSummary: Array<{
    column: string;
    outlierCount: number;
    lowerBound: number;
    upperBound: number;
    sampleOutliers: number[];
    explanation: string;
  }>;
  automatedExplanations: string[];
}

export type PredictiveTaskType =
  | 'linear_regression'
  | 'logistic_regression'
  | 'decision_tree'
  | 'random_forest'
  | 'classification'
  | 'timeseries_forecast'
  | 'clustering';

export interface PredictiveModelResult {
  id: string;
  taskType: PredictiveTaskType;
  modelName: string;
  targetColumn?: string;
  dateColumn?: string;
  featureColumns: string[];
  trainCount: number;
  testCount: number;
  trainingTimeMs?: number;
  metrics: Array<{ label: string; value: string; description: string }>;
  featureImportances?: Array<{ feature: string; weight: number }>;
  actualVsPredicted?: Array<{
    index: string;
    actual: number | null;
    predicted: number;
    lower?: number;
    upper?: number;
  }>;
  confusionMatrix?: {
    labels: string[];
    matrix: number[][];
  };
  clusters?: Array<{
    clusterId: string;
    size: number;
    centroid: Record<string, number>;
  }>;
  clusterScatter?: Array<{
    x: number;
    y: number;
    cluster: string;
  }>;
  predictionsTable?: Array<{
    rowNumber: number;
    actual: string | number | null;
    predicted: string | number;
    errorOrMatch: string;
    inputsSummary: string;
  }>;
  trainSamplePreview?: Array<Record<string, string | number | boolean | null>>;
  testSamplePreview?: Array<Record<string, string | number | boolean | null>>;
  usedAnomalyFeatures?: boolean;
  limitations: string[];
}

export interface SQLResult {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  executionTimeMs: number;
  queryPlanSteps: string[];
  engineName?: string;
}

export interface SQLHistoryEntry {
  id: string;
  sql: string;
  timestamp: string;
  rowCount: number;
  executionTimeMs: number;
  prompt?: string;
}

export interface BIInsightItem {
  category: 'positive_trend' | 'negative_trend' | 'anomaly' | 'opportunity' | 'risk';
  importance: 'high' | 'medium' | 'low';
  title: string;
  summary: string;
  supportingMetric: string;
  recommendation: string;
}

export interface BIInsightsResponse {
  executiveSummary: string;
  insights: BIInsightItem[];
  generatedAt: string;
}

export interface AnalysisHistoryEntry {
  id: string;
  timestamp: string;
  datasetId: string;
  datasetName: string;
  module:
    | 'chat'
    | 'eda'
    | 'anomaly'
    | 'cleaning'
    | 'visualization'
    | 'predictive'
    | 'sql'
    | 'python'
    | 'insights'
    | 'report';
  title: string;
  summary: string;
}

export interface AppNotification {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
}

export type AnomalyAlgorithmId =
  | 'auto'
  | 'z_score'
  | 'modified_z_score'
  | 'iqr'
  | 'isolation_forest'
  | 'lof'
  | 'dbscan'
  | 'moving_average'
  | 'rolling_std'
  | 'seasonal_trend'
  | 'mahalanobis';

export type AnomalySeverity = 'high' | 'medium' | 'low';

export type AnomalyReviewStatus = 'unreviewed' | 'reviewed' | 'expected' | 'flagged';

export interface AnomalyReviewHistoryItem {
  status: AnomalyReviewStatus;
  note: string;
  timestamp: string;
}

export interface AnomalyReviewState {
  status: AnomalyReviewStatus;
  note: string;
  updatedAt: string;
  history?: AnomalyReviewHistoryItem[];
}

export type TimeSeriesAnomalyPattern =
  | 'sudden_spike'
  | 'sudden_drop'
  | 'unexpected_fluctuation'
  | 'trend_deviation'
  | 'seasonal_deviation';

export interface AnomalyFeatureComparison {
  feature: string;
  actualValue: number | null;
  expectedRange: string;
  deviationSummary: string;
}

export interface AnomalyRecord {
  rowIndex: number; // 1-based original row position in dataset.rows
  recordId: string;
  values: DatasetRow;
  score: number; // 0–100 normalized anomaly intensity (NOT probability)
  rawStatistic: string;
  severity: AnomalySeverity;
  affectedFeatures: string[];
  actualValuesSummary: string;
  expectedValuesSummary: string;
  featureComparisons: AnomalyFeatureComparison[];
  algorithmUsed: string;
  explanation: string;
  dateValue?: string;
  timeSeriesPattern?: TimeSeriesAnomalyPattern;
}

export interface AnomalyDetectionConfig {
  algorithm: AnomalyAlgorithmId;
  sensitivity: 'conservative' | 'balanced' | 'sensitive';
  selectedColumns: string[];
  dateColumn?: string;
  windowSize?: number;
  kNeighbors?: number;
  dbscanEps?: number;
  dbscanMinPts?: number;
}

export interface AnomalyDetectionResult {
  id: string;
  datasetId: string;
  requestedAlgorithm: AnomalyAlgorithmId;
  resolvedAlgorithm: Exclude<AnomalyAlgorithmId, 'auto'>;
  algorithmLabel: string;
  autoDetectReason: string;
  sensitivity: 'conservative' | 'balanced' | 'sensitive';
  featuresEvaluated: string[];
  dateColumnUsed?: string;
  windowSizeUsed?: number;
  kNeighborsUsed?: number;
  detectedParametersSummary: string;
  totalRecordsAnalyzed: number;
  sampledRecordsCount: number;
  isSampled: boolean;
  totalAnomalies: number;
  normalRecords: number;
  anomalyPct: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  records: AnomalyRecord[];
  allRowScores: number[];
  allRowFlags: boolean[];
  columnBreakdown: Array<{ column: string; anomalyCount: number; pct: number; avgDeviationSigma: number }>;
  scatterPoints: Array<{ x: number; y: number; severity: 'normal' | AnomalySeverity; rowIndex: number; score: number }>;
  scatterAxes: { xCol: string; yCol: string } | null;
  timeSeriesPoints: Array<{
    label: string;
    value: number;
    expectedValue?: number;
    lowerBand?: number;
    upperBand?: number;
    isAnomaly: boolean;
    severity: 'normal' | AnomalySeverity;
    score: number;
    rowIndex: number;
    patternType?: TimeSeriesAnomalyPattern;
  }>;
  timeSeriesPatternBreakdown?: {
    sudden_spike: number;
    sudden_drop: number;
    unexpected_fluctuation: number;
    trend_deviation: number;
    seasonal_deviation: number;
  };
  scoreDistribution: Array<{ range: string; normalCount: number; anomalyCount: number }>;
  correlationComparison: Array<{ pair: string; normalR: number; allR: number }>;
  limitations: string[];
  falsePositiveWarnings: string[];
  executionTimeMs: number;
  generatedAt: string;
}

export type ComparisonAlgorithmId = 'z_score' | 'iqr' | 'isolation_forest' | 'lof' | 'dbscan';

export interface AnomalyAlgorithmComparisonEntry {
  id: ComparisonAlgorithmId;
  label: string;
  flaggedCount: number;
  anomalyPct: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  isSampled: boolean;
  executionTimeMs: number;
  scoreScaleNote: string;
  flaggedRowIndices: number[];
}

export interface AnomalyDisagreementRecord {
  rowIndex: number;
  recordId: string;
  flaggedBy: ComparisonAlgorithmId[];
  missedBy: ComparisonAlgorithmId[];
  summaryValues: string;
  agreementRatio: string;
}

export interface AnomalyComparisonSummary {
  featuresEvaluated: string[];
  sensitivity: 'conservative' | 'balanced' | 'sensitive';
  totalRecordsAnalyzed: number;
  entries: AnomalyAlgorithmComparisonEntry[];
  unanimousCount: number;
  consensusCount: number; // flagged by >= 3 of 5
  singleAlgorithmOnlyCount: number;
  pairwiseMatrix: Array<{
    algoA: ComparisonAlgorithmId;
    labelA: string;
    values: Array<{ algoB: ComparisonAlgorithmId; overlapCount: number; jaccardPct: number }>;
  }>;
  disagreementHighlights: AnomalyDisagreementRecord[];
  calibrationWarning: string;
  generatedAt: string;
}

export interface AIAnomalyExplanationResponse {
  executiveSummary: string;
  statisticalVsAiNote: string;
  recordExplanations: Array<{
    rowIndex: number;
    contributingFeatures: string[];
    howUnusual: string;
    detectionAlgorithm: string;
    classificationAssessment: 'likely_data_quality_issue' | 'likely_legitimate_rare_event' | 'requires_domain_verification';
    likelihoodReason: string;
    statisticalEvidence: string;
    aiInterpretation: string;
    suggestedCheck: string;
  }>;
}

export type NavSectionId =
  | 'overview'
  | 'chat'
  | 'datasets'
  | 'cleaning'
  | 'eda'
  | 'anomaly'
  | 'visualizations'
  | 'predictive'
  | 'sql'
  | 'python'
  | 'insights'
  | 'reports'
  | 'history'
  | 'settings';
