import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type {
  ColumnProfile,
  ColumnType,
  Dataset,
  DatasetProfile,
  DatasetRow,
} from '../types/data';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export function isNullish(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    return trimmed === '' || trimmed === 'null' || trimmed === 'na' || trimmed === 'n/a' || trimmed === 'nan' || trimmed === 'undefined';
  }
  if (typeof val === 'number') return Number.isNaN(val);
  return false;
}

export function parseNumericValue(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return null;
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  // Handle currency/percent/commas e.g. "$1,234.50", "45.2%", "(120.50)"
  let s = trimmed.replace(/[$,\s%]/g, '');
  if (/^\(\d+(\.\d+)?\)$/.test(s)) {
    s = '-' + s.slice(1, -1);
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

export function parseDateValue(val: unknown): Date | null {
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.length < 6 || /^\d+$/.test(trimmed)) return null;
  // Require date-like separators (-, /, or month names) to avoid plain numbers parsing as dates
  if (!/[-/]/.test(trimmed) && !/[a-zA-Z]{3}/.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  if (d.getFullYear() < 1900 || d.getFullYear() > 2100) return null;
  return d;
}

export function inferColumnType(values: unknown[]): ColumnType {
  const nonNull = values.filter((v) => !isNullish(v));
  if (nonNull.length === 0) return 'string';

  const sample = nonNull.slice(0, 400);
  let numHits = 0;
  let dateHits = 0;
  let boolHits = 0;

  for (const val of sample) {
    if (typeof val === 'boolean' || (typeof val === 'string' && /^(true|false)$/i.test(val.trim()))) {
      boolHits++;
    } else if (parseNumericValue(val) !== null) {
      numHits++;
    } else if (parseDateValue(val) !== null) {
      dateHits++;
    }
  }

  const threshold = sample.length * 0.78;
  if (boolHits >= threshold) return 'boolean';
  if (numHits >= threshold) return 'number';
  if (dateHits >= threshold) return 'date';
  return 'string';
}

function computeQuantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function computeColumnProfile(name: string, rows: DatasetRow[], forcedType?: ColumnType): ColumnProfile {
  const rawValues = rows.map((r) => r[name]);
  const type = forcedType || inferColumnType(rawValues);

  let missingCount = 0;
  const freqMap = new Map<string, number>();
  const numericVals: number[] = [];
  const dateVals: Date[] = [];
  let inconsistentFormatCount = 0;
  let leadingTrailingSpaceCount = 0;
  const lowerToOriginalForms = new Map<string, Set<string>>();

  for (const raw of rawValues) {
    if (isNullish(raw)) {
      missingCount++;
      continue;
    }

    if (typeof raw === 'string') {
      if (raw !== raw.trim()) leadingTrailingSpaceCount++;
      const trimmed = raw.trim();
      const lower = trimmed.toLowerCase();
      if (!lowerToOriginalForms.has(lower)) lowerToOriginalForms.set(lower, new Set());
      lowerToOriginalForms.get(lower)!.add(trimmed);
    }

    const key = String(raw).trim();
    freqMap.set(key, (freqMap.get(key) || 0) + 1);

    if (type === 'number') {
      const n = parseNumericValue(raw);
      if (n !== null) {
        numericVals.push(n);
      } else {
        inconsistentFormatCount++;
      }
    } else if (type === 'date') {
      const d = parseDateValue(raw);
      if (d !== null) {
        dateVals.push(d);
      } else {
        inconsistentFormatCount++;
      }
    }
  }

  let mixedCaseCount = 0;
  if (type === 'string') {
    for (const forms of lowerToOriginalForms.values()) {
      if (forms.size > 1) mixedCaseCount += forms.size - 1;
    }
  }

  const total = rows.length;
  const nonNullCount = total - missingCount;
  const missingPct = total > 0 ? Number(((missingCount / total) * 100).toFixed(2)) : 0;
  const uniqueCount = freqMap.size;

  const sortedFreq = Array.from(freqMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([value, count]) => ({
      value,
      count,
      pct: nonNullCount > 0 ? Number(((count / nonNullCount) * 100).toFixed(1)) : 0,
    }));

  const mode = sortedFreq.length > 0 ? sortedFreq[0].value : null;

  const base: ColumnProfile = {
    name,
    type,
    nonNullCount,
    missingCount,
    missingPct,
    uniqueCount,
    mode,
    topValues: sortedFreq,
    inconsistentFormatCount,
    leadingTrailingSpaceCount,
    mixedCaseCount,
  };

  if (type === 'number' && numericVals.length > 0) {
    const sorted = [...numericVals].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / sorted.length;
    const median = computeQuantile(sorted, 0.5);
    const q1 = computeQuantile(sorted, 0.25);
    const q3 = computeQuantile(sorted, 0.75);
    const iqr = q3 - q1;
    const variance =
      sorted.length > 1
        ? sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (sorted.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const outlierCount = iqr > 0 ? sorted.filter((v) => v < lowerFence || v > upperFence).length : 0;

    base.min = sorted[0];
    base.max = sorted[sorted.length - 1];
    base.sum = Number(sum.toFixed(4));
    base.mean = Number(mean.toFixed(4));
    base.median = Number(median.toFixed(4));
    base.q1 = Number(q1.toFixed(4));
    base.q3 = Number(q3.toFixed(4));
    base.iqr = Number(iqr.toFixed(4));
    base.variance = Number(variance.toFixed(4));
    base.stdDev = Number(stdDev.toFixed(4));
    base.outlierCount = outlierCount;
  }

  if (type === 'date' && dateVals.length > 0) {
    const sortedDates = [...dateVals].sort((a, b) => a.getTime() - b.getTime());
    base.minDate = sortedDates[0].toISOString().slice(0, 10);
    base.maxDate = sortedDates[sortedDates.length - 1].toISOString().slice(0, 10);
  }

  return base;
}

export function profileDataset(columns: string[], rows: DatasetRow[], forcedTypes?: Record<string, ColumnType>): DatasetProfile {
  const colProfiles = columns.map((col) => computeColumnProfile(col, rows, forcedTypes?.[col]));
  const rowCount = rows.length;
  const columnCount = columns.length;
  const totalCells = rowCount * columnCount;
  const missingCells = colProfiles.reduce((acc, c) => acc + c.missingCount, 0);
  const missingPct = totalCells > 0 ? Number(((missingCells / totalCells) * 100).toFixed(2)) : 0;

  // Count duplicate rows deterministically
  const seen = new Set<string>();
  let duplicateRowCount = 0;
  for (const row of rows) {
    const sig = columns.map((c) => String(row[c] ?? '')).join('\u0001');
    if (seen.has(sig)) {
      duplicateRowCount++;
    } else {
      seen.add(sig);
    }
  }

  const completenessScore = totalCells > 0 ? Math.max(0, 100 - missingPct * 1.5) : 100;
  const uniquenessScore = rowCount > 0 ? Math.max(0, 100 - (duplicateRowCount / rowCount) * 100 * 1.5) : 100;
  const totalInconsistent = colProfiles.reduce(
    (acc, c) => acc + (c.inconsistentFormatCount || 0) + (c.leadingTrailingSpaceCount || 0) + (c.mixedCaseCount || 0),
    0
  );
  const consistencyScore = totalCells > 0 ? Math.max(0, 100 - (totalInconsistent / totalCells) * 100 * 2) : 100;

  const qualityScore = Number(
    Math.min(100, Math.max(0, completenessScore * 0.45 + uniquenessScore * 0.3 + consistencyScore * 0.25)).toFixed(1)
  );

  return {
    rowCount,
    columnCount,
    totalCells,
    missingCells,
    missingPct,
    duplicateRowCount,
    qualityScore,
    completenessScore: Number(completenessScore.toFixed(1)),
    uniquenessScore: Number(uniquenessScore.toFixed(1)),
    consistencyScore: Number(consistencyScore.toFixed(1)),
    columns: colProfiles,
  };
}

export function normalizeRowsAndColumns(rawRows: Array<Record<string, unknown>>): {
  columns: string[];
  rows: DatasetRow[];
} {
  if (!rawRows || rawRows.length === 0) {
    throw new Error('The uploaded dataset contains no data rows.');
  }

  const colSet = new Set<string>();
  for (const row of rawRows.slice(0, 200)) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        const cleanKey = key.trim();
        if (cleanKey) colSet.add(cleanKey);
      }
    }
  }

  const columns = Array.from(colSet);
  if (columns.length === 0) {
    throw new Error('Could not detect any valid column headers in the dataset.');
  }

  // Infer types across all rows so numeric columns store clean numbers when clean, while preserving dirty strings for Cleaning Studio if mixed
  const normalizedRows: DatasetRow[] = rawRows.map((raw) => {
    const out: DatasetRow = {};
    for (const col of columns) {
      const val = raw[col];
      if (isNullish(val)) {
        out[col] = null;
      } else if (typeof val === 'object') {
        out[col] = JSON.stringify(val);
      } else {
        out[col] = val as string | number | boolean;
      }
    }
    return out;
  });

  // Coerce cleanly convertible numeric/boolean cells while keeping unparseable entries intact for user inspection
  for (const col of columns) {
    const colType = inferColumnType(normalizedRows.map((r) => r[col]));
    if (colType === 'number') {
      for (const row of normalizedRows) {
        if (row[col] !== null && typeof row[col] !== 'number') {
          const parsed = parseNumericValue(row[col]);
          if (parsed !== null) {
            row[col] = parsed;
          }
        }
      }
    } else if (colType === 'boolean') {
      for (const row of normalizedRows) {
        if (typeof row[col] === 'string') {
          const lower = row[col].trim().toLowerCase();
          if (lower === 'true') row[col] = true;
          else if (lower === 'false') row[col] = false;
        }
      }
    }
  }

  return { columns, rows: normalizedRows };
}

