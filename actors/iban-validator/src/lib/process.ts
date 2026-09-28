/**
 * One input record -> one output row (pure; never throws), plus run-summary bookkeeping.
 * Output field names are camelCase (CONVENTIONS.md "Output field naming").
 */
import { checkBic } from './bic.js';
import type { InputRecord, InputSource } from './csv.js';
import { checkIban, type IbanReasonCode } from './iban.js';

export interface IbanResultRow {
  input: string;
  source: InputSource;
  position: number;
  valid: boolean;
  reasonCode: IbanReasonCode | 'INTERNAL_ERROR';
  reason: string;
  iban: string | null;
  ibanFormatted: string | null;
  countryCode: string | null;
  countryName: string | null;
  checkDigits: string | null;
  bban: string | null;
  bankCode: string | null;
  branchCode: string | null;
  accountNumber: string | null;
  bic: string | null;
  bicValid: boolean | null;
  bicReason: string | null;
}

export function buildRow(record: InputRecord): IbanResultRow {
  const iban = checkIban(record.input);
  const bic = checkBic(record.bic);
  return {
    input: record.input,
    source: record.source,
    position: record.position,
    valid: iban.valid,
    reasonCode: iban.reasonCode,
    reason: iban.reason,
    iban: iban.iban,
    ibanFormatted: iban.ibanFormatted,
    countryCode: iban.countryCode,
    countryName: iban.countryName,
    checkDigits: iban.checkDigits,
    bban: iban.bban,
    bankCode: iban.bankCode,
    branchCode: iban.branchCode,
    accountNumber: iban.accountNumber,
    bic: bic.bic,
    bicValid: bic.valid,
    bicReason: bic.reason,
  };
}

/** Row for an unexpected exception while processing one record (never expected; keeps the run alive). */
export function internalErrorRow(record: InputRecord, err: unknown): IbanResultRow {
  const message = err instanceof Error ? err.message : String(err);
  return {
    input: record.input,
    source: record.source,
    position: record.position,
    valid: false,
    reasonCode: 'INTERNAL_ERROR',
    reason: `Unexpected error while checking this entry: ${message}`,
    iban: null,
    ibanFormatted: null,
    countryCode: null,
    countryName: null,
    checkDigits: null,
    bban: null,
    bankCode: null,
    branchCode: null,
    accountNumber: null,
    bic: null,
    bicValid: null,
    bicReason: null,
  };
}

/** Never throws: falls back to an INTERNAL_ERROR row. */
export function safeBuildRow(record: InputRecord, build: (r: InputRecord) => IbanResultRow = buildRow): IbanResultRow {
  try {
    return build(record);
  } catch (err) {
    return internalErrorRow(record, err);
  }
}

export interface RunSummary {
  total: number;
  valid: number;
  invalid: number;
  bicProvided: number;
  bicInvalid: number;
  byReasonCode: Record<string, number>;
  byCountry: Record<string, number>;
  skippedBlank: number;
  truncatedByMaxItems: number;
  stoppedForBudget: boolean;
}

export function emptySummary(): RunSummary {
  return {
    total: 0,
    valid: 0,
    invalid: 0,
    bicProvided: 0,
    bicInvalid: 0,
    byReasonCode: {},
    byCountry: {},
    skippedBlank: 0,
    truncatedByMaxItems: 0,
    stoppedForBudget: false,
  };
}

export function addToSummary(summary: RunSummary, row: IbanResultRow): void {
  summary.total += 1;
  if (row.valid) summary.valid += 1;
  else summary.invalid += 1;
  if (row.bicValid !== null) summary.bicProvided += 1;
  if (row.bicValid === false) summary.bicInvalid += 1;
  summary.byReasonCode[row.reasonCode] = (summary.byReasonCode[row.reasonCode] ?? 0) + 1;
  if (row.countryCode) summary.byCountry[row.countryCode] = (summary.byCountry[row.countryCode] ?? 0) + 1;
}
