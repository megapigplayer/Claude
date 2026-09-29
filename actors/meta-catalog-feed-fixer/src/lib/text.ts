/**
 * Text helpers (pure): whitespace cleaning, HTML stripping, length limits at grapheme boundaries,
 * ALL-CAPS and promo-text detection. No Apify imports.
 */
import { Parser } from 'htmlparser2';
import { BIDI_MARKS_RE, PROMO_PATTERNS } from './spec.js';

/**
 * Lower-case key made of letters and digits only, with accents and combining marks removed
 * ("Épuisé" -> "epuise", "In Stock" -> "instock", Hebrew niqqud dropped). Used for every synonym lookup.
 */
export function compactKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Length in Unicode code points (what a user perceives as "characters", except combining sequences). */
export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n += 1;
  return n;
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const SPACE_LIKE_RE = /[   -   　]/g;
const INVISIBLE_RE = /[​﻿⁠]/g;

export interface CleanOptions {
  /** Keep line breaks (description). Otherwise every line break becomes a space. */
  multiline: boolean;
  /** Remove bidi marks (LRM, RLM, embeddings, isolates): for ids, prices, urls, codes. */
  stripBidi: boolean;
}

/**
 * Deterministic whitespace and invisible-character cleaning.
 * - BOM, zero width space, word joiner and control characters are removed;
 * - non-breaking and other unusual spaces become a normal space;
 * - single-line fields: line breaks become spaces, runs of spaces collapse, ends are trimmed;
 * - multi-line fields: line breaks are normalised to \n, trailing spaces per line and blank lines at the ends are removed.
 */
export function cleanValue(value: string, options: CleanOptions): string {
  let s = value.replace(INVISIBLE_RE, '').replace(/\r\n?/g, '\n').replace(CONTROL_RE, (ch) => (ch === '\n' ? ch : ''));
  s = s.replace(SPACE_LIKE_RE, ' ').replace(/\t/g, ' ');
  if (options.stripBidi) s = s.replace(BIDI_MARKS_RE, '');
  if (options.multiline) {
    return s
      .split('\n')
      .map((line) => line.replace(/ +$/, ''))
      .join('\n')
      .replace(/^\n+|\n+$/g, '')
      .replace(/^ +/, '');
  }
  return s.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------

const TAG_RE = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/;
const ENTITY_RE = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

export function looksLikeHtml(value: string): boolean {
  return TAG_RE.test(value) || ENTITY_RE.test(value);
}

const BLOCK_TAGS = new Set(['p', 'div', 'tr', 'ul', 'ol', 'li', 'table', 'section', 'article', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'dt', 'dd']);

function htmlToTextOnce(html: string): string {
  const out: string[] = [];
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (name === 'script' || name === 'style') skip += 1;
        else if (BLOCK_TAGS.has(name)) out.push('\n');
      },
      ontext(text) {
        if (skip === 0) out.push(text);
      },
      onclosetag(name) {
        if (name === 'script' || name === 'style') skip = Math.max(0, skip - 1);
        else if (BLOCK_TAGS.has(name)) out.push('\n');
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return out.join('');
}

/**
 * Strips tags and decodes entities. Repeats (at most 3 rounds) so that entity-escaped markup
 * ("&lt;b&gt;x&lt;/b&gt;") also ends up as plain text: the result contains no tag and no entity,
 * which makes the operation idempotent.
 */
export function stripHtml(value: string): string {
  let current = value;
  for (let round = 0; round < 3 && looksLikeHtml(current); round++) current = htmlToTextOnce(current);
  return current;
}

// ---------------------------------------------------------------------------------------------
// Length limits
// ---------------------------------------------------------------------------------------------

let segmenter: Intl.Segmenter | null = null;
function graphemes(value: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value), (s) => s.segment);
}

/**
 * Cuts `value` to at most `limit` code points at a grapheme boundary (never inside an emoji sequence or
 * a letter+niqqud cluster). When the cut falls inside a word and a space exists in the last 40% of the
 * allowed text, the cut moves back to that space. Trailing spaces and separators (, ; : - / |) are removed.
 */
export function truncateToLimit(value: string, limit: number): string {
  if (codePointLength(value) <= limit) return value;
  const parts = graphemes(value);
  let kept = '';
  let count = 0;
  let index = 0;
  for (; index < parts.length; index++) {
    const part = parts[index] as string;
    const len = codePointLength(part);
    if (count + len > limit) break;
    kept += part;
    count += len;
  }
  const next = parts[index] ?? '';
  const midWord = next !== '' && !/^\s/.test(next) && !/\s$/.test(kept);
  if (midWord) {
    const lastSpace = kept.search(/\s\S*$/);
    if (lastSpace >= Math.floor(kept.length * 0.6)) kept = kept.slice(0, lastSpace);
  }
  return kept.replace(/[\s,;:/|\-–—]+$/u, '');
}

// ---------------------------------------------------------------------------------------------
// Style checks (reported, never changed)
// ---------------------------------------------------------------------------------------------

/** true when the text is (almost) entirely upper-case: at least 8 cased letters and >= 90% of them capitals. */
export function isShouting(value: string): boolean {
  let cased = 0;
  let upper = 0;
  for (const ch of value) {
    const lower = ch.toLowerCase();
    const up = ch.toUpperCase();
    if (lower === up) continue; // caseless (digits, punctuation, Hebrew, CJK ...)
    cased += 1;
    if (ch === up) upper += 1;
  }
  return cased >= 8 && upper / cased >= 0.9;
}

export interface PromoHit {
  id: string;
  label: string;
  match: string;
}

/** Promotional wording, prices, phone numbers or repeated punctuation in a title. */
export function findPromo(value: string): PromoHit[] {
  const hits: PromoHit[] = [];
  for (const p of PROMO_PATTERNS) {
    const m = p.re.exec(value);
    if (m) hits.push({ id: p.id, label: p.label, match: m[0] });
  }
  return hits;
}

/** Short excerpt for messages. */
export function excerpt(value: string, max = 60): string {
  const one = value.replace(/\s+/g, ' ');
  return codePointLength(one) <= max ? one : `${[...one].slice(0, max - 1).join('')}…`;
}
