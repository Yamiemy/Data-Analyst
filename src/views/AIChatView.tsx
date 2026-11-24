import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { ChartRenderer } from '../components/ChartRenderer';
import { DataTable } from '../components/DataTable';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { AnalysisSkeleton } from '../components/Skeleton';
import { useThemeCustomization } from '../context/ThemeContext';
import { executePlanDeterministically, validateExecutionResults } from '../engine/dataAnalyzer';
import { requestAnalysisPlan, requestAnalysisSynthesis } from '../services/aiService';
import type { AnalysisMode, ChatMessage, Dataset, NavSectionId } from '../types/data';

const ANALYSIS_MODES: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  { id: 'quick', label: 'Quick Analysis', hint: 'Fast direct calculation' },
  { id: 'exploratory', label: 'Exploratory', hint: 'Distributions & patterns' },
  { id: 'business', label: 'Business', hint: 'Revenue, segments & KPIs' },
  { id: 'statistical', label: 'Statistical', hint: 'Variance, quartiles & r' },
  { id: 'data_science', label: 'Data Science', hint: 'Drivers, outliers & caveats' },
];

interface AIChatViewProps {
  dataset: Dataset | null;
  messages: ChatMessage[];
  pendingQuestion: string | null;
  onClearPendingQuestion: () => void;
  onAddMessage: (msg: ChatMessage) => void;
  onClearHistory: () => void;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
  onRecordHistory: (title: string, summary: string) => void;
}

