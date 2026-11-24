/**
 * Minimal reader for the worksheets of an .xlsx file, entirely in the
 * browser (no upload, no third-party library). Supports what spreadsheet
 * exports contain: shared strings, inline strings, numbers and booleans.
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readEntries(view: DataView): ZipEntry[] {
  // Find the end-of-central-directory record (scan back over any comment).
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('This workbook is damaged.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength));
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(view: DataView, entry: ZipEntry): Promise<string> {
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const data = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('This workbook uses an unsupported compression method.');
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(el: Element): string {
  // Rich text runs are split across several <t> elements.
  return [...el.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');
}

/** Every worksheet in the workbook, in tab order, with its tab name. */
export async function readSheets(file: ArrayBuffer): Promise<{ name: string; rows: string[][] }[]> {
  const view = new DataView(file);
  const entries = readEntries(view);
  const find = (name: string) => entries.find((e) => e.name === name);
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

  const workbookEntry = find('xl/workbook.xml');
  const relsEntry = find('xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relsEntry) throw new Error('This file is not a valid .xlsx workbook.');
  const workbook = parse(await readEntry(view, workbookEntry));
  const rels = parse(await readEntry(view, relsEntry));
  const sheets = [...workbook.getElementsByTagName('sheet')];
  if (sheets.length === 0) throw new Error('This workbook has no sheets.');

  const sharedEntry = find('xl/sharedStrings.xml');
  const shared = sharedEntry ? [...parse(await readEntry(view, sharedEntry)).getElementsByTagName('si')].map(textOf) : [];

  const out: { name: string; rows: string[][] }[] = [];
  for (const sheetEl of sheets) {
    const relId = sheetEl.getAttribute('r:id');
    const target = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === relId)?.getAttribute('Target');
    if (!target) continue;
    const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const entry = find(sheetPath);
    if (!entry) continue;
    const sheet = parse(await readEntry(view, entry));
    const rows: string[][] = [];
    for (const rowEl of sheet.getElementsByTagName('row')) {
      const row: string[] = [];
      for (const c of rowEl.getElementsByTagName('c')) {
        const index = columnIndex(c.getAttribute('r') ?? '');
        const type = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let value: string;
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(c);
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else value = v;
        while (row.length < index) row.push('');
        row[index] = value;
      }
      rows.push(row);
    }
    out.push({ name: sheetEl.getAttribute('name') ?? `Sheet ${out.length + 1}`, rows });
  }
  return out;
}

/** The first worksheet only. */
export async function readFirstSheet(file: ArrayBuffer): Promise<string[][]> {
  const sheets = await readSheets(file);
  return sheets[0]?.rows ?? [];
}
