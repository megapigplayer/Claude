/**
 * Row rules: check and repair one feed row (pure, never throws for bad data).
 *
 * The same code path runs in two modes:
 *   'fix'   - values are repaired and every repair is logged as a Change;
 *   'check' - nothing is modified; every repair that WOULD happen is reported as a fixable Issue.
 * `validateRow` (mode 'check') is the validator the tests use: a fixed row must validate clean, and
 * fixing a fixed row must change nothing (idempotency).
 *
 * Conservative by design: only deterministic syntax repairs are applied. Anything that would need a
 * guess (missing price, unknown enum word, GTIN with a wrong check digit, relative URL without a base
 * URL, ...) becomes an Issue and the value is left exactly as it was.
 */
import { checkGtin } from './gtin.js';
import { compareAmounts, parsePrice } from './price.js';
import {
  CODE_LIKE_FIELDS,
  ENUM_FIELDS,
  FIELDS,
  HTML_STRIP_FIELDS,
  MULTILINE_FIELDS,
  REQUIRED_FIELDS,
  type RuleId,
  type Severity,
} from './spec.js';
import { cleanValue, codePointLength, excerpt, findPromo, isShouting, looksLikeHtml, stripHtml, truncateToLimit } from './text.js';
import { normalizeUrl, splitUrlList } from './url.js';
import { checkDateRange, compileEnum, isPlaceholder, normalizeEnum, normalizeInteger } from './values.js';

export type Row = Record<string, string>;
export type RowStatus = 'ok' | 'fixed' | 'unfixable' | 'removed';

/** Explicit, user-supplied fallbacks. Nothing is ever filled from anywhere else. */
export interface Defaults {
  /** ISO 4217 code for prices without a currency. */
  currency?: string;
  condition?: string;
  brand?: string;
  availability?: string;
  /** Absolute http(s) URL relative links are resolved against. */
  baseUrl?: string;
}

export interface FixOptions {
  defaults: Defaults;
  disabledRules: ReadonlySet<string>;
  /** Pad valid GTINs with leading zeros up to 13 or 14 digits. */
  padGtin: 'keep' | '13' | '14';
  /** Remove invalid OPTIONAL values (bad GTIN, bad sale price, unknown gender ...) instead of only reporting them. */
  clearInvalidOptional: boolean;
  duplicateIds: 'remove-exact' | 'rename' | 'flag';
}

export const DEFAULT_FIX_OPTIONS: FixOptions = {
  defaults: {},
  disabledRules: new Set<string>(),
  padGtin: 'keep',
  clearInvalidOptional: false,
  duplicateIds: 'remove-exact',
};

export interface Change {
  field: string;
  before: string;
  after: string;
  ruleId: RuleId;
  severity: Severity;
  message: string;
}

export interface Issue {
  field: string;
  ruleId: RuleId;
  severity: Severity;
  message: string;
  suggestion: string | null;
  /** Only in mode 'check': the problem has an automatic repair. */
  fixable?: boolean;
}

export interface RowFix {
  row: Row;
  changes: Change[];
  issues: Issue[];
}

const ENUMS = {
  availability: compileEnum(ENUM_FIELDS.availability, 'availability'),
  condition: compileEnum(ENUM_FIELDS.condition, 'condition'),
  gender: compileEnum(ENUM_FIELDS.gender, 'gender'),
  age_group: compileEnum(ENUM_FIELDS.age_group, 'age_group'),
};

const ENUM_RULE: Record<keyof typeof ENUMS, RuleId> = {
  availability: 'availability-enum',
  condition: 'condition-enum',
  gender: 'attribute-enums',
  age_group: 'attribute-enums',
};

/** Fields are processed in this order (the rest follow in column order). */
const FIELD_ORDER = [
  'id', 'title', 'description', 'short_description', 'rich_text_description', 'availability', 'condition', 'price', 'sale_price',
  'sale_price_effective_date', 'link', 'image_link', 'additional_image_link', 'brand', 'gtin', 'mpn', 'item_group_id', 'gender', 'age_group',
  'quantity_to_sell_on_facebook', 'inventory',
];

