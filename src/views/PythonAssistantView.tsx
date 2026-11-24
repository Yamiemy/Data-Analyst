import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import {
  AlertCircle,
  Check,
  Code2,
  Copy,
  Download,
  Loader2,
  Play,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { useThemeCustomization } from '../context/ThemeContext';
import { requestPythonGeneration } from '../services/aiService';
import type { Dataset, NavSectionId } from '../types/data';

interface PythonAssistantViewProps {
  dataset: Dataset | null;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

const PY_KEYWORDS = new Set([
  'import', 'from', 'as', 'def', 'return', 'if', 'elif', 'else', 'for', 'in', 'while',
  'try', 'except', 'finally', 'with', 'class', 'True', 'False', 'None', 'and', 'or',
  'not', 'is', 'lambda', 'pass', 'break', 'continue', 'print',
]);

function highlightPythonTokens(code: string): React.ReactNode[] {
  const tokenRegex = /(#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'[^'\n]*'|"[^"\n]*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t_${keyIdx++}`}>{code.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('#')) {
      nodes.push(<span key={`c_${keyIdx++}`} className="text-slate-500 italic">{token}</span>);
    } else if (token.startsWith("'") || token.startsWith('"')) {
      nodes.push(<span key={`s_${keyIdx++}`} className="text-emerald-300">{token}</span>);
    } else if (/^\d/.test(token)) {
      nodes.push(<span key={`n_${keyIdx++}`} className="text-amber-300">{token}</span>);
    } else if (PY_KEYWORDS.has(token)) {
      nodes.push(<span key={`k_${keyIdx++}`} className="font-semibold text-indigo-400">{token}</span>);
    } else {
      nodes.push(<span key={`w_${keyIdx++}`} className="text-slate-100">{token}</span>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < code.length) {
    nodes.push(<span key={`end_${keyIdx++}`}>{code.slice(lastIndex)}</span>);
  }
  return nodes;
}

interface PyodideInterface {
  FS: { writeFile: (path: string, data: string) => void };
  loadPackagesFromImports: (code: string) => Promise<void>;
  loadPackage: (pkgs: string | string[]) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>;
    __datamindPyodidePromise?: Promise<PyodideInterface>;
  }
}

async function getPyodideRuntime(): Promise<PyodideInterface> {
  if (window.__datamindPyodidePromise) {
    return window.__datamindPyodidePromise;
  }
  window.__datamindPyodidePromise = (async () => {
    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Could not load browser Python runtime (Pyodide CDN unreachable or blocked offline).'));
        document.head.appendChild(script);
      });
    }
    if (!window.loadPyodide) {
      throw new Error('Pyodide bootstrapper failed to initialize on window.');
    }
    const py = await window.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
    });
    return py;
  })().catch((err) => {
    window.__datamindPyodidePromise = undefined;
    throw err;
  });
  return window.__datamindPyodidePromise;
}

