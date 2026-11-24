import { isNullish, parseDateValue, parseNumericValue, profileDataset } from './parser';
import type {
  CleaningAction,
  CleaningPreview,
  ColumnType,
  Dataset,
  DatasetRow,
  DatasetSnapshot,
} from '../types/data';

export interface DetectedIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  category: 'missing' | 'duplicates' | 'type_mismatch' | 'whitespace_case' | 'outliers' | 'date_format';
  column?: string;
  count: number;
  description: string;
  recommendedAction: CleaningAction;
}

export function detectDatasetIssues(dataset: Dataset): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  if (dataset.profile.duplicateRowCount > 0) {
    issues.push({
      id: 'issue_duplicates',
      severity: 'high',
      category: 'duplicates',
      count: dataset.profile.duplicateRowCount,
      description: `${dataset.profile.duplicateRowCount} exact duplicate row(s) detected that can inflate totals and skew averages.`,
      recommendedAction: { type: 'remove_duplicates' },
    });
  }

  for (const col of dataset.profile.columns) {
    if (col.missingCount > 0) {
      issues.push({
        id: `issue_missing_${col.name}`,
        severity: col.missingPct > 10 ? 'high' : 'medium',
        category: 'missing',
        column: col.name,
        count: col.missingCount,
        description: `Column "${col.name}" has ${col.missingCount} missing value(s) (${col.missingPct}%).`,
        recommendedAction: {
          type: 'fill_missing',
          column: col.name,
          fillStrategy: col.type === 'number' ? 'median' : 'mode',
        },
      });
    }

    if ((col.inconsistentFormatCount || 0) > 0) {
      issues.push({
        id: `issue_format_${col.name}`,
        severity: 'medium',
        category: 'type_mismatch',
        column: col.name,
        count: col.inconsistentFormatCount || 0,
        description: `Column "${col.name}" (${col.type}) contains ${col.inconsistentFormatCount} value(s) with invalid or inconsistent formatting.`,
        recommendedAction: {
          type: 'convert_type',
          column: col.name,
          targetType: col.type,
        },
      });
    }

    const textIssues = (col.leadingTrailingSpaceCount || 0) + (col.mixedCaseCount || 0);
    if (textIssues > 0 && col.type === 'string') {
      issues.push({
        id: `issue_text_${col.name}`,
        severity: 'low',
        category: 'whitespace_case',
        column: col.name,
        count: textIssues,
        description: `Column "${col.name}" has ${col.leadingTrailingSpaceCount || 0} whitespace and ${col.mixedCaseCount || 0} inconsistent casing occurrence(s).`,
        recommendedAction: {
          type: 'standardize_text',
          column: col.name,
          textMode: 'titlecase',
        },
      });
    }

    if (col.type === 'date') {
      let nonIsoCount = 0;
      for (const row of dataset.rows) {
        const val = row[col.name];
        if (typeof val === 'string' && val.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          if (parseDateValue(val) !== null) nonIsoCount++;
        }
      }
      if (nonIsoCount > 0) {
        issues.push({
          id: `issue_date_${col.name}`,
          severity: 'low',
          category: 'date_format',
          column: col.name,
          count: nonIsoCount,
          description: `Column "${col.name}" has ${nonIsoCount} date value(s) not formatted as ISO YYYY-MM-DD.`,
          recommendedAction: {
            type: 'standardize_dates',
            column: col.name,
          },
        });
      }
    }

    if ((col.outlierCount || 0) > 0 && col.type === 'number') {
      issues.push({
        id: `issue_outlier_${col.name}`,
        severity: 'low',
        category: 'outliers',
        column: col.name,
        count: col.outlierCount || 0,
        description: `Column "${col.name}" contains ${col.outlierCount} statistical outlier(s) beyond 1.5x IQR bounds.`,
        recommendedAction: {
          type: 'handle_outliers',
          column: col.name,
          outlierStrategy: 'cap',
        },
      });
    }
  }

  return issues;
}

