/**
 * Input normalisation for the Israeli ID / company / IBAN / phone / postcode validator (pure, unit-tested).
 *
 * - No INPUT at all, `{}`, or a run that only carries schema defaults (`type`, `maxItems`, flags)
 *   -> the built-in demo values (DEFAULT_INPUT, identical to the prefill in .actor/input_schema.json).
 *   The platform's daily health run must never fail.
 * - `values` present but containing nothing to check -> InputError (never run the demo for a caller whose own
 *   list was empty).
 */
import { isBlank } from './text.js';
import { REQUESTED_TYPES, type RequestedType } from './types.js';

export interface ActorInput {
  /** Raw entries as supplied (strings, numbers ...); see collectRecords. */
  values: unknown[];
  type: RequestedType;
  rejectDummy: boolean;
  normalize: boolean;
  maxItems: number;
}

export const MAX_ITEMS_LIMIT = 100_000;

/**
 * Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces it). All values are
 * synthetic: 123456782 is the well-known test ID, the IBAN is the SWIFT registry example for Israel, the
 * phone numbers and the postcode are patterns, not real subscribers.
 */
export const DEFAULT_INPUT: ActorInput = {
  values: ['123456782', '123456789', 'IL620108000000099999999', '050-1234567', '053-1234567', '2222222'],
  type: 'auto',
  rejectDummy: true,
  normalize: true,
  maxItems: 10_000,
};

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

function demoInput(): ActorInput {
  return { ...DEFAULT_INPUT, values: [...DEFAULT_INPUT.values] };
}

function readBoolean(obj: Record<string, unknown>, key: 'rejectDummy' | 'normalize'): boolean {
  const v = obj[key];
  if (v === undefined || v === null) return DEFAULT_INPUT[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new InputError(`Input field "${key}" must be true or false.`);
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

  let type: RequestedType = DEFAULT_INPUT.type;
  if (obj.type !== undefined && obj.type !== null) {
    const wanted = typeof obj.type === 'string' ? obj.type.trim().toLowerCase() : '';
    const match = REQUESTED_TYPES.find((t) => t === wanted);
    if (!match) throw new InputError(`Input field "type" must be one of: ${REQUESTED_TYPES.join(', ')}.`);
    type = match;
  }
  const rejectDummy = readBoolean(obj, 'rejectDummy');
  const normalize = readBoolean(obj, 'normalize');

  if (obj.values === undefined || obj.values === null) return { ...demoInput(), type, rejectDummy, normalize, maxItems };

  let values: unknown[];
  if (Array.isArray(obj.values)) values = obj.values;
  else if (typeof obj.values === 'string') values = obj.values.split(/\r\n|\n|\r/);
  else throw new InputError('Input field "values" must be an array of strings (one value per entry).');

  const input: ActorInput = { values, type, rejectDummy, normalize, maxItems };
  if (collectRecords(values).records.length === 0) {
    throw new InputError('No values to check: "values" contains only blank or unsupported entries. Add at least one value.');
  }
  return input;
}

export interface InputRecord {
  /** The cell exactly as provided (not trimmed), so results can be joined back to the input. */
  input: string;
  /** 1-based position among the non-blank entries. */
  position: number;
}

export interface CollectedRecords {
  records: InputRecord[];
  /** Blank entries (null, empty, whitespace or only invisible characters): not checked, not charged. */
  skippedBlank: number;
  /** Booleans, objects and other entries that cannot be a value: not checked, not charged. */
  skippedUnsupported: number;
}

/** Strings are used as they are, numbers are converted (JSON has no leading zeros: 0501234567 arrives as 501234567). */
export function collectRecords(values: readonly unknown[]): CollectedRecords {
  const records: InputRecord[] = [];
  let skippedBlank = 0;
  let skippedUnsupported = 0;
  for (const entry of values) {
    let text: string;
    if (typeof entry === 'string') text = entry;
    else if (typeof entry === 'number' && Number.isFinite(entry)) text = String(entry);
    else if (typeof entry === 'bigint') text = String(entry);
    else if (entry === null || entry === undefined) {
      skippedBlank += 1;
      continue;
    } else {
      skippedUnsupported += 1;
      continue;
    }
    if (isBlank(text)) {
      skippedBlank += 1;
      continue;
    }
    records.push({ input: text, position: records.length + 1 });
  }
  return { records, skippedBlank, skippedUnsupported };
}
