import express, { type Request, type Response } from 'express';
import http from 'node:http';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not configured. Add it in Settings > Secrets to enable AI features.'),
      { statusCode: 503 }
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callGeminiWithRetry<T>(fn: (ai: GoogleGenAI) => Promise<T>, retries = 2): Promise<T> {
  const ai = getGeminiClient();
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(ai);
    } catch (err: unknown) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      if (attempt < retries && (status === 429 || status === 503 || status === 500)) {
        await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode || e?.status || 500;
  const rawMessage = e?.message || 'Unexpected AI service error.';

  if (rawMessage.includes('API_KEY_INVALID') || status === 400 && rawMessage.includes('API key')) {
    return {
      status: 400,
      message: 'The configured Gemini API key is invalid. Please check it in Settings > Secrets.',
    };
  }
  if (status === 403 || rawMessage.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message: 'Gemini API permission denied. Please verify your API key in Settings > Secrets.',
    };
  }
  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'AI rate limit reached. Please wait a moment and try again.',
    };
  }
  return { status: typeof status === 'number' && status >= 400 && status < 600 ? status : 500, message: rawMessage };
}

function parseGoogleSheetsUrl(rawUrl: string): {
  mode: 'published_csv' | 'spreadsheet_id';
  spreadsheetId?: string;
  gid?: string;
  fetchUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw Object.assign(new Error('Invalid URL format. Please paste a valid Google Sheets URL.'), { statusCode: 400 });
  }

  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Only HTTPS Google Sheets URLs are supported.'), { statusCode: 400 });
  }

  if (parsed.hostname !== 'docs.google.com') {
    throw Object.assign(
      new Error('URL must point to docs.google.com/spreadsheets.'),
      { statusCode: 400 }
    );
  }

  const pathname = parsed.pathname;

  // Published CSV URL: /spreadsheets/d/e/<pubId>/pub...
  const pubMatch = pathname.match(/^\/spreadsheets\/d\/e\/([a-zA-Z0-9_-]+)\/pub/);
  if (pubMatch) {
    const pubUrl = new URL(`https://docs.google.com${pathname}`);
    pubUrl.searchParams.set('output', 'csv');
    const gid = parsed.searchParams.get('gid');
    if (gid && /^\d+$/.test(gid)) {
      pubUrl.searchParams.set('gid', gid);
      pubUrl.searchParams.set('single', 'true');
    }
    return {
      mode: 'published_csv',
      gid: gid || undefined,
      fetchUrl: pubUrl.toString(),
    };
  }

  // Standard Sheet URL: /spreadsheets/d/<spreadsheetId>/...
  const idMatch = pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    throw Object.assign(
      new Error('Could not find a Google Sheets ID in that URL. Expected docs.google.com/spreadsheets/d/...'),
      { statusCode: 400 }
    );
  }

  const spreadsheetId = idMatch[1];
  let gid = parsed.searchParams.get('gid') || undefined;
  if (!gid && parsed.hash) {
    const hashMatch = parsed.hash.match(/gid=(\d+)/);
    if (hashMatch) gid = hashMatch[1];
  }
  if (gid && !/^\d+$/.test(gid)) {
    gid = undefined;
  }

  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  return {
    mode: 'spreadsheet_id',
    spreadsheetId,
    gid,
    fetchUrl: exportUrl,
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    res.json({ ok: true, geminiConfigured: hasKey });
  });

  const ANALYSIS_MODE_INSTRUCTIONS: Record<string, string> = {
    quick: 'Mode: Quick Analysis. Prioritize the single most direct calculation and concise chart; keep answer crisp and executive.',
    exploratory: 'Mode: Exploratory Analysis. Inspect distributions, top breakdowns, and notable patterns across relevant columns.',
    business: 'Mode: Business Analysis. Focus on revenue, profit, margins, customer/product segments, and actionable commercial KPIs.',
    statistical: 'Mode: Statistical Analysis. Prioritize summary_stats (mean, median, variance, stdDev, quartiles), correlation, and IQR outliers.',
    data_science: 'Mode: Advanced Data Science. Inspect feature drivers, variance, correlations, outliers, and segment structure with predictive caveats.',
  };

  // 1. AI Analysis Planner: converts natural language question + schema into deterministic operations
  app.post('/api/ai/plan', async (req: Request, res: Response) => {
    try {
      const { question, schema, profileSummary, history, analysisMode } = req.body as {
        question: string;
        schema: unknown;
        profileSummary: unknown;
        history?: Array<{ role: string; content: string }>;
        analysisMode?: string;
      };

      if (!question || !schema) {
        res.status(400).json({ error: 'Question and dataset schema are required.' });
        return;
      }

      const modeInstruction = ANALYSIS_MODE_INSTRUCTIONS[analysisMode || 'exploratory'] || ANALYSIS_MODE_INSTRUCTIONS.exploratory;

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are the analytical query planner for DataMind AI.',
          modeInstruction,
          'Given the dataset schema, statistical profile summary, recent conversation, and user question, design a deterministic computation plan using ONLY the exact column names present in the schema.',
          'NEVER invent values. Select operations from the supported deterministic operation types:',
          '- "aggregate": group by a categorical/date column and aggregate a numeric column (sum, avg, count, min, max).',
          '- "timeseries": group by a date/time column (or ordered category) and aggregate a numeric metric over time.',
          '- "summary_stats": compute descriptive statistics for specific numeric columns.',
          '- "outliers": detect IQR outliers in a numeric column.',
          '- "anomaly_scan": run comprehensive anomaly detection across numeric/date columns and return flagged anomalous rows, severity counts, affected contributing features, actual vs expected values, and optional category-level anomaly rate comparison (set groupBy to a categorical column when the user asks to compare anomalies by category, segment, region, etc.). Use this for any question asking why records are anomalous, which features contribute most, highest-scoring anomalies, comparing anomalies by category, or explaining anomaly results.',
          '- "correlation": compute Pearson correlation between two numeric columns (or all numeric columns if omitted).',
          '- "value_counts": frequency breakdown of a categorical column.',
          '- "top_n": sort rows by a column (asc or desc) and return top N records.',
          '- "overview": overall dataset health, missing values, and top column highlights.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Profile Summary:\n${JSON.stringify(profileSummary)}`,
          history && history.length > 0
            ? `Recent Conversation:\n${JSON.stringify(history.slice(-4))}`
            : '',
          `User Question: "${question}"`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: { type: Type.STRING, description: 'Short summary of analytical intent.' },
                operations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      type: {
                        type: Type.STRING,
                        description: 'One of: aggregate, timeseries, summary_stats, outliers, anomaly_scan, correlation, value_counts, top_n, overview',
                      },
                      groupBy: { type: Type.STRING, description: 'Column name to group by if applicable.' },
                      metric: { type: Type.STRING, description: 'Numeric column name to aggregate or inspect.' },
                      secondaryMetric: { type: Type.STRING, description: 'Second numeric column for correlation or scatter.' },
                      agg: { type: Type.STRING, description: 'One of: sum, avg, count, min, max' },
                      sort: { type: Type.STRING, description: 'asc or desc' },
                      limit: { type: Type.INTEGER, description: 'Max rows to return, e.g. 10' },
                      granularity: { type: Type.STRING, description: 'For timeseries: day, month, year, or auto' },
                    },
                    required: ['type'],
                  },
                },
                chartSpec: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      description: 'One of: bar, horizontal_bar, line, area, pie, donut, scatter, histogram',
                    },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    xLabel: { type: Type.STRING },
                    yLabel: { type: Type.STRING },
                  },
                  required: ['type', 'title'],
                },
              },
              required: ['intent', 'operations', 'chartSpec'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 2. AI Synthesizer: explains verified deterministic computation outputs accurately
  app.post('/api/ai/synthesize', async (req: Request, res: Response) => {
    try {
      const { question, schema, computedResults, history, analysisMode } = req.body as {
        question: string;
        schema: unknown;
        computedResults: unknown;
        history?: Array<{ role: string; content: string }>;
        analysisMode?: string;
      };

      if (!question || !computedResults) {
        res.status(400).json({ error: 'Question and computedResults are required.' });
        return;
      }

      const modeInstruction = ANALYSIS_MODE_INSTRUCTIONS[analysisMode || 'exploratory'] || ANALYSIS_MODE_INSTRUCTIONS.exploratory;

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are DataMind AI, a rigorous senior data analyst.',
          modeInstruction,
          'STRICT RULES:',
          '1. Use ONLY the numbers, categories, and statistics provided in Computed Results below. NEVER invent, extrapolate, or guess any dataset value.',
          '2. If a requested calculation could not be completed or a column is missing, explicitly state that limitation.',
          '3. Clearly separate Verified Findings (from actual data) from Assumptions & Caveats.',
          '4. Provide a crisp one-sentence Key Takeaway summarizing the decisive conclusion.',
          '5. Provide clear, non-technical business recommendations tied directly to the verified results.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Computed Results (Deterministic Ground Truth):\n${JSON.stringify(computedResults)}`,
          history && history.length > 0
            ? `Conversation Context:\n${JSON.stringify(history.slice(-4))}`
            : '',
          `User Question: "${question}"`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                keyTakeaway: { type: Type.STRING, description: 'Single crisp headline takeaway grounded strictly in computedResults.' },
                answer: { type: Type.STRING, description: 'Clear, direct answer grounded strictly in computedResults.' },
                methodology: { type: Type.STRING, description: 'Columns used, aggregation logic, and sample/row scope.' },
                verifiedFindings: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Key factual bullets citing exact calculated numbers.',
                },
                assumptionsAndCaveats: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Data caveats, missing value effects, or analytical assumptions.',
                },
                recommendations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      impact: { type: Type.STRING, description: 'High, Medium, or Exploratory' },
                      action: { type: Type.STRING },
                    },
                    required: ['title', 'impact', 'action'],
                  },
                },
                followUpQuestions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: '3 relevant follow-up analytical questions.',
                },
              },
              required: ['keyTakeaway', 'answer', 'methodology', 'verifiedFindings', 'assumptionsAndCaveats', 'recommendations', 'followUpQuestions'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 3. AI SQL Generator
  app.post('/api/ai/sql', async (req: Request, res: Response) => {
    try {
      const { question, schema, sampleRows } = req.body as {
        question: string;
        schema: unknown;
        sampleRows: unknown;
      };

      if (!question || !schema) {
        res.status(400).json({ error: 'Question and schema are required.' });
        return;
      }

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are a senior analytics SQL engineer.',
          'Generate a safe, read-only SQL SELECT query for the table named `dataset`.',
          'Rules:',
          '- Only output a single SELECT or WITH (CTE) statement. NEVER output DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, or TRUNCATE.',
          '- Use exact column names from the schema. Quote column names containing spaces with double quotes e.g. "Order Date".',
          '- Runs on full SQLite WASM: CTEs (WITH), subqueries, CASE WHEN, COUNT(DISTINCT ...), ROUND(), GROUP BY, HAVING, ORDER BY, LIMIT, and window functions (ROW_NUMBER(), RANK(), SUM() OVER) are fully supported.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Sample Rows:\n${JSON.stringify(sampleRows)}`,
          `Request: "${question}"`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                sql: { type: Type.STRING },
                explanation: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Step-by-step plain-language breakdown of the SQL query.',
                },
              },
              required: ['sql', 'explanation'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 4. AI Python Code Assistant
  app.post('/api/ai/python', async (req: Request, res: Response) => {
    try {
      const { question, schema, profileSummary, datasetName } = req.body as {
        question: string;
        schema: unknown;
        profileSummary: unknown;
        datasetName: string;
      };

      if (!question || !schema) {
        res.status(400).json({ error: 'Question and schema are required.' });
        return;
      }

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are a lead Python data scientist.',
          `Generate clean, well-commented, production-ready Python analysis code for dataset "${datasetName}".`,
          'Use pandas, numpy, matplotlib, seaborn, and scikit-learn where relevant. Reference exact column names from the schema.',
          'Also provide a line-by-line or block-by-block explanation and describe the expected output strictly grounded in the profile summary below.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Profile Summary:\n${JSON.stringify(profileSummary)}`,
          `Analysis Task: "${question}"`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                code: { type: Type.STRING },
                libraries: { type: Type.ARRAY, items: { type: Type.STRING } },
                explanation: { type: Type.ARRAY, items: { type: Type.STRING } },
                expectedOutput: { type: Type.STRING },
              },
              required: ['code', 'libraries', 'explanation', 'expectedOutput'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 5. AI Business Intelligence Insights
  app.post('/api/ai/insights', async (req: Request, res: Response) => {
    try {
      const { datasetName, schema, profileSummary, edaSummary } = req.body as {
        datasetName: string;
        schema: unknown;
        profileSummary: unknown;
        edaSummary: unknown;
      };

      if (!schema || !edaSummary) {
        res.status(400).json({ error: 'Dataset schema and EDA summary are required.' });
        return;
      }

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are a chief business intelligence strategist.',
          `Analyze the deterministic EDA summary and profile of "${datasetName}".`,
          'Produce prioritized business intelligence insights across positive trends, negative trends, anomalies, opportunities, and risks.',
          'CRITICAL: Every single insight MUST cite an exact supporting metric from the provided EDA summary or profile. Never invent numbers.',
          'Write in clear, executive language understandable to non-technical stakeholders.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Profile Summary:\n${JSON.stringify(profileSummary)}`,
          `EDA Summary:\n${JSON.stringify(edaSummary)}`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                insights: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: 'One of: positive_trend, negative_trend, anomaly, opportunity, risk',
                      },
                      importance: { type: Type.STRING, description: 'high, medium, or low' },
                      title: { type: Type.STRING },
                      summary: { type: Type.STRING },
                      supportingMetric: { type: Type.STRING },
                      recommendation: { type: Type.STRING },
                    },
                    required: ['category', 'importance', 'title', 'summary', 'supportingMetric', 'recommendation'],
                  },
                },
              },
              required: ['executiveSummary', 'insights'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 5b. AI Anomaly Explanation Assistant (separates deterministic stats vs cautious AI interpretation)
  app.post('/api/ai/anomalies', async (req: Request, res: Response) => {
    try {
      const { datasetName, schema, summary, records } = req.body as {
        datasetName?: string;
        schema?: unknown;
        summary?: unknown;
        records?: unknown[];
      };

      if (!schema || !summary || !Array.isArray(records) || records.length === 0) {
        res.status(400).json({ error: 'Schema, anomaly summary, and at least one anomalous record are required.' });
        return;
      }

      const result = await callGeminiWithRetry(async (ai) => {
        const prompt = [
          'You are a careful statistical analyst explaining detected data anomalies in DataMind AI.',
          `Dataset: "${datasetName || 'Active Dataset'}"`,
          'CRITICAL SAFETY & HONESTY RULES:',
          '1. Strictly distinguish STATISTICALLY MEASURED EVIDENCE (exact numbers/z-scores/expected ranges/intensity scores provided in the input) from plausible DOMAIN INTERPRETATIONS.',
          '2. NEVER automatically label an anomaly as fraud, malicious activity, or a confirmed data error. Use cautious hypotheses and assess whether statistical clues point toward a "likely_data_quality_issue", "likely_legitimate_rare_event", or "requires_domain_verification".',
          '3. Distinguish the 0-100 anomaly intensity score from a calibrated probability—higher scores reflect stronger deviation relative to the detector baseline, NOT probability of error or fraud.',
          '4. Cite only exact values, actual values, expected ranges, and algorithms present in the provided records and summary.',
          '',
          `Schema:\n${JSON.stringify(schema)}`,
          `Detection Summary:\n${JSON.stringify(summary)}`,
          `Flagged Records:\n${JSON.stringify(records)}`,
        ].join('\n');

        const response = await ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                statisticalVsAiNote: { type: Type.STRING },
                recordExplanations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rowIndex: { type: Type.INTEGER },
                      contributingFeatures: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Exact column names driving the anomaly score.',
                      },
                      howUnusual: {
                        type: Type.STRING,
                        description: 'Concise quantitative summary comparing actual vs expected range / sigma / quartile distance.',
                      },
                      detectionAlgorithm: {
                        type: Type.STRING,
                        description: 'Name of the detection algorithm that flagged this record.',
                      },
                      classificationAssessment: {
                        type: Type.STRING,
                        description: 'Must be exactly one of: likely_data_quality_issue, likely_legitimate_rare_event, requires_domain_verification',
                      },
                      likelihoodReason: {
                        type: Type.STRING,
                        description: 'Balanced rationale for why it resembles a data-quality issue vs legitimate unusual event without assuming fraud.',
                      },
                      statisticalEvidence: { type: Type.STRING },
                      aiInterpretation: { type: Type.STRING },
                      suggestedCheck: { type: Type.STRING },
                    },
                    required: [
                      'rowIndex',
                      'contributingFeatures',
                      'howUnusual',
                      'detectionAlgorithm',
                      'classificationAssessment',
                      'likelihoodReason',
                      'statisticalEvidence',
                      'aiInterpretation',
                      'suggestedCheck',
                    ],
                  },
                },
              },
              required: ['executiveSummary', 'statisticalVsAiNote', 'recordExplanations'],
            },
          },
        });

        return JSON.parse((response.text ?? '{}').trim());
      });

      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // 6. Google Sheets Import Proxy (Public CSV, Published CSV, or OAuth Bearer token)
  app.post('/api/sheets/import', async (req: Request, res: Response) => {
    try {
      const { url, sheetName } = req.body as { url?: string; sheetName?: string };
      if (!url) {
        res.status(400).json({ error: 'Google Sheets URL is required.' });
        return;
      }

      const parsed = parseGoogleSheetsUrl(url);
      const authHeader = req.headers.authorization;

      // If client supplied a Google OAuth Bearer token and we have a spreadsheetId, use Sheets API v4
      if (authHeader && authHeader.startsWith('Bearer ') && parsed.spreadsheetId) {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${parsed.spreadsheetId}?fields=properties.title,sheets.properties`,
          { headers: { Authorization: authHeader } }
        );

        if (metaRes.status === 401 || metaRes.status === 403) {
          res.status(metaRes.status).json({
            error: 'Google OAuth authorization failed or you do not have read permission for this spreadsheet.',
            code: 'OAUTH_PERMISSION_DENIED',
          });
          return;
        }
        if (!metaRes.ok) {
          const errBody = await metaRes.text();
          res.status(metaRes.status).json({
            error: `Google Sheets API returned status ${metaRes.status}: ${errBody.slice(0, 200)}`,
          });
          return;
        }

        const meta = (await metaRes.json()) as {
          properties?: { title?: string };
          sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
        };
        const availableSheets = (meta.sheets || [])
          .map((s) => s.properties)
          .filter((p): p is { sheetId?: number; title: string } => Boolean(p?.title));

        if (availableSheets.length === 0) {
          res.status(404).json({ error: 'No worksheet tabs found in this Google Spreadsheet.' });
          return;
        }

        let targetSheet = availableSheets[0].title;
        if (sheetName && availableSheets.some((s) => s.title === sheetName)) {
          targetSheet = sheetName;
        } else if (parsed.gid) {
          const byGid = availableSheets.find((s) => String(s.sheetId) === parsed.gid);
          if (byGid) targetSheet = byGid.title;
        }

        const valuesRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${parsed.spreadsheetId}/values/${encodeURIComponent(targetSheet)}`,
          { headers: { Authorization: authHeader } }
        );

        if (!valuesRes.ok) {
          res.status(valuesRes.status).json({ error: 'Failed to read cell values from Google Sheets tab.' });
          return;
        }

        const valuesJson = (await valuesRes.json()) as { values?: unknown[][] };
        res.json({
          mode: 'oauth_api',
          title: meta.properties?.title || 'Google Sheet',
          activeSheet: targetSheet,
          sheetNames: availableSheets.map((s) => s.title),
          values: valuesJson.values || [],
        });
        return;
      }

      // Public / Published CSV export path
      const sheetRes = await fetch(parsed.fetchUrl, { redirect: 'follow' });
      const contentType = sheetRes.headers.get('content-type') || '';

      if (sheetRes.status === 401 || sheetRes.status === 403) {
        res.status(403).json({
          error:
            'This Google Sheet is private. Set sharing to "Anyone with the link can view", use File > Share > Publish to web (CSV), or sign in with Google OAuth if configured.',
          code: 'SHEET_PERMISSION_DENIED',
        });
        return;
      }

      if (sheetRes.status === 404) {
        res.status(404).json({
          error: 'Spreadsheet not found. Verify the URL and make sure the document has not been deleted.',
        });
        return;
      }

      if (!sheetRes.ok) {
        res.status(sheetRes.status).json({
          error: `Unable to fetch Google Sheet (HTTP ${sheetRes.status}).`,
        });
        return;
      }

      const text = await sheetRes.text();
      if (contentType.includes('text/html') || text.trim().toLowerCase().startsWith('<!doctype html') || text.includes('accounts.google.com')) {
        res.status(403).json({
          error:
            'Access requires authentication — Google returned a sign-in page instead of CSV data. Make the sheet "Anyone with the link can view" or publish it as CSV.',
          code: 'SHEET_PERMISSION_DENIED',
        });
        return;
      }

      res.json({
        mode: 'csv_export',
        title: parsed.spreadsheetId ? `Google Sheet (${parsed.spreadsheetId.slice(0, 8)})` : 'Published Google Sheet',
        csvText: text,
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      res.status(e.statusCode || 500).json({ error: e.message || 'Failed to import Google Sheet.' });
    }
  });

  const httpServer = http.createServer(app);

  // Vite dev middleware or static dist serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`DataMind AI server listening on http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start DataMind AI server:', err);
  process.exit(1);
});
