import type { Env } from './types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|secret|token|api[_-]?key|credentials)$/i;
const SENSITIVE_QUERY = /^(token|code|state|password|secret|key|access_token|refresh_token)$/i;

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
}

function resolveMinLevel(env?: Env): LogLevel {
  const configured = env?.LOG_LEVEL?.toLowerCase();
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
    return configured;
  }
  return 'info';
}

function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    return {
      error_name: err.name,
      error_message: err.message,
      error_stack: err.stack,
    };
  }
  return { error_message: String(err) };
}

export function sanitizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = sanitizeValue(value);
  }
  return out;
}

function sanitizeValue(value: unknown): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeValue);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      sanitized[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitizeValue(v);
    }
    return sanitized;
  }
  return String(value);
}

function writeLog(level: LogLevel, minLevel: LogLevel, base: LogFields, message: string, fields?: LogFields): void {
  if (!shouldLog(level, minLevel)) return;

  const payload = sanitizeFields({
    level,
    message,
    service: 'shareout-worker',
    timestamp: new Date().toISOString(),
    ...base,
    ...fields,
  });

  const writer = level === 'debug' ? console.log : console[level];
  writer(payload);
}

export function createLogger(env: Env | undefined, baseFields: LogFields = {}): Logger {
  const minLevel = resolveMinLevel(env);

  function makeLogger(fields: LogFields): Logger {
    return {
      debug: (message, extra) => writeLog('debug', minLevel, { ...fields, ...baseFields }, message, extra),
      info: (message, extra) => writeLog('info', minLevel, { ...fields, ...baseFields }, message, extra),
      warn: (message, extra) => writeLog('warn', minLevel, { ...fields, ...baseFields }, message, extra),
      error: (message, extra) => writeLog('error', minLevel, { ...fields, ...baseFields }, message, extra),
      child: (childFields) => makeLogger({ ...fields, ...childFields }),
    };
  }

  return makeLogger({});
}

export function logError(logger: Logger, message: string, err: unknown, fields?: LogFields): void {
  logger.error(message, { ...serializeError(err), ...fields });
}

/** Normalize paths so logs group by route pattern instead of raw IDs/slugs. */
export function normalizeRoute(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';

  const staticSegments = new Set([
    'home', 'workspace', 'admin', 'auth', 'sdk', 'app', 'editor', 'skill', 'publish',
    'proxy', 'manifest', 'service-worker', 'login', 'logout', 'callback', 'profile',
    'artifacts', 'workspaces', 'folders', 'jobs', 'templates', 'users', 'data',
    'batch', 'json', 'tables', 'datasets', 'connections', 'secrets', 'realtime',
    'comments', 'sheets', 'github', 'blobs', 'agent', 'slides', 'email', 'platform',
    'edit', 'embed', 'files', 'versions', 'collaborators', 'analytics', 'enterprise',
  ]);

  const normalized = segments.map((segment, index) => {
    if (staticSegments.has(segment)) {
      return segment;
    }

    if (segment === 'v1') {
      return segment;
    }

    const prev = segments[index - 1];
    if (
      prev === 'artifacts' ||
      prev === 'workspaces' ||
      prev === 'folders' ||
      prev === 'jobs' ||
      prev === 'templates' ||
      prev === 'users' ||
      prev === 'data'
    ) {
      return ':id';
    }

    if (index === 1 && segments[0] === 'a') {
      return ':slug';
    }

    if (/^(art_|usr_|ws_|fld_|job_|tok_|log_|dep_|ver_)[a-z0-9_-]+$/i.test(segment)) {
      return ':id';
    }

    if (/^[a-f0-9-]{36}$/i.test(segment)) {
      return ':id';
    }

    return segment;
  });

  return `/${normalized.join('/')}`;
}

export function sanitizeUrl(url: URL): string {
  const copy = new URL(url.toString());
  for (const key of [...copy.searchParams.keys()]) {
    if (SENSITIVE_QUERY.test(key)) {
      copy.searchParams.set(key, '[REDACTED]');
    }
  }
  return copy.toString();
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
