/**
 * Input normalisation for the IBAN Validator (pure: no Apify imports, unit-tested).
 *
 * - No INPUT at all, `{}`, or a run that only carries schema defaults (e.g. `maxItems`)
 *   -> the built-in demo input (DEFAULT_INPUT, identical to the prefill in
 *   .actor/input_schema.json). The platform's daily health run must never fail.
 * - `ibans` and/or `csvText` present but containing no IBAN -> InputError (never run the
 *   demo for a caller whose own list was empty).
 */
import { type InputRecord, recordsFromCsv, recordsFromList } from './csv.js';

export interface ActorInput {
  ibans: string[];
  csvText: string;
  maxItems: number;
}

export const MAX_ITEMS_LIMIT = 100_000;

/** Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces it). */
export const DEFAULT_INPUT: ActorInput = {
  ibans: [
    'GB82 WEST 1234 5698 7654 32',
    'DE89370400440532013000',
    'FR1420041010050500013M02606',
    'NL91ABNA0417164300,ABNANL2A',
    'DE89370400440532013001',
    'NOTANIBAN',
  ],
  csvText: '',
  maxItems: 10_000,
};

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return demoInput();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  let maxItems = DEFAULT_INPUT.maxItems;
  if (obj.maxItems !== undefined && obj.maxItems !== null) {
    if (typeof obj.maxItems !== 'number' || !Number.isFinite(obj.maxItems) || obj.maxItems < 1) {
      throw new InputError('Input field "maxItems" must be a number >= 1.');
    }
    maxItems = Math.min(Math.floor(obj.maxItems), MAX_ITEMS_LIMIT);
  }

  const hasIbans = obj.ibans !== undefined && obj.ibans !== null;
  const hasCsv = obj.csvText !== undefined && obj.csvText !== null;
  if (!hasIbans && !hasCsv) return { ...demoInput(), maxItems };

  let ibans: string[] = [];
  if (hasIbans) {
    if (!Array.isArray(obj.ibans)) throw new InputError('Input field "ibans" must be an array of strings.');
    ibans = obj.ibans.map((x) => (typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x)));
  }
  let csvText = '';
  if (hasCsv) {
    if (typeof obj.csvText !== 'string') throw new InputError('Input field "csvText" must be a string.');
    csvText = obj.csvText;
  }

  const input: ActorInput = { ibans, csvText, maxItems };
  if (collectRecords(input).records.length === 0) {
    throw new InputError('No IBANs found: "ibans" and "csvText" contain only blank entries. Add at least one IBAN.');
  }
  return input;
}

export interface CollectedRecords {
  records: InputRecord[];
  skippedBlank: number;
  csvHeaderDetected: boolean;
}

/** All records: the `ibans` list first, then the CSV rows; positions are per source. */
export function collectRecords(input: Pick<ActorInput, 'ibans' | 'csvText'>): CollectedRecords {
  const fromList = recordsFromList(input.ibans);
  const fromCsv = recordsFromCsv(input.csvText);
  return {
    records: [...fromList.records, ...fromCsv.records],
    skippedBlank: fromList.skippedBlank + fromCsv.skippedBlank,
    csvHeaderDetected: fromCsv.headerDetected,
  };
}


function demoInput(): ActorInput {
  return { ibans: [...DEFAULT_INPUT.ibans], csvText: DEFAULT_INPUT.csvText, maxItems: DEFAULT_INPUT.maxItems };
}
