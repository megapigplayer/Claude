/**
 * The public entry point of the pure library: one input cell -> one ValueCheck. Never throws.
 *
 * Pipeline: clean (invisible characters, exotic digits/spaces) -> strip a leading label ("ת.ז.", "IBAN:") ->
 * pick the candidate type(s) (requested type, label, or shape detection) -> run the checker(s) -> assemble.
 */
import { detectCandidates } from './detect.js';
import { checkIsraeliIban } from './iban.js';
import { stripLabel } from './labels.js';
import { checkNineDigitNumber } from './number.js';
import { checkIsraeliPhone } from './phone.js';
import { checkPostcode } from './postcode.js';
import { cleanInput } from './text.js';
import type { CheckOptions, TypeCheck, ValueCheck, ValueType, WarningCode } from './types.js';

/**
 * What a passing result does NOT prove. Repeated in every result on purpose (spec: "say so in every result").
 */
export const NOTES: Readonly<Record<ValueType | 'unknown', string>> = {
  id: 'Checksum check only: a correct check digit does not prove that this ID number belongs to a real person.',
  company: 'Checksum check only, no registry lookup: a correct check digit does not prove that the company or dealer exists.',
  iban: 'ISO 13616 structure and mod 97-10 check only: does not prove that the account exists, is open, or belongs to anyone.',
  phone: 'Numbering-plan check only: does not prove that the number is assigned, active or reachable.',
  postcode: 'Format check only (7 digits): the code is not looked up in the Israel Post directory.',
  unknown: 'No check could be applied because the type could not be recognised: set "type" explicitly.',
};

export const DEFAULT_OPTIONS: CheckOptions = { type: 'auto', rejectDummy: true, normalize: true };

const OTHER_TYPE_HINT = 'Set "type" to remove the ambiguity.';

function runChecker(type: ValueType, text: string, options: CheckOptions): TypeCheck {
  switch (type) {
    case 'id':
    case 'company':
      return checkNineDigitNumber(text, { kind: type, rejectDummy: options.rejectDummy, normalize: options.normalize });
    case 'iban':
      return checkIsraeliIban(text, options.normalize);
    case 'phone':
      return checkIsraeliPhone(text, options.normalize);
    case 'postcode':
      return checkPostcode(text, options.rejectDummy, options.normalize);
  }
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** id and company share one algorithm: a label for one is not a conflict with a request for the other. */
function compatible(a: ValueType, b: ValueType): boolean {
  return a === b || (['id', 'company'] as ValueType[]).includes(a) && (['id', 'company'] as ValueType[]).includes(b);
}

function unrecognised(reasonCode: 'EMPTY' | 'UNKNOWN_FORMAT', reason: string, warnings: WarningCode[]): ValueCheck {
  return {
    type: null,
    valid: false,
    reasonCode,
    reason,
    normalized: null,
    ambiguous: false,
    alsoValidAs: [],
    details: null,
    warnings,
    note: NOTES.unknown,
  };
}

export function checkValue(raw: string, options: CheckOptions = DEFAULT_OPTIONS): ValueCheck {
  const cleaned = cleanInput(raw, options.normalize);
  const baseWarnings: WarningCode[] = [...cleaned.warnings];
  let text = cleaned.text;
  if (text === '') return unrecognised('EMPTY', 'The value is empty (only whitespace or invisible characters).', baseWarnings);

  let labelType: ValueType | null = null;
  if (options.normalize) {
    const stripped = stripLabel(text);
    if (stripped) {
      text = stripped.text;
      labelType = stripped.type;
      baseWarnings.push('LABEL_REMOVED');
      if (text === '') return unrecognised('EMPTY', 'Only a label was found, without a value after it.', baseWarnings);
    }
  }

  let candidates: ValueType[];
  if (options.type !== 'auto') {
    candidates = [options.type];
    if (labelType !== null && !compatible(labelType, options.type)) baseWarnings.push('LABEL_TYPE_MISMATCH');
  } else if (labelType !== null) {
    candidates = [labelType];
  } else {
    candidates = detectCandidates(text);
  }

  if (candidates.length === 0) {
    return unrecognised(
      'UNKNOWN_FORMAT',
      'Could not recognise the value as an Israeli ID (5-9 digits), company number (9 digits), IBAN (IL + 21 characters), phone number or 7-digit postcode. Set "type" explicitly to get a specific reason.',
      baseWarnings,
    );
  }

  const results = candidates.map((type) => ({ type, check: runChecker(type, text, options) }));
  const valid = results.filter((r) => r.check.valid);
  const primary = valid[0] ?? results[0];
  if (!primary) return unrecognised('UNKNOWN_FORMAT', 'No candidate type.', baseWarnings); // unreachable: candidates is non-empty
  const alsoValidAs = valid.slice(1).map((r) => r.type);
  const ambiguous = alsoValidAs.length > 0;

  const warnings = unique<WarningCode>([...baseWarnings, ...primary.check.warnings, ...(ambiguous ? (['AMBIGUOUS_TYPE'] as WarningCode[]) : [])]);
  const reason = ambiguous
    ? `${primary.check.reason} The value is also valid as ${alsoValidAs.join(' / ')} (the same digits satisfy more than one rule). ${OTHER_TYPE_HINT}`
    : primary.check.reason;

  return {
    type: primary.type,
    valid: primary.check.valid,
    reasonCode: primary.check.reasonCode,
    reason,
    normalized: primary.check.normalized,
    ambiguous,
    alsoValidAs,
    details: primary.check.details,
    warnings,
    note: NOTES[primary.type],
  };
}
