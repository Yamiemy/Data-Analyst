import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { isNullish, parseNumericValue } from './parser';
import type { Dataset, DatasetRow, SQLResult } from '../types/data';

const FORBIDDEN_KEYWORDS = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|REPLACE|EXEC|EXECUTE|MERGE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

let sqlJsInstancePromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsInstancePromise) {
    sqlJsInstancePromise =
      typeof window !== 'undefined'
        ? initSqlJs({ locateFile: () => '/sql-wasm.wasm', useOldExtensionFunctions: false })
        : initSqlJs();
  }
  return sqlJsInstancePromise;
}

function unquoteIdent(token: string): string {
  const t = token.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) {
    return t.slice(1, -1);
  }
  return t;
}

function resolveCol(columns: string[], ident: string): string {
  const clean = unquoteIdent(ident);
  const exact = columns.find((c) => c === clean);
  if (exact) return exact;
  const ci = columns.find((c) => c.toLowerCase() === clean.toLowerCase());
  if (ci) return ci;
  throw new Error(`Unknown column "${clean}". Available columns: ${columns.join(', ')}`);
}

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      current += ch;
      if (ch === quote && str[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitTopLevelByKeyword(str: string, keyword: 'AND' | 'OR'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  const regex = new RegExp(`^\\s+${keyword}\\s+`, 'i');

  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (quote) {
      current += ch;
      if (ch === quote && str[i - 1] !== '\\') quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === '(') {
      depth++;
      current += ch;
      i++;
      continue;
    }
    if (ch === ')') {
      depth--;
      current += ch;
      i++;
      continue;
    }
    if (depth === 0) {
      const slice = str.slice(i);
      const m = slice.match(regex);
      if (m && current.trim().length > 0) {
        parts.push(current.trim());
        current = '';
        i += m[0].length;
        continue;
      }
    }
    current += ch;
    i++;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseLiteral(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (/^null$/i.test(t)) return null;
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  const n = Number(t);
  if (!Number.isNaN(n) && t !== '') return n;
  return t;
}

function evaluateCondition(expr: string, row: DatasetRow, columns: string[]): boolean {
  let trimmed = expr.trim();
  while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // Check if matching outer parens
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') depth--;
      if (depth === 0) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll) trimmed = trimmed.slice(1, -1).trim();
    else break;
  }

  const orParts = splitTopLevelByKeyword(trimmed, 'OR');
  if (orParts.length > 1) {
    return orParts.some((p) => evaluateCondition(p, row, columns));
  }

  const andParts = splitTopLevelByKeyword(trimmed, 'AND');
  if (andParts.length > 1) {
    return andParts.every((p) => evaluateCondition(p, row, columns));
  }

  // IS NOT NULL / IS NULL
  const isNullMatch = trimmed.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNullMatch) {
    const col = resolveCol(columns, isNullMatch[1]);
    const isNot = Boolean(isNullMatch[2]);
    const nullVal = isNullish(row[col]);
    return isNot ? !nullVal : nullVal;
  }

  // BETWEEN
  const betweenMatch = trimmed.match(/^(.+?)\s+BETWEEN\s+(.+?)\s+AND\s+(.+)$/i);
  if (betweenMatch) {
    const col = resolveCol(columns, betweenMatch[1]);
    const val = row[col];
    const low = parseLiteral(betweenMatch[2]);
    const high = parseLiteral(betweenMatch[3]);
    if (isNullish(val)) return false;
    const numVal = parseNumericValue(val);
    if (numVal !== null && typeof low === 'number' && typeof high === 'number') {
      return numVal >= low && numVal <= high;
    }
    return String(val) >= String(low) && String(val) <= String(high);
  }

  // IN (...)
  const inMatch = trimmed.match(/^(.+?)\s+(NOT\s+)?IN\s*\((.+)\)$/i);
  if (inMatch) {
    const col = resolveCol(columns, inMatch[1]);
    const isNot = Boolean(inMatch[2]);
    const items = splitTopLevelCommas(inMatch[3]).map((it) => String(parseLiteral(it)).toLowerCase());
    const val = isNullish(row[col]) ? '' : String(row[col]).toLowerCase();
    const matched = items.includes(val);
    return isNot ? !matched : matched;
  }

  // LIKE / ILIKE
  const likeMatch = trimmed.match(/^(.+?)\s+(NOT\s+)?I?LIKE\s+(.+)$/i);
  if (likeMatch) {
    const col = resolveCol(columns, likeMatch[1]);
    const isNot = Boolean(likeMatch[2]);
    const pattern = String(parseLiteral(likeMatch[3]) ?? '');
    const regexStr = '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$';
    const re = new RegExp(regexStr, 'i');
    const val = isNullish(row[col]) ? '' : String(row[col]);
    const matched = re.test(val);
    return isNot ? !matched : matched;
  }

  // Binary comparison
  const compMatch = trimmed.match(/^(.+?)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/);
  if (!compMatch) {
    throw new Error(`Unsupported WHERE condition: "${trimmed}"`);
  }

  const col = resolveCol(columns, compMatch[1]);
  const op = compMatch[2];
  const rhs = parseLiteral(compMatch[3]);
  const lhs = row[col];

  if (isNullish(lhs) || rhs === null) {
    return op === '!=' || op === '<>' ? lhs !== rhs : false;
  }

  const lhsNum = parseNumericValue(lhs);
  const rhsNum = typeof rhs === 'number' ? rhs : parseNumericValue(rhs);

  if (lhsNum !== null && rhsNum !== null) {
    switch (op) {
      case '=':
        return lhsNum === rhsNum;
      case '!=':
      case '<>':
        return lhsNum !== rhsNum;
      case '>':
        return lhsNum > rhsNum;
      case '<':
        return lhsNum < rhsNum;
      case '>=':
        return lhsNum >= rhsNum;
      case '<=':
        return lhsNum <= rhsNum;
    }
  }

  const ls = String(lhs).toLowerCase();
  const rs = String(rhs).toLowerCase();
  switch (op) {
    case '=':
      return ls === rs;
    case '!=':
    case '<>':
      return ls !== rs;
    case '>':
      return ls > rs;
    case '<':
      return ls < rs;
    case '>=':
      return ls >= rs;
    case '<=':
      return ls <= rs;
    default:
      return false;
  }
}

