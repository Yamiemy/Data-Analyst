import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { hexToRgbTuple } from '../context/ThemeContext';
import type { AnomalyDetectionResult, AnomalyReviewState, BIInsightsResponse, Dataset, EDAReport } from '../types/data';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportDatasetAsCSV(dataset: Dataset, suffix = '') {
  const csv = Papa.unparse(dataset.rows, { columns: dataset.columns });
  const baseName = dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${baseName}${suffix}.csv`);
}

export function exportRowsAsCSV(title: string, columns: string[], rows: Array<Record<string, unknown>>) {
  const csv = Papa.unparse(rows, { columns });
  const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${safeName}.csv`);
}

export function exportDatasetAsExcel(dataset: Dataset, suffix = '') {
  const ws = XLSX.utils.json_to_sheet(dataset.rows, { header: dataset.columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dataset');

  const summaryRows = dataset.profile.columns.map((c) => ({
    Column: c.name,
    Type: c.type,
    Non_Null: c.nonNullCount,
    Missing: c.missingCount,
    Missing_Pct: c.missingPct,
    Unique: c.uniqueCount,
    Mean: c.mean ?? '',
    Median: c.median ?? '',
    StdDev: c.stdDev ?? '',
    Min: c.min ?? c.minDate ?? '',
    Max: c.max ?? c.maxDate ?? '',
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Profile_Summary');

  const baseName = dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '');
  XLSX.writeFile(wb, `${baseName}${suffix}.xlsx`);
}

export function exportTableAsPDF(params: {
  title: string;
  subtitle?: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  accentHex?: string;
  filename?: string;
  maxRows?: number;
}) {
  const { title, subtitle, columns, rows, accentHex = '#4F46E5', filename, maxRows = 250 } = params;
  const accentRgb = hexToRgbTuple(accentHex);
  const orientation = columns.length > 6 ? 'landscape' : 'portrait';
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 68, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(title, 36, 32);
  doc.setFontSize(9);
  doc.setTextColor(203, 213, 225);
  doc.text(
    subtitle || `${rows.length.toLocaleString()} total rows · ${columns.length} columns · Exported ${new Date().toLocaleDateString()}`,
    36,
    50
  );

  const sliced = rows.slice(0, maxRows);
  const body = sliced.map((r) =>
    columns.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return 'null';
      return String(v);
    })
  );

  autoTable(doc, {
    startY: 84,
    head: [columns],
    body,
    styles: { fontSize: columns.length > 8 ? 7 : 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: accentRgb },
    margin: { left: 36, right: 36 },
  });

  if (rows.length > maxRows) {
    const finalY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 120) + 18;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Showing first ${maxRows.toLocaleString()} of ${rows.length.toLocaleString()} rows. Use CSV or Excel export for full raw records.`,
      36,
      finalY
    );
  }

  addPdfPageFooters(doc, title);
  const outName = filename || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`;
  doc.save(outName);
}

function addPdfPageFooters(doc: jsPDF, label: string) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`DataMind AI · ${label}`, 40, pageHeight - 20);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 40, pageHeight - 20, { align: 'right' });
  }
}

