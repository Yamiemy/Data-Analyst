import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { DataTable } from '../components/DataTable';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { useThemeCustomization } from '../context/ThemeContext';
import { executeSafeSQLAsync } from '../engine/sqlEngine';
import { requestSQLGeneration } from '../services/aiService';
import type { Dataset, NavSectionId, SQLHistoryEntry, SQLResult } from '../types/data';

const SQL_KEYWORDS = new Set([
  'SELECT', 'WITH', 'DISTINCT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER',
  'ASC', 'DESC', 'LIMIT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE',
  'IS', 'NULL', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN',
  'ELSE', 'END', 'OVER', 'PARTITION', 'ROW_NUMBER', 'RANK', 'ROUND',
]);

function highlightSqlTokens(sql: string): React.ReactNode[] {
  const tokenRegex = /('[^']*'|"[^"]*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|--[^\n]*)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(sql)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t_${keyIdx++}`}>{sql.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('--')) {
      nodes.push(<span key={`c_${keyIdx++}`} className="text-slate-500 italic">{token}</span>);
    } else if (token.startsWith("'")) {
      nodes.push(<span key={`s_${keyIdx++}`} className="text-emerald-300">{token}</span>);
    } else if (token.startsWith('"')) {
      nodes.push(<span key={`q_${keyIdx++}`} className="text-sky-300">{token}</span>);
    } else if (/^\d/.test(token)) {
      nodes.push(<span key={`n_${keyIdx++}`} className="text-amber-300">{token}</span>);
    } else if (SQL_KEYWORDS.has(token.toUpperCase())) {
      nodes.push(<span key={`k_${keyIdx++}`} className="font-semibold text-indigo-400">{token}</span>);
    } else {
      nodes.push(<span key={`w_${keyIdx++}`} className="text-slate-100">{token}</span>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < sql.length) {
    nodes.push(<span key={`end_${keyIdx++}`}>{sql.slice(lastIndex)}</span>);
  }
  return nodes;
}

