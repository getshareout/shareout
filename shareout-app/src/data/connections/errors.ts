/**
 * Connection error types and safe user-facing message mapping.
 *
 * Upstream API failures must not surface as ShareOut 500s — that trips self-health
 * alerts. Query/materialize handlers map upstream status to 424/502/504 instead.
 */
import { FetchTimeoutError } from '../../fetch-utils';

/** Non-2xx response from the upstream API behind a REST connection. */
export class UpstreamHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

/** Safe user-facing text for connection query failures — never leak upstream bodies or infra errors. */
export function userFacingQueryError(
  err: unknown,
  code: string,
  upstreamStatus?: number,
): string {
  if (err instanceof FetchTimeoutError) {
    return 'The connected API timed out';
  }
  if (code === 'UPSTREAM_REJECTED' && upstreamStatus) {
    return `The connected API rejected the request (HTTP ${upstreamStatus})`;
  }
  if (code === 'UPSTREAM_ERROR' && upstreamStatus) {
    return `The connected API is unavailable (HTTP ${upstreamStatus})`;
  }
  if (err instanceof Error) {
    // User-actionable config/validation errors only — not decrypt/D1/provider internals.
    if (err.message === 'baseUrl not configured') {
      return err.message;
    }
    const lower = err.message.toLowerCase();
    if (
      lower.includes('blocked')
      || lower.includes('baseurl must')
      || lower.includes('baseurl is required')
      || lower.includes('private')
      || err.message.startsWith('Provide the SQL')
      || err.message.startsWith('Server-side query not supported')
      || lower.includes('projectid is required')
    ) {
      return err.message;
    }
  }
  return 'Query failed';
}

/** User-actionable materialize validation/quota messages — never D1/crypto/provider internals. */
export function isSafeMaterializeMessage(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  if (msg.startsWith('Materialized dataset exceeds ')) return true;
  if (msg.startsWith('Materialized dataset "')) return true;
  if (msg.startsWith('Table limit reached')) return true;
  if (msg.startsWith('Row limit exceeded')) return true;
  if (msg.startsWith('Row exceeds ')) return true;
  if (msg.startsWith('Unsupported format:')) return true;
  if (msg === 'Provide the SQL string in "query" for a warehouse connection') return true;
  if (msg.startsWith('Server-side query not supported for connection type')) return true;
  if (msg === 'Name is required' || msg.startsWith('Name too long') || msg.includes('invalid characters')) {
    return true;
  }
  return false;
}

/** Map materialize failures to safe API responses — mirrors query upstream mapping plus write-phase limits. */
export function mapMaterializeFailure(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof FetchTimeoutError) {
    return {
      code: 'UPSTREAM_TIMEOUT',
      message: userFacingQueryError(err, 'UPSTREAM_TIMEOUT'),
      status: 504,
    };
  }
  if (err instanceof UpstreamHttpError) {
    const isClientCause = err.status >= 400 && err.status < 500;
    const code = isClientCause ? 'UPSTREAM_REJECTED' : 'UPSTREAM_ERROR';
    return {
      code,
      message: userFacingQueryError(err, code, err.status),
      status: isClientCause ? 424 : 502,
    };
  }
  if (err instanceof Error) {
    if (err.message === 'CREDENTIALS_REQUIRED') {
      return {
        code: 'CREDENTIALS_REQUIRED',
        message: 'Connect your credentials for this connector before materializing',
        status: 403,
      };
    }
    if (err.message === 'baseUrl not configured') {
      return { code: 'MATERIALIZE_ERROR', message: err.message, status: 500 };
    }
    if (/^Connection "[^"]+" not found$/.test(err.message)) {
      return { code: 'NOT_FOUND', message: 'Connection not found', status: 404 };
    }
  }
  if (isSafeMaterializeMessage(err)) {
    const message = err instanceof Error ? err.message : 'Materialize failed';
    return { code: 'MATERIALIZE_ERROR', message, status: 400 };
  }
  return { code: 'MATERIALIZE_ERROR', message: 'Materialize failed', status: 500 };
}

/** Map a query execution error to HTTP status and error code. */
export function mapQueryFailure(err: unknown): { code: string; status: number; upstreamStatus?: number } {
  if (err instanceof Error) {
    const msg = err.message;
    const lower = msg.toLowerCase();
    if (
      msg === 'baseUrl not configured'
      || lower.includes('blocked')
      || lower.includes('baseurl must')
      || lower.includes('baseurl is required')
      || msg.startsWith('Provide the SQL')
      || msg.startsWith('Server-side query not supported')
      || lower.includes('projectid is required')
    ) {
      const code = msg.startsWith('Server-side query not supported')
        ? 'PROVIDER_NOT_IMPLEMENTED'
        : 'INVALID_REQUEST';
      return {
        code,
        status: code === 'PROVIDER_NOT_IMPLEMENTED' ? 501 : 400,
      };
    }
  }
  if (err instanceof UpstreamHttpError) {
    const isClientCause = err.status >= 400 && err.status < 500;
    return {
      code: isClientCause ? 'UPSTREAM_REJECTED' : 'UPSTREAM_ERROR',
      status: isClientCause ? 424 : 502,
      upstreamStatus: err.status,
    };
  }
  if (err instanceof FetchTimeoutError) {
    return { code: 'UPSTREAM_TIMEOUT', status: 504 };
  }
  return { code: 'QUERY_ERROR', status: 500 };
}