export async function exportChartAsPNG(svgElement: SVGSVGElement, title: string): Promise<void> {
  const dataUrl = await svgToPngDataUrl(svgElement);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function exportChartAsPDF(
  svgElement: SVGSVGElement,
  title: string,
  description?: string,
  accentHex = '#4F46E5'
): Promise<void> {
  const dataUrl = await svgToPngDataUrl(svgElement);
  const rect = svgElement.getBoundingClientRect();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const accentRgb = hexToRgbTuple(accentHex);

  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 0, pageWidth, 8, 'F');

  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(title, 40, 42);

  if (description) {
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(description, pageWidth - 80), 40, 62);
  }

  const maxW = pageWidth - 80;
  const maxH = pageHeight - 130;
  const ratio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
  let drawW = maxW;
  let drawH = drawW / ratio;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = drawH * ratio;
  }

  doc.addImage(dataUrl, 'PNG', 40, 92, drawW, drawH);
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`DataMind AI Visualization · Exported ${new Date().toLocaleString()}`, 40, pageHeight - 24);

  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`);
}

function svgToPngDataUrl(svgElement: SVGSVGElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(600, Math.round(rect.width) || 800);
    const height = Math.max(320, Math.round(rect.height) || 420);

    const cloned = svgElement.cloneNode(true) as SVGSVGElement;
    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    cloned.setAttribute('width', String(width));
    cloned.setAttribute('height', String(height));

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(cloned);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context unavailable.'));
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to rasterize chart SVG.'));
    };
    img.src = url;
  });
}

export async function exportReportAsPDF(params: {
  dataset: Dataset;
  eda: EDAReport;
  insights?: BIInsightsResponse | null;
  anomalyResult?: AnomalyDetectionResult | null;
  anomalyReviews?: Record<number, AnomalyReviewState>;
  executiveSummary: string;
  conclusion: string;
  accentHex?: string;
  chartSvg?: SVGSVGElement | null;
  anomalyChartSvg?: SVGSVGElement | null;
}) {
  const {
    dataset,
    eda,
    insights,
    anomalyResult,
    anomalyReviews = {},
    executiveSummary,
    conclusion,
    accentHex = '#4F46E5',
    chartSvg,
    anomalyChartSvg,
  } = params;
  const accentRgb = hexToRgbTuple(accentHex);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 84, 'F');
  doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
  doc.rect(0, 80, pageWidth, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text('DataMind AI — Analytical Report', 40, 38);
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(`Dataset: ${dataset.name}  ·  Generated: ${new Date().toLocaleDateString()}`, 40, 60);

  let y = 110;
  doc.setTextColor(15, 23, 42);

  const addSectionTitle = (title: string) => {
    if (y > 720) {
      doc.addPage();
      y = 48;
    }
    doc.setFontSize(13);
    doc.setTextColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.text(title, 40, y);
    y += 16;
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
  };

  const addParagraph = (text: string) => {
    const lines = doc.splitTextToSize(text, pageWidth - 80);
    if (y + lines.length * 14 > 760) {
      doc.addPage();
      y = 48;
    }
    doc.text(lines, 40, y);
    y += lines.length * 14 + 10;
  };

  addSectionTitle('1. Executive Summary');
  addParagraph(executiveSummary);

  addSectionTitle('2. Dataset Description & Data Quality Assessment');
  addParagraph(
    `Records: ${dataset.profile.rowCount.toLocaleString()} · Columns: ${dataset.profile.columnCount} · Missing Cells: ${dataset.profile.missingCells.toLocaleString()} (${dataset.profile.missingPct}%) · Duplicate Rows: ${dataset.profile.duplicateRowCount.toLocaleString()} · Data Quality Score: ${dataset.profile.qualityScore}/100.`
  );

  autoTable(doc, {
    startY: y,
    head: [['Column', 'Type', 'Missing', 'Unique', 'Mean / Mode', 'Min — Max']],
    body: dataset.profile.columns.map((c) => [
      c.name,
      c.type,
      `${c.missingCount} (${c.missingPct}%)`,
      String(c.uniqueCount),
      c.type === 'number' ? String(c.mean ?? '—') : String(c.mode ?? '—'),
      c.type === 'number'
        ? `${c.min ?? '—'} — ${c.max ?? '—'}`
        : c.type === 'date'
          ? `${c.minDate ?? '—'} — ${c.maxDate ?? '—'}`
          : '—',
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: accentRgb },
    margin: { left: 40, right: 40 },
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 24;

  addSectionTitle('3. Exploratory Data Analysis & Key Findings');
  eda.automatedExplanations.forEach((exp) => addParagraph(`• ${exp}`));

  if (eda.correlations.length > 0) {
    addParagraph(
      `Top Numeric Correlations: ${eda.correlations
        .slice(0, 4)
        .map((c) => `${c.colA} vs ${c.colB} (r=${c.r})`)
        .join(' · ')}`
    );
  }

  let sectionNum = 4;

  if (anomalyResult) {
    addSectionTitle(`${sectionNum}. Anomaly Detection Findings`);
    addParagraph(
      `Algorithm: ${anomalyResult.algorithmLabel} · Parameters: ${anomalyResult.detectedParametersSummary} · Analyzed: ${anomalyResult.totalRecordsAnalyzed.toLocaleString()} rows · Anomalies Flagged: ${anomalyResult.totalAnomalies.toLocaleString()} (${anomalyResult.anomalyPct}%) · Severity Distribution: ${anomalyResult.highCount} High, ${anomalyResult.mediumCount} Medium, ${anomalyResult.lowCount} Low.`
    );
    addParagraph(
      'Score Interpretation Note: Anomaly scores (0–100) represent relative statistical deviation intensity and must not be interpreted as calibrated fraud or error probabilities.'
    );

    if (anomalyChartSvg) {
      try {
        const anomPng = await svgToPngDataUrl(anomalyChartSvg);
        const rect = anomalyChartSvg.getBoundingClientRect();
        const maxW = pageWidth - 80;
        const ratio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
        const drawH = Math.min(185, maxW / ratio);
        const drawW = drawH * ratio;
        if (y + drawH + 30 > 760) {
          doc.addPage();
          y = 48;
        }
        doc.addImage(anomPng, 'PNG', 40, y, drawW, drawH);
        y += drawH + 16;
      } catch {
        // Skip anomaly chart image if rasterization fails
      }
    }

    if (anomalyResult.records.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['Row #', 'Record', 'Score (0-100)', 'Severity', 'Actual vs Expected', 'Review & Notes']],
        body: anomalyResult.records.slice(0, 15).map((r) => {
          const rev = anomalyReviews[r.rowIndex];
          const reviewLabel = rev ? `${rev.status.toUpperCase()}${rev.note ? `: ${rev.note}` : ''}` : 'UNREVIEWED';
          return [
            `#${r.rowIndex}`,
            r.recordId,
            `${r.score}/100`,
            r.severity.toUpperCase(),
            `${r.actualValuesSummary} | Exp: ${r.expectedValuesSummary}`,
            reviewLabel,
          ];
        }),
        styles: { fontSize: 7.5, cellPadding: 4 },
        headStyles: { fillColor: accentRgb },
        margin: { left: 40, right: 40 },
      });
      y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 18;
    }

    if (anomalyResult.limitations.length > 0 || anomalyResult.falsePositiveWarnings.length > 0) {
      addParagraph(
        `Limitations & Recommendations: ${[...anomalyResult.falsePositiveWarnings, ...anomalyResult.limitations].join(' · ')}`
      );
    }
    sectionNum++;
  }

  if (chartSvg) {
    try {
      const chartPng = await svgToPngDataUrl(chartSvg);
      const rect = chartSvg.getBoundingClientRect();
      const maxW = pageWidth - 80;
      const ratio = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
      const drawH = Math.min(220, maxW / ratio);
      const drawW = drawH * ratio;
      if (y + drawH + 50 > 760) {
        doc.addPage();
        y = 48;
      }
      addSectionTitle(`${sectionNum}. Key Visualization`);
      doc.addImage(chartPng, 'PNG', 40, y, drawW, drawH);
      y += drawH + 20;
      sectionNum++;
    } catch {
      // Skip chart image if SVG rasterization is unavailable
    }
  }

  if (insights && insights.insights.length > 0) {
    addSectionTitle(`${sectionNum}. Business Insights & Recommendations`);
    insights.insights.slice(0, 6).forEach((item) => {
      addParagraph(`[${item.importance.toUpperCase()}] ${item.title}: ${item.summary} (${item.supportingMetric}) — Action: ${item.recommendation}`);
    });
    sectionNum++;
  }

  addSectionTitle(`${sectionNum}. Conclusion`);
  addParagraph(conclusion);

  addPdfPageFooters(doc, dataset.name);

  const baseName = dataset.name.replace(/\.(csv|xlsx|xls|json)$/i, '');
  doc.save(`${baseName}_DataMind_Report.pdf`);
}
