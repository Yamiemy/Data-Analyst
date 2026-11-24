import React, { useMemo, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { ChartRenderer } from '../components/ChartRenderer';
import { EmptyDatasetState } from '../components/EmptyDatasetState';
import { CHART_PALETTE_PRESETS, useThemeCustomization } from '../context/ThemeContext';
import { buildHistogramBins, executePlanDeterministically } from '../engine/dataAnalyzer';
import { parseNumericValue } from '../engine/parser';
import type { ChartSpec, ChartType, Dataset, NavSectionId } from '../types/data';

interface VisualizationsViewProps {
  dataset: Dataset | null;
  onNavigate: (section: NavSectionId) => void;
  onLoadSample: () => void;
}

export const VisualizationsView: React.FC<VisualizationsViewProps> = ({
  dataset,
  onNavigate,
  onLoadSample,
}) => {
  const { chartPaletteId, chartColors, setChartPaletteId, setCustomChartColors } = useThemeCustomization();
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xCol, setXCol] = useState<string>('');
  const [yCol, setYCol] = useState<string>('');
  const [agg, setAgg] = useState<'sum' | 'avg' | 'count' | 'min' | 'max'>('sum');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc' | 'natural'>('desc');
  const [filterCol, setFilterCol] = useState<string>('');
  const [filterVal, setFilterVal] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customSubtitle, setCustomSubtitle] = useState<string>('');
  const [customPrimaryColor, setCustomPrimaryColor] = useState<string | null>(null);
  const [customSecondaryColor, setCustomSecondaryColor] = useState<string | null>(null);

  const effectiveChartColors = useMemo(() => {
    if (!customPrimaryColor && !customSecondaryColor) return undefined;
    const next = [...chartColors];
    if (customPrimaryColor) next[0] = customPrimaryColor;
    if (customSecondaryColor) next[1] = customSecondaryColor;
    return next;
  }, [chartColors, customPrimaryColor, customSecondaryColor]);

  const numCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'number').map((c) => c.name) : []),
    [dataset]
  );
  const catCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'string' || c.type === 'boolean').map((c) => c.name) : []),
    [dataset]
  );
  const dateCols = useMemo(
    () => (dataset ? dataset.profile.columns.filter((c) => c.type === 'date').map((c) => c.name) : []),
    [dataset]
  );

  const filterValues = useMemo(() => {
    if (!dataset || !filterCol) return [];
    const uniq = new Set<string>();
    for (const row of dataset.rows) {
      const v = row[filterCol];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        uniq.add(String(v).trim());
        if (uniq.size >= 30) break;
      }
    }
    return Array.from(uniq).sort();
  }, [dataset, filterCol]);

  const filteredDataset = useMemo(() => {
    if (!dataset || !filterCol || !filterVal) return dataset;
    const rows = dataset.rows.filter((r) => String(r[filterCol] ?? '').trim() === filterVal);
    return { ...dataset, rows };
  }, [dataset, filterCol, filterVal]);

  const effectiveX = xCol && dataset?.columns.includes(xCol) ? xCol : catCols[0] || dateCols[0] || dataset?.columns[0] || '';
  const effectiveY = yCol && dataset?.columns.includes(yCol) ? yCol : numCols[0] || dataset?.columns[1] || dataset?.columns[0] || '';

  const customChart: ChartSpec | null = useMemo(() => {
    if (!filteredDataset || !effectiveX || !effectiveY) return null;

    const filterSuffix = filterCol && filterVal ? ` (Filtered: ${filterCol} = ${filterVal})` : '';
    const applyCustomMeta = (spec: ChartSpec): ChartSpec => ({
      ...spec,
      title: customTitle.trim() || spec.title,
      description: customSubtitle.trim() || `${spec.description}${filterSuffix}`,
    });

    if (chartType === 'scatter') {
      const pairs: Array<Record<string, string | number | null>> = [];
      for (const row of filteredDataset.rows.slice(0, 300)) {
        const xv = parseNumericValue(row[effectiveX]);
        const yv = parseNumericValue(row[effectiveY]);
        if (xv !== null && yv !== null) {
          pairs.push({ [effectiveX]: xv, [effectiveY]: yv });
        }
      }
      return applyCustomMeta({
        id: 'custom_scatter',
        type: 'scatter',
        title: `${effectiveX} vs ${effectiveY}`,
        description: `Scatter relationship across ${pairs.length} paired records.`,
        xKey: effectiveX,
        yKeys: [effectiveY],
        xLabel: effectiveX,
        yLabel: effectiveY,
        data: pairs,
      });
    }

    if (chartType === 'histogram') {
      const targetProf =
        filteredDataset.profile.columns.find((c) => c.name === effectiveY) ||
        filteredDataset.profile.columns.find((c) => c.type === 'number');
      if (!targetProf) return null;
      const bins = buildHistogramBins(filteredDataset.rows, targetProf, 12);
      return applyCustomMeta({
        id: 'custom_hist',
        type: 'histogram',
        title: `Distribution of ${targetProf.name}`,
        description: `12-bin frequency histogram across ${filteredDataset.rows.length.toLocaleString()} records.`,
        xKey: 'range',
        yKeys: ['count'],
        xLabel: targetProf.name,
        yLabel: 'Frequency',
        data: bins,
      });
    }

    if (chartType === 'boxplot') {
      const boxData = filteredDataset.profile.columns
        .filter((c) => c.type === 'number')
        .slice(0, 6)
        .map((c) => {
          const vals = filteredDataset.rows
            .map((r) => parseNumericValue(r[c.name]))
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b);
          if (vals.length === 0) return null;
          const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
          return {
            Column: c.name,
            min: vals[0],
            q1: q(0.25),
            median: q(0.5),
            q3: q(0.75),
            max: vals[vals.length - 1],
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      return applyCustomMeta({
        id: 'custom_boxplot',
        type: 'boxplot',
        title: 'Box Plot: Spread & Quartiles Across Numeric Columns',
        description: 'Whiskers show Min–Max; box spans Q1–Q3 with bold Median line.',
        xKey: 'Column',
        yKeys: ['median'],
        xLabel: 'Numeric Column',
        yLabel: 'Value',
        data: boxData,
      });
    }

    if (chartType === 'heatmap') {
      const yCat = catCols.find((c) => c !== effectiveX) || catCols[0] || effectiveX;
      const metricCol = numCols.includes(effectiveY) ? effectiveY : numCols[0];
      const cellMap = new Map<string, number[]>();
      const xSeen = new Set<string>();
      const ySeen = new Set<string>();

      for (const row of filteredDataset.rows) {
        const xv = String(row[effectiveX] ?? '(Missing)').trim();
        const yv = String(row[yCat] ?? '(Missing)').trim();
        xSeen.add(xv);
        ySeen.add(yv);
        const key = `${xv}|||${yv}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        const val = metricCol ? parseNumericValue(row[metricCol]) : 1;
        if (val !== null) cellMap.get(key)!.push(val);
      }

      const xTop = Array.from(xSeen).slice(0, 10);
      const yTop = Array.from(ySeen).slice(0, 8);
      const heatRows: Array<Record<string, string | number | null>> = [];

      for (const yVal of yTop) {
        for (const xVal of xTop) {
          const vals = cellMap.get(`${xVal}|||${yVal}`) || [];
          let computed = vals.length;
          if (metricCol && agg !== 'count' && vals.length > 0) {
            if (agg === 'sum') computed = Number(vals.reduce((a, b) => a + b, 0).toFixed(1));
            else if (agg === 'avg') computed = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
            else if (agg === 'min') computed = Math.min(...vals);
            else if (agg === 'max') computed = Math.max(...vals);
          }
          heatRows.push({
            [effectiveX]: xVal,
            yCategory: yVal,
            value: computed,
          });
        }
      }

      return applyCustomMeta({
        id: 'custom_heatmap',
        type: 'heatmap',
        title: `2D Heatmap: ${yCat} × ${effectiveX} (${agg.toUpperCase()} of ${metricCol || 'Count'})`,
        description: `Cross-dimensional density across ${filteredDataset.rows.length.toLocaleString()} records.`,
        xKey: effectiveX,
        yKeys: ['value'],
        xLabel: effectiveX,
        yLabel: yCat,
        data: heatRows,
      });
    }

    const isTime = dateCols.includes(effectiveX) || chartType === 'line' || chartType === 'area';
    const exec = executePlanDeterministically(filteredDataset, {
      operations: [
        isTime && dateCols.includes(effectiveX)
          ? { type: 'timeseries', groupBy: effectiveX, metric: effectiveY, agg, granularity: 'month' }
          : {
              type: 'aggregate',
              groupBy: effectiveX,
              metric: effectiveY,
              agg,
              sort: sortOrder === 'asc' ? 'asc' : 'desc',
              limit: 15,
            },
      ],
      chartSpec: {
        type: chartType,
        title: `${agg.toUpperCase()} of ${effectiveY} by ${effectiveX}`,
        description: `Interactive ${chartType.replace('_', ' ')} across ${filteredDataset.rows.length.toLocaleString()} records.`,
      },
    });

    if (!exec.chart) return null;
    const chartData =
      sortOrder === 'natural'
        ? exec.chart.data
        : exec.chart.data;
    return applyCustomMeta({ ...exec.chart, type: chartType, data: chartData });
  }, [filteredDataset, chartType, effectiveX, effectiveY, agg, sortOrder, filterCol, filterVal, customTitle, customSubtitle, dateCols, catCols, numCols]);

  // Recommended automated gallery
  const recommendedCharts = useMemo(() => {
    if (!dataset) return [];
    const list: ChartSpec[] = [];
    if (catCols[0] && numCols[0]) {
      const r1 = executePlanDeterministically(dataset, {
        operations: [{ type: 'aggregate', groupBy: catCols[0], metric: numCols[0], agg: 'sum', limit: 8 }],
        chartSpec: { type: 'bar', title: `Total ${numCols[0]} by ${catCols[0]}` },
      });
      if (r1.chart) list.push(r1.chart);
    }
    if (dateCols[0] && numCols[0]) {
      const r2 = executePlanDeterministically(dataset, {
        operations: [{ type: 'timeseries', groupBy: dateCols[0], metric: numCols[0], agg: 'sum', granularity: 'month' }],
        chartSpec: { type: 'area', title: `Monthly ${numCols[0]} Trajectory` },
      });
      if (r2.chart) list.push(r2.chart);
    }
    if (catCols[1] && numCols[0]) {
      const r3 = executePlanDeterministically(dataset, {
        operations: [{ type: 'aggregate', groupBy: catCols[1], metric: numCols[0], agg: 'sum', limit: 6 }],
        chartSpec: { type: 'donut', title: `${numCols[0]} Share by ${catCols[1]}` },
      });
      if (r3.chart) list.push(r3.chart);
    }
    return list;
  }, [dataset, catCols, numCols, dateCols]);

  if (!dataset) {
    return (
      <EmptyDatasetState
        title="Visualization Studio"
        description="Upload a dataset to build interactive bar, line, area, donut, scatter, histogram, box plot, and 2D heatmap charts."
        onNavigate={onNavigate}
        onLoadSample={onLoadSample}
      />
    );
  }

  const chartOptions: Array<{ value: ChartType; label: string }> = [
    { value: 'bar', label: 'Bar Chart' },
    { value: 'horizontal_bar', label: 'Horizontal Bar' },
    { value: 'line', label: 'Line Chart' },
    { value: 'area', label: 'Area Chart' },
    { value: 'pie', label: 'Pie Chart' },
    { value: 'donut', label: 'Donut Chart' },
    { value: 'scatter', label: 'Scatter Plot' },
    { value: 'histogram', label: 'Histogram' },
    { value: 'boxplot', label: 'Box Plot (Min/Q1/Med/Q3/Max)' },
    { value: 'heatmap', label: '2D Category Heatmap' },
  ];

  return (
    <div className="space-y-6">
      {/* Interactive Chart Builder Controls */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Interactive Chart Builder
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Customize chart geometry, axes, filters, sorting, and titles over {dataset.name}
            </p>
          </div>
          {filterCol && filterVal && (
            <button
              type="button"
              onClick={() => {
                setFilterCol('');
                setFilterVal('');
              }}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Clear filter ({filteredDataset?.rows.length.toLocaleString()} rows)
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Chart Type</label>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as ChartType)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {chartOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">X Axis / Category</label>
            <select
              value={effectiveX}
              onChange={(e) => setXCol(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {dataset.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Y Axis / Metric</label>
            <select
              value={effectiveY}
              onChange={(e) => setYCol(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {dataset.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Aggregation</label>
            <select
              value={agg}
              onChange={(e) => setAgg(e.target.value as typeof agg)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count</option>
              <option value="min">Minimum</option>
              <option value="max">Maximum</option>
            </select>
          </div>
        </div>

        {/* Title Editing, Data Filter, and Sorting Row */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Custom Chart Title</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Auto-generated title"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Custom Subtitle</label>
            <input
              type="text"
              value={customSubtitle}
              onChange={(e) => setCustomSubtitle(e.target.value)}
              placeholder="Optional description"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Sort Order</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="desc">Highest to Lowest</option>
              <option value="asc">Lowest to Highest</option>
              <option value="natural">Default Order</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Filter Column</label>
            <select
              value={filterCol}
              onChange={(e) => {
                setFilterCol(e.target.value);
                setFilterVal('');
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">No filter</option>
              {dataset.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Filter Value</label>
            <select
              value={filterVal}
              disabled={!filterCol}
              onChange={(e) => setFilterVal(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 disabled:opacity-50 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">All values</option>
              {filterValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Chart Colour Customization Row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              <Palette className="h-3.5 w-3.5" />
              <span>Chart Palette</span>
            </div>
            <select
              aria-label="Chart color palette"
              value={chartPaletteId}
              onChange={(e) => {
                setChartPaletteId(e.target.value);
                setCustomPrimaryColor(null);
                setCustomSecondaryColor(null);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {CHART_PALETTE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {chartPaletteId === 'custom' && <option value="custom">Custom Palette</option>}
            </select>

            <div className="flex items-center gap-1" aria-label="Active palette preview">
              {(effectiveChartColors || chartColors).slice(0, 6).map((hex, i) => (
                <span
                  key={i}
                  title={hex}
                  style={{ backgroundColor: hex }}
                  className="h-4 w-4 rounded-sm border border-black/10 dark:border-white/10"
                />
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <span>Series 1</span>
              <input
                type="color"
                value={customPrimaryColor || chartColors[0]}
                onChange={(e) => setCustomPrimaryColor(e.target.value)}
                aria-label="Custom primary series color"
                className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <span>Series 2</span>
              <input
                type="color"
                value={customSecondaryColor || chartColors[1]}
                onChange={(e) => setCustomSecondaryColor(e.target.value)}
                aria-label="Custom secondary series color"
                className="h-6 w-7 cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
              />
            </label>
            {(customPrimaryColor || customSecondaryColor) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (effectiveChartColors) {
                      setCustomChartColors(effectiveChartColors);
                      setCustomPrimaryColor(null);
                      setCustomSecondaryColor(null);
                    }
                  }}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  Apply Workspace-Wide
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCustomPrimaryColor(null);
                    setCustomSecondaryColor(null);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {customChart && <ChartRenderer chart={customChart} height={360} colors={effectiveChartColors} />}

      {/* Auto-Recommended Charts */}
      {recommendedCharts.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Recommended Views for {dataset.name}
          </h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {recommendedCharts.map((ch) => (
              <ChartRenderer key={ch.id} chart={ch} height={270} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
