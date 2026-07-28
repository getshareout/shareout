export function sanitizeColumnName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&')
    .substring(0, 64);
}

export function parseValue(value: string): unknown {
  if (value === '') return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function extractSpreadsheetId(url: string): string | null {
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]{20,})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function resolveSpreadsheetId(body: {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
}): string | undefined {
  if (body.spreadsheetId) return body.spreadsheetId;
  if (body.spreadsheetUrl) {
    return extractSpreadsheetId(body.spreadsheetUrl) || undefined;
  }
  return undefined;
}

export function rowsToObjects(rows: string[][]): {
  headers: string[];
  data: Record<string, unknown>[];
} {
  const headers = rows[0].map(h => sanitizeColumnName(h));
  const data = rows.slice(1).map(row => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = parseValue(row[i] || '');
    });
    return obj;
  });
  return { headers, data };
}
