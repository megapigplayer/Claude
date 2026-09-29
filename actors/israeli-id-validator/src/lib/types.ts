/**
 * Shared types for the Israeli ID / company / IBAN / phone / postcode checks (pure, no I/O).
 */

export type ValueType = 'id' | 'company' | 'iban' | 'phone' | 'postcode';
export type RequestedType = 'auto' | ValueType;

export const VALUE_TYPES: readonly ValueType[] = ['id', 'company', 'iban', 'phone', 'postcode'];
export const REQUESTED_TYPES: readonly RequestedType[] = ['auto', ...VALUE_TYPES];

/** Machine-readable verdict reason (UPPER_SNAKE, see README "Reason codes"). */
export type ReasonCode =
  | 'OK'
  | 'EMPTY'
  | 'INVALID_CHARACTERS'
  | 'WRONG_LENGTH'
  | 'BAD_CHECKSUM'
  | 'BAD_FORMAT'
  | 'DUMMY'
  | 'NOT_ISRAELI'
  | 'UNKNOWN_FORMAT';

/** Non-fatal observations attached to a result (see README "Warnings"). */
export type WarningCode =
  | 'LEADING_ZEROS_RESTORED'
  | 'INVISIBLE_CHARACTERS_REMOVED'
  | 'NON_ASCII_DIGITS_CONVERTED'
  | 'LABEL_REMOVED'
  | 'LABEL_TYPE_MISMATCH'
  | 'DUMMY_PATTERN'
  | 'WELL_KNOWN_TEST_NUMBER'
  | 'AMBIGUOUS_TYPE'
  | 'EXTENSION_IGNORED'
  | 'NOT_CORPORATE_PREFIX';

export interface CheckOptions {
  /** `auto` detects the type from the value's shape (see README "How auto-detection works"). */
  type: RequestedType;
  /** Reject placeholder numbers (all zero / repeated / sequential digits) that would otherwise pass. */
  rejectDummy: boolean;
  /** Clean the value before checking (separators, RTL marks, Arabic-Indic digits, dropped leading zeros). */
  normalize: boolean;
}

/** Outcome of checking a value against ONE type. */
export interface TypeCheck {
  valid: boolean;
  reasonCode: ReasonCode;
  /** Human-readable explanation (always set). */
  reason: string;
  /** Canonical form; only for valid values. */
  normalized: string | null;
  /**
   * Type-specific facts. Only for values that passed the structural checks (plus the diagnostic
   * `expectedCheckDigit` / `expectedCheckDigits` on a checksum failure); null otherwise.
   */
  details: Record<string, string | number | boolean | null> | null;
  warnings: WarningCode[];
}

/** Final outcome for one input cell. */
export interface ValueCheck extends TypeCheck {
  /** Detected or requested type; null when `auto` could not recognise the value. */
  type: ValueType | null;
  /** True when (in `auto` mode) the value is valid under more than one type. */
  ambiguous: boolean;
  alsoValidAs: ValueType[];
  /** One sentence saying what this check does NOT prove (repeated in every result on purpose). */
  note: string;
}