const META_PRICE_PATTERN = /^\d+(?:\.\d+)? [A-Z]{3}$/;

// ---------------------------------------------------------------------------------------------
// Recorder: applies or reports, depending on the mode
// ---------------------------------------------------------------------------------------------

class Recorder {
  readonly changes: Change[] = [];
  readonly issues: Issue[] = [];

  constructor(
    readonly row: Row,
    readonly options: FixOptions,
    readonly mode: 'fix' | 'check',
  ) {}

  on(rule: RuleId): boolean {
    return !this.options.disabledRules.has(rule);
  }

  get(field: string): string {
    return this.row[field] ?? '';
  }

  change(field: string, after: string, ruleId: RuleId, severity: Severity, message: string, before: string = this.get(field)): void {
    if (before === after) return;
    if (this.mode === 'fix') {
      this.row[field] = after;
      this.changes.push({ field, before, after, ruleId, severity, message });
    } else {
      this.issues.push({ field, ruleId, severity, message: `${message} (would change "${excerpt(before)}" to "${excerpt(after)}")`, suggestion: after, fixable: true });
    }
  }

  issue(field: string, ruleId: RuleId, severity: Severity, message: string, suggestion: string | null = null): void {
    this.issues.push({ field, ruleId, severity, message, suggestion });
  }
}

/**
 * One field going through several rules. Whitespace cleaning is silent: it is folded into the first
 * substantive change, and logged as its own change only when nothing else touched the field.
 */
class FieldPipe {
  readonly original: string;
  current: string;
  private logged = false;

  constructor(
    private readonly rec: Recorder,
    readonly field: string,
  ) {
    this.original = rec.get(field);
    this.current = this.original;
  }

  /** Silent normalisation before the rules look at the value. */
  clean(value: string): void {
    this.current = value;
  }

  apply(after: string, ruleId: RuleId, severity: Severity, message: string): void {
    if (after === this.current) return;
    const before = this.logged ? this.current : this.original;
    this.rec.change(this.field, after, ruleId, severity, message, before);
    this.current = after;
    this.logged = true;
  }

