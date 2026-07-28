/** Safe client message for Google Sheets OAuth — never expose token exchange/D1/crypto internals. */
export function userFacingSheetsOAuthError(_err: unknown): string {
  return 'Google Sheets authorization failed';
}

/** Safe user-facing text for Google Sheets API failures — never leak upstream bodies or infra errors. */
export function userFacingSheetsUpstreamError(
  code: string,
  upstreamStatus?: number,
): string {
  if (code === 'SHEETS_UPSTREAM_REJECTED' && upstreamStatus) {
    return `Google Sheets rejected the request (HTTP ${upstreamStatus})`;
  }
  if (code === 'SHEETS_UPSTREAM_ERROR' && upstreamStatus) {
    return `Google Sheets is unavailable (HTTP ${upstreamStatus})`;
  }
  if (code === 'UPDATE_ERROR') {
    return 'Failed to update sheet data';
  }
  if (code === 'APPEND_ERROR') {
    return 'Failed to append sheet data';
  }
  if (code === 'FETCH_ERROR') {
    return 'Failed to fetch sheet data';
  }
  if (code === 'IMPORT_ERROR') {
    return 'Failed to import sheet data';
  }
  if (code === 'EXPORT_ERROR') {
    return 'Failed to export sheet data';
  }
  return 'Google Sheets request failed';
}

export function sheetsUpstreamFromStatus(status: number): { code: string; httpStatus: number } {
  const isClientCause = status >= 400 && status < 500;
  const code = isClientCause ? 'SHEETS_UPSTREAM_REJECTED' : 'SHEETS_UPSTREAM_ERROR';
  const httpStatus = status === 429 ? 429 : (isClientCause ? 424 : 502);
  return { code, httpStatus };
}

/** Parse errors thrown by sheet-api.ts (`Sheets API error: {status} {body}`). */
export function parseSheetsApiThrownError(err: unknown): { status: number; body: string } | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/^Sheets API error: (\d+) ([\s\S]*)$/);
  if (!match) return null;
  return { status: parseInt(match[1], 10), body: match[2] };
}