export function buildDatasetObject(
  name: string,
  source: Dataset['source'],
  fileSizeBytes: number,
  rawRows: Array<Record<string, unknown>>
): Dataset {
  const { columns, rows } = normalizeRowsAndColumns(rawRows);
  const profile = profileDataset(columns, rows);

  return {
    id: `ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    source,
    fileSizeBytes,
    uploadedAt: new Date().toISOString(),
    columns,
    rows,
    originalColumns: [...columns],
    originalRows: rows.map((r) => ({ ...r })),
    profile,
    originalProfile: JSON.parse(JSON.stringify(profile)) as DatasetProfile,
    cleaningHistory: [],
  };
}

export async function parseCSVText(csvText: string, name: string, source: Dataset['source'] = 'csv', sizeBytes = 0): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        if (results.errors && results.errors.length > 0 && results.data.length === 0) {
          reject(new Error(`CSV parsing failed: ${results.errors[0].message}`));
          return;
        }
        try {
          resolve(buildDatasetObject(name, source, sizeBytes || csvText.length, results.data));
        } catch (err) {
          reject(err);
        }
      },
      error: (err: Error) => reject(new Error(`CSV parsing error: ${err.message}`)),
    });
  });
}

export async function parseUploadedFile(file: File): Promise<Dataset> {
  if (file.size === 0) {
    throw new Error('The selected file is empty (0 bytes).');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 25 MB upload limit.`);
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!['csv', 'xlsx', 'xls', 'json'].includes(ext)) {
    throw new Error(`Unsupported file format ".${ext}". Please upload a CSV, XLSX, XLS, or JSON file.`);
  }

  if (ext === 'csv') {
    const text = await file.text();
    return parseCSVText(text, file.name, 'csv', file.size);
  }

  if (ext === 'json') {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON file. Please verify the JSON syntax.');
    }
    let records: Array<Record<string, unknown>> = [];
    if (Array.isArray(parsed)) {
      records = parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const candidate = obj.data || obj.rows || obj.records || obj.items;
      if (Array.isArray(candidate)) {
        records = candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
    }
    if (records.length === 0) {
      throw new Error('JSON file must contain an array of record objects (e.g., [{"col": "val"}]).');
    }
    return buildDatasetObject(file.name, 'json', file.size, records);
  }

  // XLSX / XLS
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel workbook contains no worksheets.');
  }
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: null });
  return buildDatasetObject(file.name, ext === 'xls' ? 'xls' : 'xlsx', file.size, rawRows);
}