  finish(): void {
    if (!this.logged && this.current !== this.original && this.rec.on('whitespace')) {
      this.rec.change(this.field, this.current, 'whitespace', 'info', 'whitespace / invisible characters normalised', this.original);
    } else if (!this.logged && this.current !== this.original) {
      this.current = this.original;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Row processing
// ---------------------------------------------------------------------------------------------

function orderedFields(row: Row): string[] {
  const keys = Object.keys(row);
  const present = new Set(keys);
  const ordered = FIELD_ORDER.filter((f) => present.has(f));
  const known = new Set(ordered);
  return [...ordered, ...keys.filter((k) => !known.has(k))];
}

const defaultFor = (rec: Recorder, field: string): string | undefined => {
  const d = rec.options.defaults;
  if (field === 'condition') return d.condition;
  if (field === 'brand') return d.brand;
  if (field === 'availability') return d.availability;
  return undefined;
};

/** Phase 1: blank required fields get the explicit user default (through the same repair path: a change with before = ""). */
function applyDefaults(rec: Recorder): void {
  if (!rec.on('required-fields')) return;
  for (const field of ['availability', 'condition', 'brand']) {
    const fallback = defaultFor(rec, field);
    if (fallback === undefined || fallback === '') continue;
    const current = rec.get(field);
    const blank = current.trim() === '' || (field === 'brand' && isPlaceholder(current));
    if (blank) rec.change(field, fallback, 'required-fields', 'error', `${field} was ${current.trim() === '' ? 'missing' : `a placeholder ("${current.trim()}")`}: filled from the "defaults" input`);
  }
}

function processField(rec: Recorder, field: string): void {
  const spec = FIELDS[field];
  const raw = rec.get(field);
  if (raw === '') return;
  const pipe = new FieldPipe(rec, field);

  const kind = spec?.kind ?? 'unknown';
  const multiline = MULTILINE_FIELDS.includes(field);
  const stripBidi = CODE_LIKE_FIELDS.includes(field);

  // HTML comes off first: it may hide whitespace and line breaks.
  if (HTML_STRIP_FIELDS.includes(field) && rec.on('html-in-text') && looksLikeHtml(raw)) {
    pipe.apply(stripHtml(raw), 'html-in-text', 'warning', 'HTML tags/entities removed (Meta expects plain text)');
  }
  pipe.clean(cleanValue(pipe.current, { multiline: multiline || kind === 'unknown', stripBidi }));

  switch (kind) {
    case 'code':
      processCode(rec, pipe);
      break;
    case 'text':
    case 'multiline':
    case 'label':
      processText(rec, pipe);
      break;
    case 'enum':
      processEnum(rec, pipe);
      break;
    case 'price':
      processPrice(rec, pipe);
      break;
    case 'dateRange':
      processDateRange(rec, pipe);
      break;
    case 'url':
      processUrl(rec, pipe);
      break;
    case 'urlList':
      processUrlList(rec, pipe);
      break;
    case 'gtin':
      processGtin(rec, pipe);
      break;
    case 'int':
      processInt(rec, pipe);
      break;
    default:
      break;
  }
  pipe.finish();
}

function processCode(rec: Recorder, pipe: FieldPipe): void {
  const { field } = pipe;
  if (field === 'mpn' && isPlaceholder(pipe.current)) {
    pipe.apply('', 'required-fields', 'warning', `placeholder "${pipe.current}" removed (it means "no value")`);
    return;
  }
  if (rec.on('spreadsheet-damage') && pipe.current !== '') {
    const float = /^(\d+)\.0+$/.exec(pipe.current);
    if (float) pipe.apply(float[1] as string, 'spreadsheet-damage', 'error', '".0" suffix from a spreadsheet number format removed');
    else if (/^\d(?:\.\d+)?E\+\d{2}$/i.test(pipe.current)) {
      rec.issue(field, 'spreadsheet-damage', 'error', `"${pipe.current}" is scientific notation from a spreadsheet: the original digits are lost. Re-export the column as text`);
    }
  }
  const limit = FIELDS[field]?.maxLength;
  if (limit !== undefined && codePointLength(pipe.current) > limit) {
    const rule: RuleId = field === 'id' ? 'id-length' : 'length-limits';
    if (rec.on(rule)) rec.issue(field, rule, field === 'id' ? 'error' : 'warning', `${field} has ${codePointLength(pipe.current)} characters; the limit is ${limit}. It is not shortened automatically (codes must stay identical to your other systems)`);
  }
}

function processText(rec: Recorder, pipe: FieldPipe): void {
  const { field } = pipe;
  const spec = FIELDS[field];
  if (field === 'brand' && isPlaceholder(pipe.current)) return; // handled with the required fields
  if (spec?.maxLength !== undefined && rec.on('length-limits')) {
    const len = codePointLength(pipe.current);
    if (len > spec.maxLength) {
      const cut = truncateToLimit(pipe.current, spec.maxLength);
      pipe.apply(cut, 'length-limits', 'warning', `${field} shortened from ${len} to ${codePointLength(cut)} characters (limit ${spec.maxLength})`);
    } else if (spec.softMaxLength !== undefined && len > spec.softMaxLength) {
      rec.issue(field, 'length-limits', 'warning', `${field} has ${len} characters; Meta recommends at most ${spec.softMaxLength}`);
    }
  }
  if (field === 'title' || field === 'description') {
    if (rec.on('shouting') && isShouting(pipe.current)) rec.issue(field, 'shouting', 'warning', `${field} is written in capital letters; Meta does not support all-caps text (not changed)`);
  }
  if (field === 'title' && rec.on('promo-text')) {
    const hits = findPromo(pipe.current);
    if (hits.length > 0) {
      rec.issue(field, 'promo-text', 'warning', `title contains promotional text (${hits.map((h) => `${h.label}: "${excerpt(h.match, 30)}"`).join(', ')}); Meta asks for product names only (not changed)`);
    }
  }
}

function processEnum(rec: Recorder, pipe: FieldPipe): void {
  const { field } = pipe;
  const name = field as keyof typeof ENUMS;
  const rule = ENUM_RULE[name];
  if (!rec.on(rule)) return;
  const spec = ENUM_FIELDS[name];
  const out = normalizeEnum(ENUMS[name], pipe.current);
  switch (out.status) {
    case 'canonical':
      return;
    case 'case-only':
      pipe.apply(out.value, rule, 'info', `${field} "${pipe.original}" written in Meta's form "${out.value}"`);
      return;
    case 'accepted-extra':
      pipe.apply(out.value, rule, 'info', `${field} normalised to "${out.value}"`);
      return;
    case 'mapped':
      pipe.apply(out.value, rule, 'error', `${field} "${excerpt(pipe.original, 40)}" is not a Meta value: replaced by "${out.value}"`);
      return;
    case 'heuristic':
      pipe.apply(out.value, rule, 'warning', `${field} "${excerpt(pipe.original, 40)}" was interpreted as "${out.value}": please review`);
      return;
    case 'unknown': {
      const optional = field === 'gender' || field === 'age_group';
      if (optional && rec.options.clearInvalidOptional) {
        pipe.apply('', rule, 'warning', `invalid ${field} "${excerpt(pipe.current, 40)}" removed (clearInvalidOptional)`);
      } else {
        rec.issue(field, rule, 'error', `${field} "${excerpt(pipe.current, 40)}" is not a recognised value; use one of: ${spec.values.join(', ')}`);
      }
    }
  }
}

function processPrice(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on(pipe.field === 'price' ? 'price-format' : 'sale-price')) return;
  const rule: RuleId = pipe.field === 'price' ? 'price-format' : 'sale-price';
  let defaultCurrency = rec.options.defaults.currency;
  if (pipe.field === 'sale_price') {
    const base = parsePrice(rec.get('price'), { defaultCurrency });
    if (base.ok) defaultCurrency = base.currency; // a sale price without currency inherits the price's currency
  }
  const res = parsePrice(pipe.current, { defaultCurrency });
  if (!res.ok) {
    if (pipe.field === 'sale_price' && rec.options.clearInvalidOptional) {
      pipe.apply('', rule, 'warning', `invalid sale_price removed (clearInvalidOptional): ${res.message}`);
      clearSaleDateIfOrphaned(rec);
    } else {
      rec.issue(pipe.field, rule, 'error', `${pipe.field}: ${res.message}`);
    }
    return;
  }
  if (res.normalized !== pipe.current) {
    const severity: Severity = META_PRICE_PATTERN.test(pipe.original) ? 'info' : 'error';
    pipe.apply(res.normalized, rule, severity, `${pipe.field} normalised to Meta's format${res.notes.length > 0 ? ` (${res.notes.join('; ')})` : ''}`);
  }
  for (const w of res.warnings) rec.issue(pipe.field, rule, 'warning', `${pipe.field}: ${w}`);
}

function clearSaleDateIfOrphaned(rec: Recorder): void {
  if (rec.get('sale_price_effective_date') !== '' && rec.on('sale-price-dates')) {
    rec.change('sale_price_effective_date', '', 'sale-price-dates', 'warning', 'sale date range removed together with the invalid sale_price');
  }
}

function processDateRange(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on('sale-price-dates')) return;
  const res = checkDateRange(pipe.current);
  if (res.ok) return;
  if (rec.options.clearInvalidOptional) pipe.apply('', 'sale-price-dates', 'warning', `invalid sale date range removed (clearInvalidOptional): ${res.message}`);
  else rec.issue(pipe.field, 'sale-price-dates', 'warning', `sale_price_effective_date: ${res.message}`);
}

function processUrl(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on('url-absolute')) return;
  const res = normalizeUrl(pipe.current, { baseUrl: rec.options.defaults.baseUrl });
  if (!res.ok) {
    rec.issue(pipe.field, 'url-absolute', 'error', `${pipe.field}: ${res.message}`);
    return;
  }
  if (res.value !== pipe.current) {
    pipe.apply(res.value, 'url-absolute', res.assumed ? 'warning' : 'error', `${pipe.field} repaired (${res.notes.join('; ')})`);
  }
  const limit = FIELDS[pipe.field]?.maxLength;
  if (limit !== undefined && res.value.length > limit) {
    rec.issue(pipe.field, 'url-absolute', 'warning', `${pipe.field} has ${res.value.length} characters; the limit is ${limit} (URLs are never shortened)`);
  }
}

