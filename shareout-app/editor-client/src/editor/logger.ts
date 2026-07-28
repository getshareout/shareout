export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  error: (message: string, detail?: unknown) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('shareout-editor-debug') === '1') {
      return 'debug';
    }
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('editorDebug')) {
      return 'debug';
    }
  } catch {
    // ignore storage / URL access errors
  }
  return 'info';
}

export function createLogger(scope: string, minLevel: LogLevel = resolveMinLevel()): Logger {
  const prefix = `[Editor:${scope}]`;

  function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
  }

  function write(level: LogLevel, message: string, detail?: unknown): void {
    if (!shouldLog(level)) return;
    const line = `${prefix} ${message}`;
    if (detail === undefined) {
      console[level === 'debug' ? 'log' : level](line);
    } else {
      console[level === 'debug' ? 'log' : level](line, detail);
    }
  }

  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}