export function parseSheetValuesMatrix(values: unknown[][], title: string): Dataset {
  if (!values || values.length < 2) {
    throw new Error('The selected Google Sheet tab must contain a header row and at least one data row.');
  }
  const headers = values[0].map((h, idx) => String(h ?? '').trim() || `Column_${idx + 1}`);
  const rows: Array<Record<string, unknown>> = values.slice(1).map((rowArr) => {
    const rec: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      rec[h] = rowArr[idx] !== undefined ? rowArr[idx] : null;
    });
    return rec;
  });
  return buildDatasetObject(title, 'google_sheets', JSON.stringify(values).length, rows);
}

// Deterministic, realistic sample datasets users can optionally load with 1 click
export function createSampleRetailSalesDataset(): Dataset {
  const regions = ['North America', 'Europe', 'Asia Pacific', 'Latin America'];
  const categories = ['Enterprise Cloud', 'Analytics Suite', 'Security Add-on', 'Support Plans'];
  const products: Record<string, string[]> = {
    'Enterprise Cloud': ['Core Platform Pro', 'Compute Cluster XL', 'Edge Gateway'],
    'Analytics Suite': ['BI Explorer', 'Data Pipeline Studio', 'Forecast Engine'],
    'Security Add-on': ['ZeroTrust Vault', 'Audit Compliance Pack'],
    'Support Plans': ['24/7 Dedicated SLA', 'Onboarding Advisory'],
  };
  const channels = ['Direct Sales', 'Partner Channel', 'Self-Serve Web'];

  const rows: Array<Record<string, unknown>> = [];
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < 120; i++) {
    const month = (i % 12) + 1;
    const year = i < 60 ? 2025 : 2026;
    const day = Math.floor(nextRand() * 27) + 1;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const region = regions[Math.floor(nextRand() * regions.length)];
    const category = categories[Math.floor(nextRand() * categories.length)];
    const prodList = products[category];
    const product = prodList[Math.floor(nextRand() * prodList.length)];
    const channel = channels[Math.floor(nextRand() * channels.length)];

    const regionFactor = region === 'North America' ? 1.35 : region === 'Europe' ? 1.15 : region === 'Asia Pacific' ? 1.05 : 0.78;
    const seasonFactor = 1 + 0.18 * Math.sin((month / 12) * Math.PI * 2);
    const units = Math.max(1, Math.round((3 + nextRand() * 22) * regionFactor * seasonFactor));
    const unitPrice = category === 'Enterprise Cloud' ? 420 : category === 'Analytics Suite' ? 290 : category === 'Security Add-on' ? 185 : 140;
    const discountPct = i % 11 === 0 ? 0.25 : i % 5 === 0 ? 0.12 : 0.05;
    const revenue = Number((units * unitPrice * (1 - discountPct)).toFixed(2));
    const cost = Number((units * unitPrice * 0.54).toFixed(2));
    const profit = Number((revenue - cost).toFixed(2));
    const satisfaction = Number(Math.min(5, Math.max(2.4, 4.4 - discountPct * 1.4 + (nextRand() - 0.5) * 0.9)).toFixed(1));

    rows.push({
      Order_ID: `ORD-${1001 + i}`,
      Order_Date: dateStr,
      Region: i === 18 ? 'north america ' : region, // realistic subtle dirty record for cleaning studio
      Category: category,
      Product: product,
      Sales_Channel: channel,
      Units_Sold: units,
      Unit_Price: unitPrice,
      Discount_Rate: discountPct,
      Revenue: i === 45 ? revenue * 3.4 : revenue, // realistic outlier
      Cost: cost,
      Profit: profit,
      Customer_CSAT: i === 7 || i === 53 || i === 89 ? null : satisfaction,
    });
  }

  // Add 2 intentional duplicate rows so Data Cleaning Studio has real duplicates to inspect
  rows.push({ ...rows[4] });
  rows.push({ ...rows[12] });

  return buildDatasetObject('Global_SaaS_Revenue_2025_2026.csv', 'sample', 18420, rows);
}