function processUrlList(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on('url-absolute')) return;
  const parts = splitUrlList(pipe.current);
  const fixed: string[] = [];
  const notes: string[] = [];
  let assumed = false;
  for (const part of parts) {
    const res = normalizeUrl(part, { baseUrl: rec.options.defaults.baseUrl });
    if (!res.ok) {
      rec.issue(pipe.field, 'url-absolute', 'error', `${pipe.field}: ${res.message}`);
      return;
    }
    fixed.push(res.value);
    if (res.notes.length > 0) notes.push(...res.notes);
    assumed ||= res.assumed;
  }
  const joined = fixed.join(',');
  if (joined !== pipe.current) {
    const unique = [...new Set(notes)];
    pipe.apply(joined, 'url-absolute', assumed ? 'warning' : 'error', `${pipe.field} repaired (${unique.length > 0 ? unique.join('; ') : 'separators normalised to commas'})`);
  }
  const max = FIELDS[pipe.field]?.maxUrls;
  if (max !== undefined && fixed.length > max) {
    rec.issue(pipe.field, 'length-limits', 'warning', `${pipe.field} lists ${fixed.length} URLs; Meta uses at most ${max}`);
  }
}

function processGtin(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on('gtin-check')) return;
  if (isPlaceholder(pipe.current)) {
    pipe.apply('', 'gtin-check', 'warning', `placeholder "${pipe.current}" removed (it is not a GTIN)`);
    return;
  }
  const res = checkGtin(pipe.current, { padTo: rec.options.padGtin === '13' ? 13 : rec.options.padGtin === '14' ? 14 : 0 });
  if (res.status === 'valid') {
    if (res.value !== pipe.current) pipe.apply(res.value, 'gtin-check', 'info', 'GTIN normalised');
    return;
  }
  if (res.status === 'repaired') {
    const onlyPadding = /^padded with leading zeros to \d+ digits$/.test(res.note);
    pipe.apply(res.value, 'gtin-check', onlyPadding ? 'info' : 'warning', `GTIN repaired: ${res.note}`);
    return;
  }
  if (rec.options.clearInvalidOptional) {
    pipe.apply('', 'gtin-check', 'warning', `invalid GTIN removed (clearInvalidOptional): ${res.message}`);
    return;
  }
  const digits = pipe.current.replace(/\D/g, '');
  const suggestion = res.code === 'BAD_CHECK_DIGIT' && res.expectedCheckDigit !== undefined ? `${digits.slice(0, -1)}${res.expectedCheckDigit}` : null;
  rec.issue('gtin', 'gtin-check', 'error', res.message, suggestion);
}

