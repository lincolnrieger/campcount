/**
 * Delimited-text parser (RFC 4180 plus the variations Excel and MyScout
 * produce): UTF-8 BOM, CRLF or LF, quoted fields with embedded delimiters,
 * newlines and doubled quotes, and comma / tab / semicolon delimiters.
 */
export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const candidates = ['\t', ',', ';'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseDelimited(input: string, delimiter?: string): ParsedTable {
  const text = input.replace(/^\uFEFF/, '');
  const d = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === d) {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headerRow = [], ...rows] = nonEmpty;
  const headers = headerRow.map((h) => h.trim());
  // Pad short rows so every row has a cell per header.
  return { headers, rows: rows.map((r) => headers.map((_, i) => (r[i] ?? '').trim())), delimiter: d };
}
