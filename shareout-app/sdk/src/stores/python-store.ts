import { ShareOutError } from '../shareout-error';

const DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';

interface PyodideGlobals {
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

interface PyodideRuntime {
  globals: PyodideGlobals;
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<unknown>;
  pyimport(name: string): unknown;
  setStdout(options: { batched?: (text: string) => void }): void;
  setStderr(options: { batched?: (text: string) => void }): void;
}

interface PyProxy {
  toJs(options?: { dict_converter?: (entries: Iterable<[unknown, unknown]>) => unknown }): unknown;
  destroy(): void;
}

type LoadPyodide = (config: { indexURL: string }) => Promise<PyodideRuntime>;

export interface PythonLoadOptions {
  indexURL?: string;
}

export interface PythonRunOptions {
  globals?: Record<string, unknown>;
  packages?: string[];
  install?: string[];
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

export interface PythonResult<T = unknown> {
  result: T;
  stdout: string;
  stderr: string;
}

let runtimePromise: Promise<PyodideRuntime> | null = null;
const loadedPackages = new Set<string>();

function isPyProxy(value: unknown): value is PyProxy {
  return typeof (value as PyProxy)?.toJs === 'function';
}

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

// Published artifacts run in an opaque-origin sandbox (ADR 30) where reading
// sessionStorage/localStorage throws a SecurityError. Pyodide touches storage on
// load, so install an in-memory shim when the real one is blocked. No-op in a
// normal-origin context, where the native storage stays untouched.
function ensureSandboxStorage(): void {
  for (const key of ['sessionStorage', 'localStorage'] as const) {
    let blocked = false;
    try { void window[key]; } catch { blocked = true; }
    if (blocked) {
      try {
        Object.defineProperty(window, key, { value: createMemoryStorage(), configurable: true });
      } catch { /* leave it; loadPyodide may still fail and surface PYTHON_LOAD_FAILED */ }
    }
  }
}

async function loadRuntime(indexURL: string): Promise<PyodideRuntime> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new ShareOutError(
      'sdk.python requires a browser environment.',
      'PYTHON_NO_BROWSER',
      500
    );
  }

  ensureSandboxStorage();

  const w = window as Window & { loadPyodide?: LoadPyodide };

  if (!w.loadPyodide) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${indexURL}pyodide.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new ShareOutError('Failed to load Pyodide.', 'PYTHON_LOAD_FAILED', 500));
      document.head.appendChild(script);
    });
  }

  if (!w.loadPyodide) {
    throw new ShareOutError('Pyodide loader unavailable after load.', 'PYTHON_LOAD_FAILED', 500);
  }

  return w.loadPyodide({ indexURL });
}

export class PythonStore {
  async ready(options: PythonLoadOptions = {}): Promise<void> {
    if (!runtimePromise) {
      runtimePromise = loadRuntime(options.indexURL ?? DEFAULT_INDEX_URL);
    }
    await runtimePromise;
  }

  get loaded(): boolean {
    return runtimePromise !== null;
  }

  reset(): void {
    runtimePromise = null;
    loadedPackages.clear();
  }

  async run<T = unknown>(code: string, options: PythonRunOptions = {}): Promise<PythonResult<T>> {
    await this.ready();
    const runtime = await runtimePromise!;

    const packages = (options.packages ?? []).filter((p) => !loadedPackages.has(p));
    if (packages.length) {
      await runtime.loadPackage(packages);
      packages.forEach((p) => loadedPackages.add(p));
    }

    if (options.install?.length) {
      if (!loadedPackages.has('micropip')) {
        await runtime.loadPackage('micropip');
        loadedPackages.add('micropip');
      }
      const micropip = runtime.pyimport('micropip') as { install(pkgs: string[]): Promise<void> };
      const pending = options.install.filter((p) => !loadedPackages.has(p));
      if (pending.length) {
        await micropip.install(pending);
        pending.forEach((p) => loadedPackages.add(p));
      }
    }

    const globalKeys = Object.keys(options.globals ?? {});
    for (const key of globalKeys) {
      runtime.globals.set(key, options.globals![key]);
    }

    let stdout = '';
    let stderr = '';
    runtime.setStdout({
      batched: (text) => {
        stdout += text;
        options.onStdout?.(text);
      },
    });
    runtime.setStderr({
      batched: (text) => {
        stderr += text;
        options.onStderr?.(text);
      },
    });

    try {
      const raw = await runtime.runPythonAsync(code);
      let result: unknown = raw;
      if (isPyProxy(raw)) {
        result = raw.toJs({ dict_converter: Object.fromEntries });
        raw.destroy();
      }
      return { result: result as T, stdout, stderr };
    } finally {
      runtime.setStdout({});
      runtime.setStderr({});
      for (const key of globalKeys) {
        runtime.globals.delete(key);
      }
    }
  }
}
