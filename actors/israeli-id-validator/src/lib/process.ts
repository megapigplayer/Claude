/**
 * One input record -> one output row (pure; never throws), plus run-summary bookkeeping.
 * Output field names are camelCase (CONVENTIONS.md "Output field naming"); the key order below is the
 * documented column order.
 */
import { checkValue } from './check.js';
import type { InputRecord } from './input.js';
import type { CheckOptions, ReasonCode, ValueCheck, ValueType, WarningCode } from './types.js';

export interface ResultRow {
  /** The cell exactly as provided. */
  input: string;
  /** 1-based position among the non-blank entries. */
  position: number;
  /** Detected (auto) or requested type; null when the value was not recognised. */
  type: ValueType | null;
  valid: boolean;
  reasonCode: ReasonCode | 'INTERNAL_ERROR';
  reason: string;
  /** Canonical form (valid values only). */
  normalized: string | null;
  ambiguous: boolean;
  alsoValidAs: ValueType[];
  details: ValueCheck['details'];
  warnings: WarningCode[];
  note: string;
}

export function buildRow(record: InputRecord, options: CheckOptions): ResultRow {
  const c = checkValue(record.input, options);
  return {
    input: record.input,
    position: record.position,
    type: c.type,
    valid: c.valid,
    reasonCode: c.reasonCode,
    reason: c.reason,
    normalized: c.normalized,
    ambiguous: c.ambiguous,
    alsoValidAs: c.alsoValidAs,
    details: c.details,
    warnings: c.warnings,
    note: c.note,
  };
}

/** Row for an unexpected exception while checking one record (never expected; keeps the run alive, not charged). */
export function internalErrorRow(record: InputRecord, err: unknown): ResultRow {
  const message = err instanceof Error ? err.message : String(err);
  return {
    input: record.input,
    position: record.position,
    type: null,
    valid: false,
    reasonCode: 'INTERNAL_ERROR',
    reason: `Unexpected error while checking this entry: ${message}`,
    normalized: null,
    ambiguous: false,
    alsoValidAs: [],
    details: null,
    warnings: [],
    note: 'No check result: an internal error occurred for this entry (it is not charged).',
  };
}

/** Never throws: falls back to an INTERNAL_ERROR row. */
export function safeBuildRow(
  record: InputRecord,
  options: CheckOptions,
  build: (r: InputRecord, o: CheckOptions) => ResultRow = buildRow,
): ResultRow {
  try {
    return build(record, options);
  } catch (err) {
    return internalErrorRow(record, err);
  }
}

/** Rows that could be processed are charged, rows lost to an internal error are not (CONVENTIONS 4.3). */
export function isChargeable(row: ResultRow): boolean {
  return row.reasonCode !== 'INTERNAL_ERROR';
}

export interface RunSummary {
  total: number;
  valid: number;
  invalid: number;
  ambiguous: number;
  byType: Record<string, number>;
  byReasonCode: Record<string, number>;
  skippedBlank: number;
  skippedUnsupported: number;
  truncatedByMaxItems: number;
  stoppedForBudget: boolean;
}

export function emptySummary(): RunSummary {
  return {
    total: 0,
    valid: 0,
    invalid: 0,
    ambiguous: 0,
    byType: {},
    byReasonCode: {},
    skippedBlank: 0,
    skippedUnsupported: 0,
    truncatedByMaxItems: 0,
    stoppedForBudget: false,
  };
}

export function addToSummary(summary: RunSummary, row: ResultRow): void {
  summary.total += 1;
  if (row.valid) summary.valid += 1;
  else summary.invalid += 1;
  if (row.ambiguous) summary.ambiguous += 1;
  const type = row.type ?? 'unknown';
  summary.byType[type] = (summary.byType[type] ?? 0) + 1;
  summary.byReasonCode[row.reasonCode] = (summary.byReasonCode[row.reasonCode] ?? 0) + 1;
}