function toTitleCase(str: string): string {
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

export function simulateCleaningAction(
  dataset: Dataset,
  action: CleaningAction
): {
  nextColumns: string[];
  nextRows: DatasetRow[];
  forcedTypes?: Record<string, ColumnType>;
  preview: CleaningPreview;
} {
  let nextColumns = [...dataset.columns];
  let nextRows: DatasetRow[] = dataset.rows.map((r) => ({ ...r }));
  let forcedTypes: Record<string, ColumnType> | undefined;
  let affectedRowsCount = 0;
  let affectedCellsCount = 0;
  const sampleDiffs: CleaningPreview['sampleDiffs'] = [];
  let actionLabel = '';

  const pushDiff = (rowIndex: number, column: string, before: unknown, after: unknown) => {
    if (sampleDiffs.length < 8) {
      sampleDiffs.push({
        rowIndex: rowIndex + 1,
        column,
        before: before === null || before === undefined ? '(null)' : String(before),
        after: after === null || after === undefined ? '(null)' : String(after),
      });
    }
  };

  if (action.type === 'remove_duplicates') {
    actionLabel = 'Remove exact duplicate rows';
    const seen = new Set<string>();
    const kept: DatasetRow[] = [];
    nextRows.forEach((row, idx) => {
      const sig = nextColumns.map((c) => String(row[c] ?? '')).join('\u0001');
      if (seen.has(sig)) {
        affectedRowsCount++;
        affectedCellsCount += nextColumns.length;
        pushDiff(idx, 'Entire Row', JSON.stringify(row).slice(0, 60), '(removed duplicate)');
      } else {
        seen.add(sig);
        kept.push(row);
      }
    });
    nextRows = kept;
  } else if (action.type === 'fill_missing' && action.column) {
    const col = action.column;
    const colProf = dataset.profile.columns.find((c) => c.name === col);
    let fillVal: string | number | boolean | null = action.customValue ?? '';
    if (action.fillStrategy === 'mean') fillVal = colProf?.mean ?? 0;
    else if (action.fillStrategy === 'median') fillVal = colProf?.median ?? 0;
    else if (action.fillStrategy === 'mode') fillVal = colProf?.mode ?? '';
    else if (action.fillStrategy === 'zero') fillVal = 0;

    actionLabel = `Fill missing values in "${col}" with ${action.fillStrategy || 'custom'} (${String(fillVal)})`;
    nextRows.forEach((row, idx) => {
      if (isNullish(row[col])) {
        pushDiff(idx, col, row[col], fillVal);
        row[col] = fillVal;
        affectedRowsCount++;
        affectedCellsCount++;
      }
    });
  } else if (action.type === 'remove_missing_rows') {
    const col = action.column;
    actionLabel = col ? `Remove rows missing "${col}"` : 'Remove rows with any missing value';
    const kept: DatasetRow[] = [];
    nextRows.forEach((row, idx) => {
      const hasMissing = col ? isNullish(row[col]) : nextColumns.some((c) => isNullish(row[c]));
      if (hasMissing) {
        affectedRowsCount++;
        affectedCellsCount += nextColumns.length;
        pushDiff(idx, col || 'Row', '(contains null)', '(row removed)');
      } else {
        kept.push(row);
      }
    });
    nextRows = kept;
  } else if (action.type === 'standardize_text' && action.column) {
    const col = action.column;
    const mode = action.textMode || 'trim';
    actionLabel = `Standardize text in "${col}" (${mode})`;
    nextRows.forEach((row, idx) => {
      if (typeof row[col] === 'string') {
        const orig = row[col] as string;
        let next = orig.trim().replace(/\s+/g, ' ');
        if (mode === 'lowercase') next = next.toLowerCase();
        else if (mode === 'uppercase') next = next.toUpperCase();
        else if (mode === 'titlecase') next = toTitleCase(next);
        if (next !== orig) {
          pushDiff(idx, col, orig, next);
          row[col] = next;
          affectedRowsCount++;
          affectedCellsCount++;
        }
      }
    });
  } else if (action.type === 'standardize_dates' && action.column) {
    const col = action.column;
    forcedTypes = { [col]: 'date' };
    actionLabel = `Standardize date values in "${col}" to ISO (YYYY-MM-DD)`;
    nextRows.forEach((row, idx) => {
      const orig = row[col];
      if (isNullish(orig)) return;
      const parsed = parseDateValue(orig);
      if (parsed) {
        const iso = parsed.toISOString().slice(0, 10);
        if (iso !== String(orig).trim()) {
          pushDiff(idx, col, orig, iso);
          row[col] = iso;
          affectedRowsCount++;
          affectedCellsCount++;
        }
      }
    });
  } else if (action.type === 'convert_type' && action.column && action.targetType) {
    const col = action.column;
    const target = action.targetType;
    forcedTypes = { [col]: target };
    actionLabel = `Convert "${col}" values to ${target}`;

    nextRows.forEach((row, idx) => {
      const orig = row[col];
      if (isNullish(orig)) return;
      let nextVal: string | number | boolean | null = orig;
      if (target === 'number') {
        nextVal = parseNumericValue(orig);
      } else if (target === 'string') {
        nextVal = String(orig).trim();
      } else if (target === 'date') {
        const d = parseDateValue(orig);
        nextVal = d ? d.toISOString().slice(0, 10) : null;
      } else if (target === 'boolean') {
        const s = String(orig).trim().toLowerCase();
        nextVal = s === 'true' || s === '1' || s === 'yes' ? true : s === 'false' || s === '0' || s === 'no' ? false : null;
      }
      if (nextVal !== orig) {
        pushDiff(idx, col, orig, nextVal);
        row[col] = nextVal;
        affectedRowsCount++;
        affectedCellsCount++;
      }
    });
  } else if (action.type === 'handle_outliers' && action.column) {
    const col = action.column;
    const colProf = dataset.profile.columns.find((c) => c.name === col);
    const strategy = action.outlierStrategy || 'cap';
    actionLabel = `${strategy === 'cap' ? 'Cap (Winsorize)' : 'Remove'} IQR outliers in "${col}"`;

    if (colProf && colProf.q1 !== undefined && colProf.q3 !== undefined && colProf.iqr !== undefined && colProf.iqr > 0) {
      const lower = Number((colProf.q1 - 1.5 * colProf.iqr).toFixed(2));
      const upper = Number((colProf.q3 + 1.5 * colProf.iqr).toFixed(2));
      if (strategy === 'cap') {
        nextRows.forEach((row, idx) => {
          const val = parseNumericValue(row[col]);
          if (val !== null) {
            if (val < lower) {
              pushDiff(idx, col, val, lower);
              row[col] = lower;
              affectedRowsCount++;
              affectedCellsCount++;
            } else if (val > upper) {
              pushDiff(idx, col, val, upper);
              row[col] = upper;
              affectedRowsCount++;
              affectedCellsCount++;
            }
          }
        });
      } else {
        const kept: DatasetRow[] = [];
        nextRows.forEach((row, idx) => {
          const val = parseNumericValue(row[col]);
          if (val !== null && (val < lower || val > upper)) {
            pushDiff(idx, col, val, '(row removed)');
            affectedRowsCount++;
            affectedCellsCount += nextColumns.length;
          } else {
            kept.push(row);
          }
        });
        nextRows = kept;
      }
    }
  } else if (action.type === 'rename_column' && action.column && action.newColumnName) {
    const oldName = action.column;
    const newName = action.newColumnName.trim();
    if (!newName || nextColumns.includes(newName)) {
      throw new Error('New column name must be non-empty and unique.');
    }
    actionLabel = `Rename column "${oldName}" to "${newName}"`;
    nextColumns = nextColumns.map((c) => (c === oldName ? newName : c));
    nextRows = nextRows.map((row) => {
      const copy: DatasetRow = {};
      for (const key of Object.keys(row)) {
        copy[key === oldName ? newName : key] = row[key];
      }
      return copy;
    });
    affectedRowsCount = nextRows.length;
    affectedCellsCount = nextRows.length;
    pushDiff(0, 'Column Header', oldName, newName);
  }

  const nextProfile = profileDataset(nextColumns, nextRows, forcedTypes);
  return {
    nextColumns,
    nextRows,
    forcedTypes,
    preview: {
      actionLabel,
      affectedRowsCount,
      affectedCellsCount,
      beforeQualityScore: dataset.profile.qualityScore,
      afterQualityScore: nextProfile.qualityScore,
      beforeRowCount: dataset.profile.rowCount,
      afterRowCount: nextProfile.rowCount,
      sampleDiffs,
    },
  };
}

export function applyCleaningAction(dataset: Dataset, action: CleaningAction): Dataset {
  const { nextColumns, nextRows, forcedTypes, preview } = simulateCleaningAction(dataset, action);
  const nextProfile = profileDataset(nextColumns, nextRows, forcedTypes);

  const snapshot: DatasetSnapshot = {
    id: `snap_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actionDescription: preview.actionLabel,
    rows: dataset.rows.map((r) => ({ ...r })),
    columns: [...dataset.columns],
    profile: JSON.parse(JSON.stringify(dataset.profile)),
  };

  return {
    ...dataset,
    columns: nextColumns,
    rows: nextRows,
    profile: nextProfile,
    cleaningHistory: [...dataset.cleaningHistory, snapshot],
  };
}

export function undoLastCleaning(dataset: Dataset): Dataset {
  if (dataset.cleaningHistory.length === 0) return dataset;
  const last = dataset.cleaningHistory[dataset.cleaningHistory.length - 1];
  return {
    ...dataset,
    columns: [...last.columns],
    rows: last.rows.map((r) => ({ ...r })),
    profile: JSON.parse(JSON.stringify(last.profile)),
    cleaningHistory: dataset.cleaningHistory.slice(0, -1),
  };
}

export function resetToOriginalDataset(dataset: Dataset): Dataset {
  return {
    ...dataset,
    columns: [...dataset.originalColumns],
    rows: dataset.originalRows.map((r) => ({ ...r })),
    profile: JSON.parse(JSON.stringify(dataset.originalProfile)),
    cleaningHistory: [],
  };
}
