/**
 * Turning the Actor input (a list of strings and/or CSV text) into records
 * `{ input, bic, source, position }`. Pure, dependency-free, never throws.
 *
 * Rules (documented in README.md):
 * - Every entry of `ibans` is one record; it may be "IBAN" or "IBAN,BIC" (delimiters , ; | or tab).
 * - `csvText` is RFC-4180-style CSV (quotes, "" escapes, CR/LF/CRLF, BOM); the delimiter is
 *   auto-detected from the first non-empty line. If the first row has an "iban" column it is a
 *   header: the "iban" column and an optional "bic"/"swift" column are used and all other
 *   columns are ignored. Without a header, column 1 is the IBAN and column 2 (if present) the BIC.
 * - Records whose IBAN cell is blank are skipped (not validated, not charged) and counted.
 */

export type InputSource = 'ibans' | 'csvText';

export interface InputRecord {
  /** The IBAN cell exactly as provided (not trimmed), so results can be joined back to the input. */
  input: string;
  /** The BIC cell as provided, or null. */
  bic: string | null;
  source: InputSource;
  /** 1-based position among the non-blank records of that source. */
  position: number;
}

export interface ParsedRecords {
  records: InputRecord[];
  skippedBlank: number;
  headerDetected: boolean;
}

const DELIMITERS = [',', ';', '\t', '|'] as const;
const IBAN_HEADER = /^(iban|iban[ _-]?(number|code|no\.?|nr\.?))$/i;
const BIC_HEADER = /^(bic|swift|swift[ _-]?code|bic[ _/-]?(code|swift)|swift[ _/-]?bic)$/i;

/** Picks the delimiter that occurs most often (outside quotes) in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: string = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const c = counts.get(d) ?? 0;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/** Minimal RFC-4180 parser. Blank lines are dropped. Unterminated quotes run to the end. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Blank lines (a single empty cell) are dropped; ",BIC" style rows with 2+ cells are kept.
    if (row.length > 1 || (row[0] ?? '').trim() !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      // Opening quote (leniently allowing spaces before it, as in `a, "b"`).
      inQuotes = true;
      field = '';
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function cell(row: string[], index: number): string | null {
  if (index < 0) return null;
  const v = row[index];
  return v === undefined || v.trim() === '' ? null : v;
}

/** Records from the `ibans` list. */
export function recordsFromList(list: readonly string[]): ParsedRecords {
  const records: InputRecord[] = [];
  let skippedBlank = 0;
  for (const entry of list) {
    const text = typeof entry === 'string' ? entry : String(entry ?? '');
    const rows = parseDelimited(text, detectDelimiter(text));
    if (rows.length === 0) skippedBlank += 1;
    for (const row of rows) {
      const input = row[0] ?? '';
      if (input.trim() === '') {
        skippedBlank += 1;
        continue;
      }
      records.push({ input, bic: cell(row, 1), source: 'ibans', position: records.length + 1 });
    }
  }
  return { records, skippedBlank, headerDetected: false };
}

/** Records from `csvText`. */
export function recordsFromCsv(text: string): ParsedRecords {
  const rows = parseDelimited(text, detectDelimiter(text));
  const records: InputRecord[] = [];
  let skippedBlank = 0;
  if (rows.length === 0) return { records, skippedBlank, headerDetected: false };

  const first = rows[0] ?? [];
  const ibanCol = first.findIndex((c) => IBAN_HEADER.test(c.trim()));
  const headerDetected = ibanCol >= 0;
  const bicCol = headerDetected ? first.findIndex((c) => BIC_HEADER.test(c.trim())) : first.length > 1 ? 1 : -1;
  const dataRows = headerDetected ? rows.slice(1) : rows;
  const ibanIndex = headerDetected ? ibanCol : 0;

  for (const row of dataRows) {
    const input = row[ibanIndex] ?? '';
    if (input.trim() === '') {
      skippedBlank += 1;
      continue;
    }
    // Without a header a later row may have a second column even if the first did not.
    const bicIndex = headerDetected ? bicCol : row.length > 1 ? 1 : -1;
    records.push({ input, bic: cell(row, bicIndex), source: 'csvText', position: records.length + 1 });
  }
  return { records, skippedBlank, headerDetected };
}