export const PythonAssistantView: React.FC<PythonAssistantViewProps> = ({
  dataset,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex } = useThemeCustomization();
  const defaultCode = useMemo(() => {
    if (!dataset) return '';
    const numCols = dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name);
    const catCol = dataset.profile.columns.find((c) => c.type === 'string')?.name;
    return `import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Load active dataset (dataset.csv is automatically mounted in the browser sandbox)
df = pd.read_csv("${dataset.name}")
print(f"Shape: {df.shape}")
print(df.describe(include="all"))

# Missing values overview
print("\\nMissing Values:\\n", df.isnull().sum())
${
  catCol && numCols[0]
    ? `
# Group summary: ${numCols[0]} by ${catCol}
summary = df.groupby("${catCol}")["${numCols[0]}"].agg(["count", "sum", "mean", "median"]).sort_values("sum", ascending=False)
print("\\nTop Segments:\\n", summary.head(10))

plt.figure(figsize=(9, 4.5))
top = summary.head(10)
plt.bar(top.index.astype(str), top["sum"], color="#4F46E5")
plt.title("Total ${numCols[0]} by ${catCol}")
plt.xticks(rotation=30, ha="right")
plt.tight_layout()
plt.show()`
    : ''
}`;
  }, [dataset]);

  const [taskPrompt, setTaskPrompt] = useState('');
  const [code, setCode] = useState('');
  const [libraries, setLibraries] = useState<string[]>(['pandas', 'numpy', 'matplotlib', 'scikit-learn']);
  const [explanation, setExplanation] = useState<string[]>([
    'Loads the active CSV file into a pandas DataFrame and prints dimensions plus summary statistics.',
    'Audits null counts per column across the schema.',
    'Computes grouped aggregations and plots a Matplotlib chart.',
  ]);
  const [expectedOutput, setExpectedOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [runStatus, setRunStatus] = useState<string>('');
  const [runStdout, setRunStdout] = useState<string>('');
  const [runStderr, setRunStderr] = useState<string>('');
  const [runPlots, setRunPlots] = useState<string[]>([]);
  const [runDurationMs, setRunDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const highlightPreRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setCode('');
    setExpectedOutput('');
    setRunStdout('');
    setRunStderr('');
    setRunPlots([]);
    setRunDurationMs(null);
    setRunStatus('');
    setError(null);
  }, [dataset?.id]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Python Data Analysis Assistant"
        description="Upload a dataset to generate tailored pandas, NumPy, Matplotlib, Seaborn, and scikit-learn analysis scripts and execute them in an in-browser Python sandbox."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const displayedCode = code || defaultCode;
  const displayedExpected =
    expectedOutput ||
    `DataFrame shape (${dataset.profile.rowCount}, ${dataset.profile.columnCount}), ${dataset.profile.missingCells} total missing cells, and summary metrics aligned with ${dataset.name}.`;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskPrompt.trim() || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await requestPythonGeneration(dataset, taskPrompt.trim());
      setCode(res.code);
      setLibraries(res.libraries);
      setExplanation(res.explanation);
      setExpectedOutput(res.expectedOutput);
      onRecordHistory(`Python Script: ${taskPrompt.trim().slice(0, 44)}`, `Libraries: ${res.libraries.join(', ')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate Python code.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunInSandbox = async () => {
    if (!dataset || executing) return;
    setError(null);
    setRunStdout('');
    setRunStderr('');
    setRunPlots([]);
    setRunDurationMs(null);
    setExecuting(true);

    const started = performance.now();
    try {
      setRunStatus('Initializing Python WebAssembly runtime (Pyodide)...');
      const py = await getPyodideRuntime();

      setRunStatus('Mounting active dataset CSV and resolving scientific packages...');
      const csvText = Papa.unparse(dataset.rows, { columns: dataset.columns });
      const safeFileName = dataset.name.replace(/[/\\]/g, '_');
      py.FS.writeFile('/home/pyodide/dataset.csv', csvText);
      py.FS.writeFile(`/home/pyodide/${safeFileName}`, csvText);

      // Proactively load pandas/numpy/matplotlib plus any imports in user script
      await py.loadPackage(['pandas', 'numpy', 'matplotlib']);
      await py.loadPackagesFromImports(displayedCode);

      setRunStatus('Executing script inside isolated sandbox...');
      const harness = `
import os, sys, io, base64, json, traceback
os.chdir('/home/pyodide')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

_dm_stdout = io.StringIO()
_dm_stderr = io.StringIO()
_dm_plots = []

def _dm_capture_show(*args, **kwargs):
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=130)
        buf.seek(0)
        _dm_plots.append(base64.b64encode(buf.read()).decode('ascii'))
    plt.close('all')

plt.show = _dm_capture_show

_orig_out, _orig_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _dm_stdout, _dm_stderr
_dm_code = ${JSON.stringify(displayedCode)}

try:
    exec(compile(_dm_code, 'analysis_pipeline.py', 'exec'), {'__name__': '__main__'})
    if plt.get_fignums():
        _dm_capture_show()
except Exception:
    traceback.print_exc(file=_dm_stderr)
finally:
    sys.stdout, sys.stderr = _orig_out, _orig_err

json.dumps({
    'stdout': _dm_stdout.getvalue(),
    'stderr': _dm_stderr.getvalue(),
    'plots': _dm_plots,
})
`;
      const rawJson = String(await py.runPythonAsync(harness));
      const parsed = JSON.parse(rawJson) as { stdout: string; stderr: string; plots: string[] };
      const elapsed = Math.round(performance.now() - started);

      setRunStdout(parsed.stdout || '');
      setRunStderr(parsed.stderr || '');
      setRunPlots(Array.isArray(parsed.plots) ? parsed.plots : []);
      setRunDurationMs(elapsed);

      onRecordHistory(
        `Python Sandbox Run (${dataset.name})`,
        parsed.stderr
          ? `Completed with stderr diagnostics in ${elapsed}ms`
          : `Executed cleanly in ${elapsed}ms (${parsed.plots?.length || 0} plot(s))`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? `Sandbox execution failed: ${err.message}`
          : 'Unable to execute Python script in browser sandbox.'
      );
    } finally {
      setExecuting(false);
      setRunStatus('');
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadPy = () => {
    const blob = new Blob([displayedCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '')}_analysis.py`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadIpynb = () => {
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: [`# DataMind AI Analysis Notebook — ${dataset.name}\n`, `\nLibraries: ${libraries.join(', ')}`],
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: displayedCode.split('\n').map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line)),
        },
      ],
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python', version: '3.10' },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
    const blob = new Blob([JSON.stringify(notebook, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '')}_notebook.ipynb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const quickTasks = [
    'Clean missing values, detect IQR outliers, and plot distributions',
    'Build a scikit-learn Random Forest pipeline with cross-validation',
    'Compute correlation matrix and pairwise numeric summary with Matplotlib plot',
    'Perform segmentation with K-Means and StandardScaler using scikit-learn',
  ];

  return (
    <div className="space-y-6">
      {/* Task Input */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4" style={{ color: accentHex }} />
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Generate &amp; Execute Python Data Science Code
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {libraries.join(' · ')}
          </span>
        </div>

        <form onSubmit={handleGenerate} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Describe the analysis, feature engineering, or ML script you want..."
            className="min-w-[240px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={loading || !taskPrompt.trim()}
            style={{ backgroundColor: accentHex }}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate Python
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickTasks.map((qt) => (
            <button
              key={qt}
              type="button"
              onClick={() => setTaskPrompt(qt)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
            >
              {qt}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Syntax-Highlighted Code Editor & Actions */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
              analysis_pipeline.py
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Mounted files: <code className="font-mono">dataset.csv</code>, <code className="font-mono">{dataset.name}</code>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              .py
            </button>
            <button
              type="button"
              onClick={handleDownloadIpynb}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              .ipynb Notebook
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy Code'}
            </button>
            <button
              type="button"
              onClick={handleRunInSandbox}
              disabled={executing}
              style={{ backgroundColor: accentHex }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {executing ? 'Running...' : 'Run in Browser Sandbox'}
            </button>
          </div>
        </div>

        <div className="relative bg-slate-950">
          <pre
            ref={highlightPreRef}
            aria-hidden="true"
            className="pointer-events-none m-0 h-[340px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed"
          >
            {highlightPythonTokens(displayedCode)}
          </pre>
          <textarea
            value={displayedCode}
            onChange={(e) => setCode(e.target.value)}
            onScroll={(e) => {
              if (highlightPreRef.current) {
                highlightPreRef.current.scrollTop = e.currentTarget.scrollTop;
                highlightPreRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            spellCheck={false}
            aria-label="Python code editor"
            className="absolute inset-0 h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-relaxed text-transparent caret-indigo-400 focus:outline-none selection:bg-indigo-500/30"
          />
        </div>
      </section>

      {/* Sandbox Execution Output */}
      {(executing || runStdout || runStderr || runPlots.length > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4" style={{ color: accentHex }} />
              <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Pyodide Sandbox Output
              </h4>
            </div>
            {runDurationMs !== null && (
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                Completed in {runDurationMs} ms · Isolated WebAssembly Python 3.12
              </span>
            )}
          </div>

          {executing && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: accentHex }} />
              <span>{runStatus || 'Running Python code in browser sandbox...'}</span>
            </div>
          )}

          {runStdout && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Standard Output (stdout)
              </div>
              <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-emerald-200 dark:border-slate-800">
                {runStdout}
              </pre>
            </div>
          )}

          {runStderr && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-500">
                Standard Error / Traceback (stderr)
              </div>
              <pre className="max-h-60 overflow-auto rounded-lg border border-red-200 bg-red-950/90 p-3.5 font-mono text-xs leading-relaxed text-red-200 dark:border-red-900/60">
                {runStderr}
              </pre>
            </div>
          )}

          {runPlots.length > 0 && (
            <div className="space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Captured Matplotlib Figures ({runPlots.length})
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {runPlots.map((b64, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800"
                  >
                    <img
                      src={`data:image/png;base64,${b64}`}
                      alt={`Python generated plot ${i + 1}`}
                      className="w-full h-auto rounded-lg"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Explanation & Expected Output */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Code Walkthrough
          </h4>
          <ol className="mt-2.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 list-decimal pl-4">
            {explanation.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Expected Output Summary
          </h4>
          <p className="mt-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-line">
            {displayedExpected}
          </p>
          <p className="mt-3 text-[11px] text-slate-400">
            Execution runs client-side in an isolated Pyodide WebAssembly sandbox when clicked (never against the host OS), or download as .py / .ipynb for local Jupyter workflows.
          </p>
        </div>
      </section>
    </div>
  );
};
