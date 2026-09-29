/**
 * Minimal RFC 4180 CSV reader used for SDMX-CSV responses (pure). Handles a UTF-8 BOM, CRLF/LF,
 * quoted fields with doubled quotes and embedded delimiters/newlines, and picks the delimiter
 * (`,` `;` or tab) from the header line.
 */

export function detectDelimiter(headerLine: string): string {
  const counts: Array<[string, number]> = [',', ';', '\t'].map((d) => [d, headerLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const best = counts[0];
  return best && best[1] > 0 ? best[0] : ',';
}

export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLineEnd = input.search(/\r?\n/);
  const delimiter = detectDelimiter(firstLineEnd === -1 ? input : input.slice(0, firstLineEnd));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let sawAnything = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      sawAnything = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      sawAnything = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i++;
      if (sawAnything || field !== '') {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
      sawAnything = false;
    } else {
      field += ch;
      sawAnything = true;
    }
  }
  if (sawAnything || field !== '') {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
