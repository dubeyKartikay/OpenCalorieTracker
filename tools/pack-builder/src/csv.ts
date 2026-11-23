import { createReadStream } from 'node:fs';

/** Streaming RFC 4180 reader: quoted commas, doubled quotes, CRLF and embedded newlines. */
export async function* parseCsv(chunks: AsyncIterable<string>): AsyncGenerator<string[]> {
  let row: string[] = [], field = '', quoted = false, closed = false;
  let pendingCR = false, first = true, touched = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (pendingCR) { pendingCR = false; if (char === '\n') continue; }
      if (quoted) {
        if (char === '"') { quoted = false; closed = true; }
        else field += char;
        continue;
      }
      if (closed && char === '"') { field += '"'; quoted = true; closed = false; continue; }
      if (char === ',') { row.push(field); field = ''; closed = false; touched = true; }
      else if (char === '\r' || char === '\n') {
        row.push(field);
        if (row.length > 1 || row[0] !== '') yield row;
        row = []; field = ''; closed = false; touched = false; pendingCR = char === '\r';
      } else if (char === '"' && !closed && field === '') { quoted = true; touched = true; }
      else {
        if (closed || char === '"') throw new Error('Malformed CSV: unexpected character around quote');
        field += char; touched = true;
      }
    }
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (touched || closed || row.length) { row.push(field); yield row; }
}

export async function* readCsv(path: string, requiredHeaders: readonly string[] = []): AsyncGenerator<Record<string, string>> {
  const chunks = createReadStream(path, { encoding: 'utf8' });
  let headers: string[] | undefined, line = 0;
  for await (const values of parseCsv(chunks)) {
    line++;
    if (!headers) {
      headers = values.map(value => value.trim());
      if (headers.some(value => !value) || new Set(headers).size !== headers.length) {
        throw new Error(`${path}: empty or duplicate CSV headers`);
      }
      const missing = requiredHeaders.filter(value => !headers!.includes(value));
      if (missing.length) throw new Error(`${path}: missing headers: ${missing.join(', ')}`);
      continue;
    }
    if (values.length !== headers.length) throw new Error(`${path}: record ${line} has ${values.length} fields; expected ${headers.length}`);
    yield Object.fromEntries(headers.map((header, index) => [header, values[index]!]));
  }
  if (!headers) throw new Error(`${path}: empty CSV file`);
}
