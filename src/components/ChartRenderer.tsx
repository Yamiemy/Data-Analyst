import React, { useRef, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { ChevronDown, Download, Maximize2, X } from 'lucide-react';
import { useThemeCustomization } from '../context/ThemeContext';
import { exportChartAsPDF, exportChartAsPNG } from '../engine/reportExporter';
import type { ChartSpec } from '../types/data';

interface ChartRendererProps {
  chart: ChartSpec;
  height?: number;
  compact?: boolean;
  colors?: string[];
}

function formatAxisVal(v: unknown): string {
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return String(Number(v.toFixed(2)));
  }
  const s = String(v ?? '');
  return s.length > 16 ? s.slice(0, 15) + '…' : s;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({
  chart,
  height = 300,
  compact = false,
  colors,
}) => {
  const { chartColors, accentHex } = useThemeCustomization();
  const palette = colors && colors.length > 0 ? colors : chartColors;

  const containerRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const getActiveSvg = (): SVGSVGElement | null => {
    const root = expanded ? modalRef.current : containerRef.current;
    return root?.querySelector('.recharts-wrapper svg') || root?.querySelector('svg') || null;
  };

  const handleDownloadSVG = () => {
    const svg = getActiveSvg();
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chart.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadMenuOpen(false);
  };

  const handleDownloadPNG = async () => {
    const svg = getActiveSvg();
    if (!svg) return;
    await exportChartAsPNG(svg, chart.title);
    setDownloadMenuOpen(false);
  };

  const handleDownloadPDF = async () => {
    const svg = getActiveSvg();
    if (!svg) return;
    await exportChartAsPDF(svg, chart.title, chart.description, accentHex);
    setDownloadMenuOpen(false);
  };

  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  const renderChartBody = (chartHeight: number) => {
    if (!chart.data || chart.data.length === 0) {
      return (
        <div className="flex items-center justify-center h-48 text-sm text-slate-500 dark:text-slate-400">
          No chartable data available for this selection.
        </div>
      );
    }

    const yKey = chart.yKeys[0];

    if (chart.type === 'boxplot') {
      const boxRows = chart.data
        .map((d) => ({
          label: String(d[chart.xKey] ?? ''),
          min: Number(d.min ?? 0),
          q1: Number(d.q1 ?? 0),
          median: Number(d.median ?? 0),
          q3: Number(d.q3 ?? 0),
          max: Number(d.max ?? 0),
        }))
        .filter((r) => [r.min, r.q1, r.median, r.q3, r.max].every(Number.isFinite));

      if (boxRows.length === 0) {
        return (
          <div className="flex items-center justify-center h-48 text-sm text-slate-500 dark:text-slate-400">
            Insufficient numeric quartiles for Box Plot.
          </div>
        );
      }

      const W = 720;
      const H = Math.max(240, chartHeight);
      const pad = { top: 24, right: 24, bottom: 50, left: 62 };
      const plotW = W - pad.left - pad.right;
      const plotH = H - pad.top - pad.bottom;

      const globalMin = Math.min(...boxRows.map((r) => r.min));
      const globalMax = Math.max(...boxRows.map((r) => r.max));
      const span = globalMax - globalMin || 1;
      const yMin = globalMin - span * 0.08;
      const yMax = globalMax + span * 0.08;
      const toY = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

      const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
      const bandW = plotW / boxRows.length;
      const boxW = Math.min(44, Math.max(18, bandW * 0.45));

      return (
        <div className="relative">
          {hoverInfo && (
            <div className="mb-2 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-mono text-slate-100 dark:bg-slate-800">
              {hoverInfo}
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" style={{ maxHeight: chartHeight }}>
            {ticks.map((t, idx) => {
              const py = toY(t);
              return (
                <g key={idx}>
                  <line x1={pad.left} y1={py} x2={W - pad.right} y2={py} stroke="rgba(148,163,184,0.22)" strokeDasharray="3 3" />
                  <text x={pad.left - 8} y={py + 4} textAnchor="end" fontSize="10" fill="#64748B">
                    {formatAxisVal(t)}
                  </text>
                </g>
              );
            })}
            <line x1={pad.left} y1={pad.top + plotH} x2={W - pad.right} y2={pad.top + plotH} stroke="#94A3B8" strokeWidth="1" />
            {boxRows.map((r, idx) => {
              const cx = pad.left + bandW * idx + bandW / 2;
              const color = palette[idx % palette.length];
              const yMaxP = toY(r.max);
              const yQ3 = toY(r.q3);
              const yMed = toY(r.median);
              const yQ1 = toY(r.q1);
              const yMinP = toY(r.min);
              const rectH = Math.max(2, yQ1 - yQ3);
              return (
                <g
                  key={r.label + idx}
                  className="cursor-pointer"
                  onMouseEnter={() =>
                    setHoverInfo(
                      `${r.label}: Min ${formatAxisVal(r.min)} · Q1 ${formatAxisVal(r.q1)} · Median ${formatAxisVal(r.median)} · Q3 ${formatAxisVal(r.q3)} · Max ${formatAxisVal(r.max)}`
                    )
                  }
                  onMouseLeave={() => setHoverInfo(null)}
                >
                  <line x1={cx} y1={yMaxP} x2={cx} y2={yMinP} stroke={color} strokeWidth="1.75" />
                  <line x1={cx - boxW * 0.35} y1={yMaxP} x2={cx + boxW * 0.35} y2={yMaxP} stroke={color} strokeWidth="1.75" />
                  <line x1={cx - boxW * 0.35} y1={yMinP} x2={cx + boxW * 0.35} y2={yMinP} stroke={color} strokeWidth="1.75" />
                  <rect
                    x={cx - boxW / 2}
                    y={yQ3}
                    width={boxW}
                    height={rectH}
                    rx="3"
                    fill={color}
                    fillOpacity="0.28"
                    stroke={color}
                    strokeWidth="2"
                  />
                  <line x1={cx - boxW / 2} y1={yMed} x2={cx + boxW / 2} y2={yMed} stroke="#0F172A" strokeWidth="2.5" />
                  <text x={cx} y={pad.top + plotH + 16} textAnchor="middle" fontSize="11" fill="#64748B">
                    {formatAxisVal(r.label)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      );
    }

    if (chart.type === 'heatmap') {
      const yField = 'yCategory';
      const valField = yKey || 'value';
      const xLabels = Array.from(new Set(chart.data.map((d) => String(d[chart.xKey] ?? '')))).slice(0, 12);
      const yLabels = Array.from(new Set(chart.data.map((d) => String(d[yField] ?? '')))).slice(0, 10);
      const valMap = new Map<string, number>();
      let minV = Infinity;
      let maxV = -Infinity;

      for (const d of chart.data) {
        const xv = String(d[chart.xKey] ?? '');
        const yv = String(d[yField] ?? '');
        const n = Number(d[valField] ?? 0);
        if (Number.isFinite(n)) {
          valMap.set(`${xv}|${yv}`, n);
          if (n < minV) minV = n;
          if (n > maxV) maxV = n;
        }
      }
      if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
        minV = 0;
        maxV = 1;
      }

      const W = 720;
      const H = Math.max(240, chartHeight);
      const pad = { top: 20, right: 20, bottom: 48, left: 105 };
      const plotW = W - pad.left - pad.right;
      const plotH = H - pad.top - pad.bottom;
      const cellW = plotW / Math.max(1, xLabels.length);
      const cellH = plotH / Math.max(1, yLabels.length);
      const baseHex = palette[0] || '#4F46E5';

      return (
        <div className="relative">
          {hoverInfo && (
            <div className="mb-2 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-mono text-slate-100 dark:bg-slate-800">
              {hoverInfo}
            </div>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible" style={{ maxHeight: chartHeight }}>
            {yLabels.map((yl, rIdx) => (
              <g key={yl}>
                <text
                  x={pad.left - 8}
                  y={pad.top + rIdx * cellH + cellH / 2 + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748B"
                >
                  {yl.length > 14 ? yl.slice(0, 13) + '…' : yl}
                </text>
                {xLabels.map((xl, cIdx) => {
                  const v = valMap.get(`${xl}|${yl}`) ?? 0;
                  const ratio = maxV === minV ? 0.5 : (v - minV) / (maxV - minV);
                  const opacity = Number((0.12 + ratio * 0.8).toFixed(2));
                  return (
                    <g
                      key={xl + yl}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverInfo(`${yl} × ${xl}: ${v.toLocaleString()}`)}
                      onMouseLeave={() => setHoverInfo(null)}
                    >
                      <rect
                        x={pad.left + cIdx * cellW + 1}
                        y={pad.top + rIdx * cellH + 1}
                        width={Math.max(4, cellW - 2)}
                        height={Math.max(4, cellH - 2)}
                        rx="3"
                        fill={baseHex}
                        fillOpacity={opacity}
                      />
                      {cellW > 36 && cellH > 20 && (
                        <text
                          x={pad.left + cIdx * cellW + cellW / 2}
                          y={pad.top + rIdx * cellH + cellH / 2 + 4}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="600"
                          fill={ratio > 0.55 ? '#FFFFFF' : '#334155'}
                        >
                          {formatAxisVal(v)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            {xLabels.map((xl, cIdx) => (
              <text
                key={xl}
                x={pad.left + cIdx * cellW + cellW / 2}
                y={pad.top + plotH + 18}
                textAnchor="middle"
                fontSize="10"
                fill="#64748B"
              >
                {xl.length > 12 ? xl.slice(0, 11) + '…' : xl}
              </text>
            ))}
          </svg>
        </div>
      );
    }

    if (chart.type === 'horizontal_bar') {
      return (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={chart.data} layout="vertical" margin={{ top: 8, right: 24, left: 24, bottom: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis type="number" tickFormatter={formatAxisVal} tick={{ fontSize: 11, fill: '#64748B' }} />
            <YAxis
              type="category"
              dataKey={chart.xKey}
              width={110}
              tickFormatter={formatAxisVal}
              tick={{ fontSize: 11, fill: '#64748B' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {chart.yKeys.map((yk, idx) => (
              <Bar key={yk} dataKey={yk} fill={palette[idx % palette.length]} radius={[0, 4, 4, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === 'line') {
      return (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <LineChart data={chart.data} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis
              dataKey={chart.xKey}
              tickFormatter={formatAxisVal}
              tick={{ fontSize: 11, fill: '#64748B' }}
              label={chart.xLabel ? { value: chart.xLabel, position: 'insideBottom', offset: -12, fontSize: 11, fill: '#64748B' } : undefined}
            />
            <YAxis
              tickFormatter={formatAxisVal}
              tick={{ fontSize: 11, fill: '#64748B' }}
              label={chart.yLabel ? { value: chart.yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748B' } : undefined}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
            {chart.yKeys.map((yk, idx) => (
              <Line
                key={yk}
                type="monotone"
                dataKey={yk}
                stroke={palette[idx % palette.length]}
                strokeWidth={2.2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === 'area') {
      return (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <AreaChart data={chart.data} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <defs>
              {chart.yKeys.map((yk, idx) => (
                <linearGradient key={yk} id={`grad_${idx}_${chart.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={palette[idx % palette.length]} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={palette[idx % palette.length]} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey={chart.xKey} tickFormatter={formatAxisVal} tick={{ fontSize: 11, fill: '#64748B' }} />
            <YAxis tickFormatter={formatAxisVal} tick={{ fontSize: 11, fill: '#64748B' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            {chart.yKeys.map((yk, idx) => (
              <Area
                key={yk}
                type="monotone"
                dataKey={yk}
                stroke={palette[idx % palette.length]}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#grad_${idx}_${chart.id})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === 'pie' || chart.type === 'donut') {
      return (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <PieChart>
            <Pie
              data={chart.data.slice(0, 10)}
              dataKey={yKey}
              nameKey={chart.xKey}
              cx="50%"
              cy="50%"
              innerRadius={chart.type === 'donut' ? '48%' : 0}
              outerRadius="78%"
              paddingAngle={2}
            >
              {chart.data.slice(0, 10).map((_, idx) => (
                <Cell key={idx} fill={palette[idx % palette.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chart.type === 'scatter') {
      return (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis
              type="number"
              dataKey={chart.xKey}
              name={chart.xLabel || chart.xKey}
              tickFormatter={formatAxisVal}
              tick={{ fontSize: 11, fill: '#64748B' }}
            />
            <YAxis
              type="number"
              dataKey={yKey}
              name={chart.yLabel || yKey}
              tickFormatter={formatAxisVal}
              tick={{ fontSize: 11, fill: '#64748B' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              contentStyle={{
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Scatter name={`${chart.xKey} vs ${yKey}`} data={chart.data} fill={palette[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chart.data} margin={{ top: 10, right: 20, left: 10, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis
            dataKey={chart.xKey}
            tickFormatter={formatAxisVal}
            tick={{ fontSize: 11, fill: '#64748B' }}
            label={chart.xLabel ? { value: chart.xLabel, position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748B' } : undefined}
          />
          <YAxis
            tickFormatter={formatAxisVal}
            tick={{ fontSize: 11, fill: '#64748B' }}
            label={chart.yLabel ? { value: chart.yLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748B' } : undefined}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0F172A',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#F8FAFC',
              fontSize: '12px',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
          {chart.yKeys.map((yk, idx) => (
            <Bar
              key={yk}
              dataKey={yk}
              fill={palette[idx % palette.length]}
              radius={[4, 4, 0, 0]}
              barSize={chart.type === 'histogram' ? 32 : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <>
      <div
        ref={containerRef}
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {chart.title}
            </h4>
            {!compact && chart.description && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{chart.description}</p>
            )}
          </div>
          <div className="relative flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setDownloadMenuOpen((o) => !o)}
              title="Download chart (PDF, PNG, SVG)"
              aria-label="Download chart options"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export</span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {downloadMenuOpen && (
              <div className="absolute right-8 top-full z-30 mt-1 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPNG}
                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Download PNG
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSVG}
                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Download SVG
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setDownloadMenuOpen(false);
                setExpanded(true);
              }}
              title="Expand chart"
              aria-label="Expand chart"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {renderChartBody(height)}
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs">
          <div
            ref={modalRef}
            className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {chart.title}
                </h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{chart.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  style={{ backgroundColor: accentHex }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPNG}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  PNG
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSVG}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  SVG
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Close expanded chart"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {renderChartBody(460)}
          </div>
        </div>
      )}
    </>
  );
};
