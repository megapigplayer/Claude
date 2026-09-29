/**
 * Leading labels copied along with a value from a form or a document ("ת.ז. 123456782", "ID: 123456782",
 * "IBAN IL62 ...", "טלפון: 050-...", "מיקוד 6100000"). They are removed (when `normalize` is on) and, in
 * `auto` mode, tell which type the value is. Only a label at the very start is recognised, and it must
 * not be followed directly by another letter.
 *
 * Hebrew abbreviations may be written with a dot, a geresh (U+05F3) / gershayim (U+05F4) or ASCII quotes.
 */
import { DASH_CLASS } from './text.js';
import type { ValueType } from './types.js';

const Q = '[\'"׳״]'; // apostrophe / double quote / geresh / gershayim

const LABELS: ReadonlyArray<{ type: ValueType; pattern: string }> = [
  {
    type: 'id',
    pattern: [
      'תעודת\\s+זהות',
      'מספר\\s+זהות',
      `מס${Q}?\\.?\\s+זהות`,
      `ת\\.?\\s?ז\\.?`,
      `ת${Q}ז`,
      'teudat\\s+zehut',
      'id\\s*(?:number|num|no)\\.?',
      'i\\.d\\.?',
      'id',
      'tz',
    ].join('|'),
  },
  {
    type: 'company',
    pattern: [
      'עוסק\\s+מורשה',
      'מספר\\s+עוסק',
      'מספר\\s+חברה',
      `ח\\.?\\s?פ\\.?`,
      `ח${Q}פ`,
      `ע\\.?\\s?מ\\.?`,
      `ע${Q}מ`,
      'company\\s*(?:number|no|id)\\.?',
      'vat\\s*(?:number|no|id)\\.?',
    ].join('|'),
  },
  { type: 'iban', pattern: 'iban' },
  {
    type: 'phone',
    pattern: ['טלפון', `טל${Q}?\\.?`, 'נייד', 'פלאפון', 'סלולרי', 'וואטסאפ', 'tel(?:ephone)?', 'phone', 'mobile', 'cell', 'mob', 'whatsapp'].join('|'),
  },
  { type: 'postcode', pattern: ['מיקוד', 'zip\\s*code', 'zip', 'post(?:al)?\\s*code'].join('|') },
];

const LABEL_REGEX = new RegExp(
  `^(?:${LABELS.map((l, i) => `(?<t${i}>${l.pattern})`).join('|')})(?!\\p{L})\\s*[:：]?\\s*[${DASH_CLASS}]?\\s*`,
  'iu',
);

export interface StrippedLabel {
  /** The value without the label. */
  text: string;
  /** The type the label stands for. */
  type: ValueType;
}

/** Removes a leading label; null when there is none. */
export function stripLabel(text: string): StrippedLabel | null {
  const match = LABEL_REGEX.exec(text);
  if (!match || !match.groups) return null;
  for (let i = 0; i < LABELS.length; i++) {
    if (match.groups[`t${i}`] !== undefined) {
      const label = LABELS[i];
      if (!label) return null;
      return { text: text.slice(match[0].length).trim(), type: label.type };
    }
  }
  return null;
}