function processInt(rec: Recorder, pipe: FieldPipe): void {
  if (!rec.on('numeric-fields')) return;
  const res = normalizeInteger(pipe.current);
  if (!res.ok) {
    rec.issue(pipe.field, 'numeric-fields', 'error', `${pipe.field}: ${res.message}`);
    return;
  }
  if (res.value !== pipe.current) pipe.apply(res.value, 'numeric-fields', 'info', `${pipe.field} normalised (${res.note ?? 'number format'})`);
}

/** Phase 3: required fields that are still blank. */
function checkRequired(rec: Recorder): void {
  if (!rec.on('required-fields')) return;
  const gtinOk = rec.get('gtin') !== '' && checkGtin(rec.get('gtin')).status !== 'invalid';
  const mpnOk = rec.get('mpn') !== '' && !isPlaceholder(rec.get('mpn'));
  for (const field of REQUIRED_FIELDS) {
    const value = rec.get(field);
    const placeholder = (field === 'brand' || field === 'title' || field === 'description') && isPlaceholder(value);
    if (value.trim() !== '' && !placeholder) continue;
    if (defaultFor(rec, field) !== undefined && defaultFor(rec, field) !== '') continue; // handled (or reported) in phase 1
    const state = value.trim() === '' ? 'missing' : `a placeholder ("${value.trim()}")`;
    if (field === 'brand' && (gtinOk || mpnOk)) {
      rec.issue(field, 'required-fields', 'warning', `brand is ${state}; Meta accepts an MPN or GTIN in its place, but adding the brand improves matching`);
      continue;
    }
    const hint =
      field === 'brand' ? ' Set defaults.brand to use one brand name for every such row.'
      : field === 'condition' ? ' Set defaults.condition (e.g. "new") if all products share it.'
      : field === 'availability' ? ' Set defaults.availability only if it is true for every such row.'
      : '';
    rec.issue(field, 'required-fields', 'error', `${field} is ${state}: it cannot be filled without guessing.${hint}`);
  }
}