interface SQLAssistantViewProps {
  dataset: Dataset | null;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

export const SQLAssistantView: React.FC<SQLAssistantViewProps> = ({
  dataset,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex } = useThemeCustomization();
  const defaultSql = useMemo(() => {
    if (!dataset) return '';
    const cat = dataset.profile.columns.find((c) => c.type === 'string')?.name;
    const num = dataset.profile.columns.find((c) => c.type === 'number')?.name;
    if (cat && num) {
      return `SELECT "${cat}", COUNT(*) AS records, SUM("${num}") AS total_${num.toLowerCase().replace(/[^a-z0-9]/g, '_')}\nFROM dataset\nGROUP BY "${cat}"\nORDER BY total_${num.toLowerCase().replace(/[^a-z0-9]/g, '_')} DESC\nLIMIT 10;`;
    }
    return `SELECT *\nFROM dataset\nLIMIT 15;`;
  }, [dataset]);

  const [prompt, setPrompt] = useState('');
  const [sqlText, setSqlText] = useState('');
  const [explanation, setExplanation] = useState<string[]>([]);
  const [sqlResult, setSqlResult] = useState<SQLResult | null>(null);
  const [sqlHistory, setSqlHistory] = useState<SQLHistoryEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSqlText('');
    setExplanation([]);
    setSqlResult(null);
    setError(null);
  }, [dataset?.id]);

  const activeSql = sqlText || defaultSql;

  const syntaxStatus = useMemo(() => {
    const trimmed = activeSql.trim();
    if (!trimmed) return { valid: false, message: 'Enter a SELECT or WITH query' };
    if (/^\s*(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE)\b/i.test(trimmed)) {
      return { valid: false, message: 'Read-only violation: only SELECT/WITH queries permitted' };
    }
    if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
      return { valid: false, message: 'Query must begin with SELECT or WITH' };
    }
    if (!/\bFROM\s+["`\w]+/i.test(trimmed)) {
      return { valid: false, message: 'Specify FROM dataset' };
    }
    return { valid: true, message: 'Valid read-only SQLite query' };
  }, [activeSql]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="SQL Assistant"
        description="Upload a dataset to generate and execute read-only SQL queries directly against table `dataset`."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const pushSqlHistory = (sql: string, exec: SQLResult, queryPrompt?: string) => {
    setSqlHistory((prev) => [
      {
        id: `sql_${Date.now()}`,
        sql,
        timestamp: new Date().toISOString(),
        rowCount: exec.rowCount,
        executionTimeMs: exec.executionTimeMs,
        prompt: queryPrompt,
      },
      ...prev.filter((h) => h.sql !== sql).slice(0, 9),
    ]);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || generating || executing) return;
    setError(null);
    setGenerating(true);
    try {
      const res = await requestSQLGeneration(dataset, prompt.trim());
      setSqlText(res.sql);
      setExplanation(res.explanation);
      const exec = await executeSafeSQLAsync(dataset, res.sql);
      setSqlResult(exec);
      pushSqlHistory(res.sql, exec, prompt.trim());
      onRecordHistory(`SQL: ${prompt.trim().slice(0, 48)}`, `Returned ${exec.rowCount} rows in ${exec.executionTimeMs}ms.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate or execute SQL.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRunSql = async (sqlOverride?: string) => {
    const queryToRun = sqlOverride ?? activeSql;
    setError(null);
    setExecuting(true);
    try {
      const exec = await executeSafeSQLAsync(dataset, queryToRun);
      setSqlResult(exec);
      pushSqlHistory(queryToRun, exec);
      onRecordHistory('SQL Query Executed', `Returned ${exec.rowCount} rows in ${exec.executionTimeMs}ms.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SQL execution failed.');
    } finally {
      setExecuting(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(activeSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sampleAsk = dataset.profile.columns.find((c) => c.type === 'number')
    ? `Show the top 10 ${dataset.profile.columns.find((c) => c.type === 'string')?.name || 'records'} by total ${dataset.profile.columns.find((c) => c.type === 'number')?.name}`
    : 'Show the first 15 rows';

  return (
    <div className="space-y-6">
      {/* NL-to-SQL Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4" style={{ color: accentHex }} />
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ask in Plain English to Generate SQL
            </h3>
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">Table: dataset · Read-only SELECT</span>
        </div>

        <form onSubmit={handleGenerate} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`e.g. "${sampleAsk}"`}
            className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={generating || !prompt.trim()}
            style={{ backgroundColor: accentHex }}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate &amp; Run SQL
          </button>
        </form>
      </section>

      {/* Syntax-Highlighted SQL Editor */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
              SQL Query Editor
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                syntaxStatus.valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {syntaxStatus.message}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => void handleRunSql()}
              disabled={executing}
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {executing ? 'Running...' : 'Execute Query'}
            </button>
          </div>
        </div>

        <div className="relative bg-slate-950">
          <pre
            aria-hidden="true"
            className="pointer-events-none min-h-[152px] w-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-slate-100"
          >
            {highlightSqlTokens(activeSql)}
            {activeSql.endsWith('\n') ? ' ' : ''}
          </pre>
          <textarea
            value={activeSql}
            onChange={(e) => setSqlText(e.target.value)}
            rows={6}
            spellCheck={false}
            aria-label="SQL query editor"
            className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-6 text-transparent caret-white focus:outline-none selection:bg-indigo-500/30"
          />
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {(explanation.length > 0 || sqlResult) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {explanation.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                AI Step-by-Step Query Explanation
              </h4>
              <ol className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-decimal pl-4">
                {explanation.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {sqlResult && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {sqlResult.engineName || 'Relational Query Plan'}
                </h4>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {sqlResult.rowCount.toLocaleString()} rows · {sqlResult.executionTimeMs} ms
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {sqlResult.queryPlanSteps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {sqlResult && (
        <DataTable
          title="Query Results"
          columns={sqlResult.columns}
          rows={sqlResult.rows}
          pageSize={12}
        />
      )}

      {/* Query History */}
      {sqlHistory.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Recent SQL Queries ({sqlHistory.length})
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {sqlHistory.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  {item.prompt && (
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                      {item.prompt}
                    </div>
                  )}
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.sql.replace(/\s+/g, ' ')}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {item.rowCount} rows · {item.executionTimeMs}ms
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSqlText(item.sql);
                      void handleRunSql(item.sql);
                    }}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Re-run
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