interface SelectField {
  raw: string;
  alias: string;
  aggFn?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  targetCol?: string; // '*' or column name
}

function parseSelectFields(selectClause: string, columns: string[]): SelectField[] {
  if (selectClause.trim() === '*') {
    return columns.map((c) => ({ raw: c, alias: c, targetCol: c }));
  }
  const parts = splitTopLevelCommas(selectClause);
  return parts.map((part) => {
    const asMatch = part.match(/^(.+?)\s+AS\s+(.+)$/i);
    const expr = (asMatch ? asMatch[1] : part).trim();
    const alias = asMatch ? unquoteIdent(asMatch[2].trim()) : unquoteIdent(expr);

    const aggMatch = expr.match(/^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(.+?)\s*\)$/i);
    if (aggMatch) {
      const fn = aggMatch[1].toUpperCase() as SelectField['aggFn'];
      const inner = aggMatch[2].trim();
      const targetCol = inner === '*' ? '*' : resolveCol(columns, inner);
      return { raw: expr, alias, aggFn: fn, targetCol };
    }

    const col = resolveCol(columns, expr);
    return { raw: expr, alias: asMatch ? alias : col, targetCol: col };
  });
}

function computeAggregate(fn: SelectField['aggFn'], targetCol: string, groupRows: DatasetRow[]): number | string | null {
  if (fn === 'COUNT') {
    if (targetCol === '*') return groupRows.length;
    return groupRows.filter((r) => !isNullish(r[targetCol])).length;
  }
  const nums = groupRows
    .map((r) => parseNumericValue(r[targetCol]))
    .filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  if (fn === 'SUM') return Number(nums.reduce((a, b) => a + b, 0).toFixed(4));
  if (fn === 'AVG') return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
  if (fn === 'MIN') return Math.min(...nums);
  if (fn === 'MAX') return Math.max(...nums);
  return null;
}