/** Phase 4: rules that compare fields. */
function crossChecks(rec: Recorder): void {
  if (!rec.on('sale-price') || rec.get('sale_price') === '') return;
  const currency = rec.options.defaults.currency;
  const price = parsePrice(rec.get('price'), { defaultCurrency: currency });
  if (!price.ok) return;
  const sale = parsePrice(rec.get('sale_price'), { defaultCurrency: price.currency });
  if (!sale.ok) return;
  let problem: string | null = null;
  if (sale.currency !== price.currency) problem = `sale_price currency ${sale.currency} differs from price currency ${price.currency}`;
  else if (compareAmounts(sale.amount, price.amount) > 0) problem = `sale_price ${sale.normalized} is higher than price ${price.normalized}`;
  if (problem === null) return;
  if (rec.options.clearInvalidOptional) {
    rec.change('sale_price', '', 'sale-price', 'warning', `${problem}: sale_price removed (clearInvalidOptional)`);
    clearSaleDateIfOrphaned(rec);
  } else {
    rec.issue('sale_price', 'sale-price', 'error', `${problem}. Not changed automatically: it is unclear which of the two prices is right`);
  }
}

/**
 * Checks and (in mode 'fix') repairs one row. `skipFields` are columns that hold raw XML fragments and are passed through.
 */
export function fixRow(input: Row, options: FixOptions, mode: 'fix' | 'check' = 'fix', skipFields: ReadonlySet<string> = new Set()): RowFix {
  const row: Row = { ...input };
  const rec = new Recorder(row, options, mode);
  applyDefaults(rec);
  for (const field of orderedFields(row)) {
    if (skipFields.has(field)) continue;
    processField(rec, field);
  }
  checkRequired(rec);
  crossChecks(rec);
  return { row, changes: rec.changes, issues: rec.issues };
}

/** The validator: every problem of a row, without changing it. `fixable` issues have an automatic repair. */
export function validateRow(row: Row, options: FixOptions, skipFields: ReadonlySet<string> = new Set()): Issue[] {
  return fixRow(row, options, 'check', skipFields).issues;
}