export function createSampleChurnDataset(): Dataset {
  const plans = ['Starter', 'Growth', 'Enterprise'];
  const industries = ['FinTech', 'Healthcare', 'E-Commerce', 'Logistics', 'EdTech'];
  const rows: Array<Record<string, unknown>> = [];

  let seed = 109;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < 150; i++) {
    const plan = plans[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2];
    const industry = industries[Math.floor(nextRand() * industries.length)];
    const tenureMonths = Math.max(1, Math.round(nextRand() * 42));
    const monthlySpend = plan === 'Enterprise' ? Math.round(950 + nextRand() * 1400) : plan === 'Growth' ? Math.round(280 + nextRand() * 380) : Math.round(65 + nextRand() * 110);
    const supportTickets = Math.round(nextRand() * 9);
    const weeklyActiveUsers = Math.max(1, Math.round((plan === 'Enterprise' ? 45 : plan === 'Growth' ? 16 : 4) * (0.4 + nextRand())));
    const npsScore = Math.min(10, Math.max(1, Math.round(8.2 - supportTickets * 0.48 + (nextRand() - 0.5) * 2.5)));
    const churnRiskScore = (supportTickets > 5 ? 0.35 : 0) + (tenureMonths < 6 ? 0.3 : 0) + (npsScore <= 5 ? 0.35 : 0) + nextRand() * 0.2;
    const churned = churnRiskScore > 0.62 ? 'Yes' : 'No';

    rows.push({
      Customer_ID: `CUST-${2001 + i}`,
      Plan_Tier: plan,
      Industry: industry,
      Tenure_Months: tenureMonths,
      Monthly_Spend_USD: monthlySpend,
      Support_Tickets_90d: supportTickets,
      Weekly_Active_Users: weeklyActiveUsers,
      NPS_Score: i % 29 === 0 ? null : npsScore,
      Churned: churned,
    });
  }

  return buildDatasetObject('Customer_Churn_Retention_150.csv', 'sample', 14200, rows);
}
