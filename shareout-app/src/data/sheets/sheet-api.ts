import { SHEETS_API } from './constants';

export function sheetValuesUrl(
  spreadsheetId: string,
  range: string,
  options?: { append?: boolean; valueInputOption?: boolean }
): string {
  const encoded = encodeURIComponent(range);
  const base = `${SHEETS_API}/${spreadsheetId}/values/${encoded}`;
  if (options?.append) {
    return `${base}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  }
  const query = options?.valueInputOption !== false
    ? '?valueInputOption=USER_ENTERED'
    : '';
  return `${base}${query}`;
}

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<string[][]> {
  const url = sheetValuesUrl(spreadsheetId, range);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sheets API error: ${response.status} ${error}`);
  }

  const data = await response.json() as { values?: string[][] };
  return data.values || [];
}

export async function putSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<{ updatedCells: number; updatedRows: number; updatedColumns: number }> {
  const url = sheetValuesUrl(spreadsheetId, range);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sheets API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<{
    updatedCells: number;
    updatedRows: number;
    updatedColumns: number;
  }>;
}

export async function appendSheetValues(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<{ updatedCells: number; updatedRows: number }> {
  const url = sheetValuesUrl(spreadsheetId, range, { append: true });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sheets API error: ${response.status} ${error}`);
  }

  const result = await response.json() as {
    updates: { updatedCells: number; updatedRows: number };
  };
  return result.updates;
}