export const AIChatView: React.FC<AIChatViewProps> = ({
  dataset,
  messages,
  pendingQuestion,
  onClearPendingQuestion,
  onAddMessage,
  onClearHistory,
  onNavigate,
  onLoadSample,
  onRecordHistory,
}) => {
  const { accentHex } = useThemeCustomization();
  const [input, setInput] = useState('');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('exploratory');
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const suggestedPrompts = useMemo(() => {
    if (!dataset) return [];
    const numCols = dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name);
    const catCols = dataset.profile.columns.filter((c) => c.type === 'string' || c.type === 'boolean').map((c) => c.name);
    const dateCols = dataset.profile.columns.filter((c) => c.type === 'date').map((c) => c.name);

    const prompts: string[] = [
      'What are the main trends in this dataset?',
      'Summarize the key findings and give five actionable business recommendations.',
      'Are there any unusual values or outliers?',
    ];

    if (numCols[0] && catCols[0]) {
      prompts.unshift(`Which ${catCols[0]} contributes the highest ${numCols[0]}?`);
      prompts.push(`Compare detected anomalies by ${catCols[0]}`);
    }
    if (dateCols[0] && numCols[0]) {
      prompts.push(`What is the monthly trend of ${numCols[0]} over ${dateCols[0]}?`);
    }
    if (numCols.length >= 2) {
      prompts.push(`Is there a correlation between ${numCols[0]} and ${numCols[1]}?`);
    }
    if (numCols.length >= 1) {
      prompts.push('Show the highest-scoring anomalies and explain which features contribute most');
    }

    return prompts.slice(0, 6);
  }, [dataset]);

  const submitQuestion = async (questionText: string) => {
    if (!dataset || !questionText.trim() || loading) return;
    const trimmed = questionText.trim();

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
      analysisMode,
    };
    onAddMessage(userMsg);
    setInput('');
    setLoading(true);

    try {
      setLoadingStage('Inspecting schema & generating analysis plan...');
      const historyPayload = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const plan = await requestAnalysisPlan(dataset, trimmed, historyPayload, analysisMode);

      setLoadingStage('Computing deterministic results across dataset rows...');
      const computed = executePlanDeterministically(dataset, plan);
      const validationNote = validateExecutionResults(dataset, computed);

      setLoadingStage('Validating metrics & synthesizing insights...');
      const synthesis = await requestAnalysisSynthesis(dataset, trimmed, computed.results, historyPayload, analysisMode);

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: synthesis.answer,
        timestamp: new Date().toISOString(),
        analysisMode,
        keyTakeaway: synthesis.keyTakeaway,
        validationNote,
        methodology: synthesis.methodology,
        verifiedFindings: synthesis.verifiedFindings,
        assumptionsAndCaveats: synthesis.assumptionsAndCaveats,
        recommendations: synthesis.recommendations,
        followUpQuestions: synthesis.followUpQuestions,
        chart: computed.chart,
        table: computed.table,
      };
      onAddMessage(assistantMsg);
      onRecordHistory(trimmed.slice(0, 60), (synthesis.keyTakeaway || synthesis.answer).slice(0, 120));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unable to complete analysis request.';
      onAddMessage({
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        error: errorMsg,
      });
    } finally {
      setLoading(false);
      setLoadingStage('');
    }
  };

  useEffect(() => {
    if (pendingQuestion && dataset && !loading) {
      const q = pendingQuestion;
      onClearPendingQuestion();
      void submitQuestion(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, dataset]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, loading]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Ask anything about your data"
        description="Upload a CSV, Excel, JSON file, or Google Sheet to ask questions in natural language and inspect verified calculations and charts."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header & Analysis Mode Selector */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Ask anything about your data
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Schema-grounded planning, deterministic computation, result validation, and executive explanations.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
              {dataset.name} · {dataset.profile.rowCount.toLocaleString()} rows
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear chat
              </button>
            )}
          </div>
        </div>

        {/* 5 Analysis Modes */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Mode:
          </span>
          {ANALYSIS_MODES.map((m) => {
            const active = analysisMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setAnalysisMode(m.id)}
                title={m.hint}
                style={active ? { backgroundColor: accentHex, borderColor: accentHex } : undefined}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-white shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversation Thread */}
      <div className="flex-1 space-y-5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 min-h-[380px]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div
              className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60"
              style={{ color: accentHex }}
            >
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Ready to analyze {dataset.name}
            </h3>
            <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
              Every answer is computed deterministically over your {dataset.profile.rowCount.toLocaleString()} records before explanation—no invented metrics.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {msg.role === 'user' ? (
                <div
                  className="max-w-2xl rounded-2xl px-4 py-2.5 text-sm text-white"
                  style={{ backgroundColor: accentHex }}
                >
                  {msg.content}
                </div>
              ) : msg.error ? (
                <div className="w-full max-w-3xl rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    Analysis error
                  </div>
                  <p className="mt-1">{msg.error}</p>
                </div>
              ) : (
                <div className="w-full max-w-4xl space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-800 dark:bg-slate-950/50">
                  {msg.keyTakeaway && (
                    <div className="rounded-lg border border-indigo-200/80 bg-white px-3.5 py-2.5 dark:border-indigo-900/60 dark:bg-slate-900">
                      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: accentHex }}>
                        Key Takeaway
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {msg.keyTakeaway}
                      </div>
                    </div>
                  )}

                  <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-line">
                    {msg.content}
                  </div>

                  {msg.validationNote && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>{msg.validationNote}</span>
                    </div>
                  )}

                  {msg.methodology && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200/80 pt-3 dark:border-slate-800">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Methodology: </span>
                      {msg.methodology}
                    </div>
                  )}

                  {msg.verifiedFindings && msg.verifiedFindings.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Verified Data Findings
                      </div>
                      <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-5">
                        {msg.verifiedFindings.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {msg.chart && <ChartRenderer chart={msg.chart} height={280} />}

                  {msg.table && msg.table.rows.length > 0 && (
                    <DataTable
                      title="Computed Supporting Data"
                      columns={msg.table.columns}
                      rows={msg.table.rows}
                      pageSize={8}
                    />
                  )}

                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="space-y-2 border-t border-slate-200/80 pt-3 dark:border-slate-800">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Actionable Recommendations
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {msg.recommendations.map((rec, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{rec.title}</span>
                              <span className="text-[11px] font-medium" style={{ color: accentHex }}>
                                {rec.impact} impact
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{rec.action}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.assumptionsAndCaveats && msg.assumptionsAndCaveats.length > 0 && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">Assumptions &amp; Caveats: </span>
                      {msg.assumptionsAndCaveats.join(' · ')}
                    </div>
                  )}

                  {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {msg.followUpQuestions.map((fq, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => submitQuestion(fq)}
                          disabled={loading}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500 transition-colors text-left"
                        >
                          {fq}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {loading && <AnalysisSkeleton label={loadingStage} />}
        <div ref={bottomRef} />
      </div>

      {/* Input & Suggested Prompts */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuestion(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask a question about ${dataset.name}...`}
            disabled={loading}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-4 w-4" />
            Analyze
          </button>
        </form>

        {suggestedPrompts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => submitQuestion(prompt)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/40 hover:text-indigo-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-indigo-500 transition-colors text-left"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