export function executeSafeSQL(dataset: Dataset, rawSql: string): SQLResult {
  const start = performance.now();
  const sql = rawSql.trim().replace(/;+\s*$/, '');

  if (!sql) {
    throw new Error('SQL query cannot be empty.');
  }

  if (FORBIDDEN_KEYWORDS.test(sql)) {
    throw new Error(
      'Unsafe SQL blocked: DataMind SQL Assistant enforces strictly read-only SELECT queries (DROP, DELETE, UPDATE, INSERT, ALTER, and TRUNCATE are prohibited).'
    );
  }

  if (!/^SELECT\b/i.test(sql)) {
    throw new Error('Only SELECT queries are supported.');
  }

  // Extract clauses via regex boundaries
  const match = sql.match(
    /^SELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+FROM\s+([`"\w]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+GROUP\s+BY\s+([\s\S]+?))?(?:\s+HAVING\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i
  );

  if (!match) {
    throw new Error(
      'Could not parse SQL syntax. Expected: SELECT <columns> FROM dataset [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT n]'
    );
  }

  const isDistinct = Boolean(match[1]);
  const selectClause = match[2].trim();
  const tableName = unquoteIdent(match[3]).toLowerCase();
  const whereClause = match[4]?.trim();
  const groupByClause = match[5]?.trim();
  const havingClause = match[6]?.trim();
  const orderByClause = match[7]?.trim();
  const limitNum = match[8] ? Number(match[8]) : undefined;
  const offsetNum = match[9] ? Number(match[9]) : 0;

  if (tableName !== 'dataset' && tableName !== 'data' && tableName !== dataset.name.toLowerCase()) {
    throw new Error(`Table "${tableName}" not found. Query against table name "dataset".`);
  }

  const queryPlanSteps: string[] = [`1. Scan table "dataset" (${dataset.rows.length.toLocaleString()} rows).`];

  // Step 1: WHERE filter
  let filteredRows = dataset.rows;
  if (whereClause) {
    filteredRows = dataset.rows.filter((row) => evaluateCondition(whereClause, row, dataset.columns));
    queryPlanSteps.push(`2. Filter rows matching WHERE (${whereClause}) -> ${filteredRows.length.toLocaleString()} row(s).`);
  }

  const fields = parseSelectFields(selectClause, dataset.columns);
  const hasAggregates = fields.some((f) => Boolean(f.aggFn));
  let projectedRows: Array<Record<string, string | number | boolean | null>> = [];

  // Step 2: GROUP BY or Aggregation
  if (groupByClause || hasAggregates) {
    const groupCols = groupByClause
      ? splitTopLevelCommas(groupByClause).map((g) => resolveCol(dataset.columns, g))
      : [];

    const groups = new Map<string, DatasetRow[]>();
    if (groupCols.length === 0) {
      groups.set('__all__', filteredRows);
    } else {
      for (const row of filteredRows) {
        const key = groupCols.map((c) => String(row[c] ?? '')).join('\u0001');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
    }

    queryPlanSteps.push(
      groupCols.length > 0
        ? `3. Group into ${groups.size.toLocaleString()} bucket(s) by ${groupCols.join(', ')} and compute aggregates.`
        : `3. Compute dataset-wide aggregate metrics across ${filteredRows.length.toLocaleString()} rows.`
    );

    for (const groupRows of groups.values()) {
      const out: Record<string, string | number | boolean | null> = {};
      for (const field of fields) {
        if (field.aggFn && field.targetCol) {
          out[field.alias] = computeAggregate(field.aggFn, field.targetCol, groupRows);
        } else if (field.targetCol) {
          out[field.alias] = groupRows[0]?.[field.targetCol] ?? null;
        }
      }
      projectedRows.push(out);
    }

    if (havingClause) {
      const projectedCols = fields.map((f) => f.alias);
      projectedRows = projectedRows.filter((row) => evaluateCondition(havingClause, row, projectedCols));
      queryPlanSteps.push(`4. Filter grouped rows via HAVING (${havingClause}) -> ${projectedRows.length} group(s).`);
    }
  } else {
    projectedRows = filteredRows.map((row) => {
      const out: Record<string, string | number | boolean | null> = {};
      for (const field of fields) {
        if (field.targetCol) {
          out[field.alias] = row[field.targetCol] ?? null;
        }
      }
      return out;
    });
  }

  // Step 3: DISTINCT
  if (isDistinct) {
    const seen = new Set<string>();
    const outCols = fields.map((f) => f.alias);
    projectedRows = projectedRows.filter((row) => {
      const sig = outCols.map((c) => String(row[c] ?? '')).join('\u0001');
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    queryPlanSteps.push(`Deduplicate result rows (DISTINCT) -> ${projectedRows.length} unique row(s).`);
  }

  // Step 4: ORDER BY
  const outColumns = fields.map((f) => f.alias);
  if (orderByClause) {
    const orderSpecs = splitTopLevelCommas(orderByClause).map((spec) => {
      const m = spec.match(/^(.+?)(?:\s+(ASC|DESC))?$/i);
      const rawCol = unquoteIdent((m ? m[1] : spec).trim());
      const matchedCol =
        outColumns.find((c) => c.toLowerCase() === rawCol.toLowerCase()) ||
        fields.find((f) => f.raw.toLowerCase() === rawCol.toLowerCase())?.alias ||
        rawCol;
      const dir = m && m[2]?.toUpperCase() === 'DESC' ? -1 : 1;
      return { col: matchedCol, dir };
    });

    projectedRows.sort((a, b) => {
      for (const { col, dir } of orderSpecs) {
        const va = a[col];
        const vb = b[col];
        if (va === vb) continue;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        const na = parseNumericValue(va);
        const nb = parseNumericValue(vb);
        if (na !== null && nb !== null) {
          return (na - nb) * dir;
        }
        return String(va).localeCompare(String(vb)) * dir;
      }
      return 0;
    });
    queryPlanSteps.push(`Sort output by ${orderByClause}.`);
  }

  // Step 5: OFFSET / LIMIT
  const totalBeforeLimit = projectedRows.length;
  if (offsetNum > 0 || limitNum !== undefined) {
    const end = limitNum !== undefined ? offsetNum + limitNum : undefined;
    projectedRows = projectedRows.slice(offsetNum, end);
    queryPlanSteps.push(`Return ${projectedRows.length} row(s)${limitNum !== undefined ? ` (LIMIT ${limitNum})` : ''}.`);
  }

  const executionTimeMs = Number((performance.now() - start).toFixed(2));
  return {
    columns: outColumns,
    rows: projectedRows,
    rowCount: totalBeforeLimit,
    executionTimeMs,
    queryPlanSteps,
    engineName: 'Local JS SQL Engine',
  };
}

function escapeSqliteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\r\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

export async function executeSafeSQLAsync(dataset: Dataset, rawSql: string): Promise<SQLResult> {
  const start = performance.now();
  const cleaned = stripSqlComments(rawSql).replace(/;+\s*$/, '');

  if (!cleaned) {
    throw new Error('SQL query cannot be empty.');
  }

  // Disallow multi-statement injection outside string literals
  const outsideQuotes = cleaned.replace(/'([^']|'')*'/g, "''").replace(/"([^"]|"")*"/g, '""');
  if (outsideQuotes.includes(';')) {
    throw new Error('Multiple stacked SQL statements are not allowed. Submit one read-only SELECT or WITH query.');
  }

  if (FORBIDDEN_KEYWORDS.test(outsideQuotes)) {
    throw new Error(
      'Unsafe SQL blocked: DataMind SQL Assistant enforces strictly read-only SELECT/WITH queries (DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, and TRUNCATE are prohibited).'
    );
  }

  if (!/^(SELECT|WITH)\b/i.test(cleaned)) {
    throw new Error('Only read-only SELECT or WITH (CTE) queries are supported.');
  }

  try {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    try {
      const colTypes = new Map(dataset.profile.columns.map((c) => [c.name, c.type]));
      const colDefs = dataset.columns
        .map((c) => {
          const t = colTypes.get(c) === 'number' ? 'REAL' : 'TEXT';
          return `${escapeSqliteIdent(c)} ${t}`;
        })
        .join(', ');

      db.run(`CREATE TABLE dataset (${colDefs});`);
      db.run('CREATE VIEW data AS SELECT * FROM dataset;');

      const placeholders = dataset.columns.map(() => '?').join(', ');
      const insertSql = `INSERT INTO dataset (${dataset.columns.map(escapeSqliteIdent).join(', ')}) VALUES (${placeholders});`;
      db.run('BEGIN TRANSACTION;');
      const stmt = db.prepare(insertSql);
      for (const row of dataset.rows) {
        const params = dataset.columns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return null;
          if (typeof val === 'boolean') return val ? 'true' : 'false';
          return val;
        });
        stmt.run(params);
      }
      stmt.free();
      db.run('COMMIT;');

      // Query plan via SQLite EXPLAIN QUERY PLAN
      const queryPlanSteps: string[] = [];
      try {
        const planRes = db.exec(`EXPLAIN QUERY PLAN ${cleaned}`);
        if (planRes[0]?.values) {
          planRes[0].values.forEach((v, idx) => {
            const detail = String(v[v.length - 1] ?? '');
            if (detail) queryPlanSteps.push(`${idx + 1}. ${detail}`);
          });
        }
      } catch {
        // Non-fatal if EXPLAIN fails; the main query will report syntax errors clearly
      }

      const execRes = db.exec(cleaned);
      const executionTimeMs = Number((performance.now() - start).toFixed(2));

      if (!execRes || execRes.length === 0) {
        return {
          columns: [],
          rows: [],
          rowCount: 0,
          executionTimeMs,
          queryPlanSteps:
            queryPlanSteps.length > 0
              ? queryPlanSteps
              : [`1. Executed SQLite query against table "dataset" (${dataset.rows.length.toLocaleString()} rows) -> 0 rows returned.`],
          engineName: 'SQLite WASM (Relational Engine)',
        };
      }

      const firstSet = execRes[0];
      const outCols = firstSet.columns;
      const outRows = firstSet.values.map((vals) => {
        const rec: Record<string, string | number | boolean | null> = {};
        outCols.forEach((colName, cIdx) => {
          const v = vals[cIdx];
          if (v === undefined || v === null) rec[colName] = null;
          else if (v instanceof Uint8Array) rec[colName] = '[binary]';
          else rec[colName] = v;
        });
        return rec;
      });

      return {
        columns: outCols,
        rows: outRows,
        rowCount: outRows.length,
        executionTimeMs,
        queryPlanSteps:
          queryPlanSteps.length > 0
            ? queryPlanSteps
            : [`1. Scanned "dataset" (${dataset.rows.length.toLocaleString()} rows) -> ${outRows.length.toLocaleString()} result row(s).`],
        engineName: 'SQLite WASM (Relational Engine)',
      };
    } finally {
      db.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('no such column')) {
      throw new Error(`${msg}. Available columns: ${dataset.columns.join(', ')}`);
    }
    if (msg.toLowerCase().includes('no such table')) {
      throw new Error(`${msg}. Query against table name "dataset" (or "data").`);
    }
    if (msg.toLowerCase().includes('syntax error')) {
      throw new Error(`SQL Syntax Error: ${msg}. Verify quotes on column names with spaces (e.g. "Order Date") and comma placement.`);
    }
    throw new Error(msg);
  }
}
