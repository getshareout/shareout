// Streaming, bounded-memory pagination for dataset /content (008 Stage B1).
//
// The old path did `await obj.text()` then parsed the WHOLE file into a JS array before
// slicing one page — OOM-ing the ~128MB isolate well under the 100MB dataset limit. This
// reads the R2 body as a stream and retains only the requested page window plus the row
// currently being assembled, so peak memory is bounded by the page size (limit ≤ 10000)
// regardless of file size. `total` is still computed (by counting every record) so the
// existing { total, hasMore } response contract is preserved.
//
// Record *boundary* detection is done here; the actual row parsing reuses the same
// `parseCSVLine` / `JSON.parse` semantics as before, so output is byte-identical to the
// old implementation for well-formed inputs.

// A single JSON value that is NOT a top-level array (e.g. one giant object) can't be
// streamed element-by-element — it is one record and must be buffered whole. Cap that
// buffer so the pathological case fails cleanly instead of OOM-ing.
const MAX_SINGLE_VALUE_BYTES = 25_000_000; // 25MB

export class DatasetTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetTooLargeError';
  }
}

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readDatasetPage(
  body: ReadableStream<Uint8Array>,
  format: string,
  offset: number,
  limit: number,
  opts: { maxSingleValueBytes?: number } = {},
): Promise<{ page: unknown[]; total: number }> {
  const page: unknown[] = [];
  let total = 0;

  // Collect a record only when it falls inside the requested window; always count it.
  const take = (record: unknown) => {
    if (total >= offset && total < offset + limit) page.push(record);
    total++;
  };

  if (format === 'csv') {
    await streamCsvRows(body, take);
  } else if (format === 'json') {
    await streamJsonArray(body, take, opts.maxSingleValueBytes ?? MAX_SINGLE_VALUE_BYTES);
  }

  return { page, total };
}

async function streamCsvRows(
  body: ReadableStream<Uint8Array>,
  take: (row: Record<string, string>) => void,
): Promise<void> {
  let buffer = '';
  let headers: string[] | null = null;

  // Mirrors the old `content.split('\n').filter(l => l.trim())`: blank lines are dropped
  // and the first non-blank line is the header.
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    if (headers === null) {
      headers = parseCSVLine(line);
      return;
    }
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] || '';
    take(row);
  };

  for await (const chunk of textChunks(body)) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.length) handleLine(buffer);
}

async function streamJsonArray(
  body: ReadableStream<Uint8Array>,
  take: (value: unknown) => void,
  maxSingleValueBytes: number,
): Promise<void> {
  let started = false;    // seen the first non-whitespace char
  let isArray = false;    // first char was '['
  let depth = 0;          // nesting depth of objects/arrays inside the outer array
  let inString = false;
  let escape = false;
  let finished = false;   // passed the outer closing ']'
  let elem = '';          // text of the element currently being assembled
  let single = '';        // buffer for a non-array (single JSON value)

  const flush = () => {
    const trimmed = elem.trim();
    elem = '';
    if (!trimmed) return; // empty slot (e.g. trailing whitespace/comma)
    take(JSON.parse(trimmed));
  };

  for await (const chunk of textChunks(body)) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (!started) {
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') continue;
        started = true;
        if (ch === '[') { isArray = true; continue; }
        isArray = false;
        single += ch;
        continue;
      }

      if (!isArray) {
        single += ch;
        if (single.length > maxSingleValueBytes) {
          throw new DatasetTooLargeError('Single JSON value exceeds the in-Worker parse cap');
        }
        continue;
      }

      if (finished) continue; // ignore trailing whitespace after ']'

      if (inString) {
        elem += ch;
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') { inString = true; elem += ch; continue; }
      if (ch === '{' || ch === '[') { depth++; elem += ch; continue; }
      if (ch === ']' && depth === 0) { flush(); finished = true; continue; }
      if (ch === '}' || ch === ']') { depth--; elem += ch; continue; }
      if (ch === ',' && depth === 0) { flush(); continue; }
      elem += ch;
    }
  }

  if (!isArray) {
    const value = single.trim();
    if (!value) return;
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) parsed.forEach(take);
    else take(parsed);
  }
}
