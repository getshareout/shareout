# SDK: Python (Run Python in the Browser)

Run arbitrary Python inside an artifact via [Pyodide](https://pyodide.org), loaded on demand. Access via `sdk.python`.

General-purpose capability: it runs *any* Python. It is **not** a ShareOut proxy — Python reaches the outside world only through JS functions/values you inject as `globals`. Wire in whatever you want (a SQL helper, a logger, `fetch`, nothing at all).

## Methods

```typescript
// Run Python; returns the value of the last expression + captured output
run<T = unknown>(code: string, options?: PythonRunOptions): Promise<PythonResult<T>>

// Preload the runtime (and optionally pin a Pyodide version) without running code
ready(options?: PythonLoadOptions): Promise<void>

// True once the runtime has started loading
readonly loaded: boolean

// Drop the cached runtime (frees memory / allows a version change)
reset(): void
```

## Types

```typescript
interface PythonRunOptions {
  globals?: Record<string, unknown>;  // JS values/functions exposed as Python globals
  packages?: string[];                // Pyodide built-ins, e.g. ['numpy', 'pandas']
  install?: string[];                 // pure-Python wheels via micropip
  onStdout?: (line: string) => void;  // streamed print() output
  onStderr?: (line: string) => void;
}

interface PythonResult<T = unknown> {
  result: T;       // last expression value (PyProxy auto-converted to JS)
  stdout: string;  // full captured stdout
  stderr: string;
}

interface PythonLoadOptions {
  indexURL?: string;  // override Pyodide CDN/version (default: pyodide v0.26.2)
}
```

## Behavior

- **Lazy singleton:** the runtime loads on first `run()` (or `ready()`) and is reused across every later call — Pyodide init takes seconds, so reuse matters.
- **Async bridge:** async JS functions passed in `globals` can be `await`ed directly from Python (`runPythonAsync` semantics).
- **Isolation:** injected globals are removed after each `run()`; they don't leak between calls.
- **Packages:** `packages`/`install` are deduped — already-loaded packages are skipped on later runs.
- **Browser only:** throws `ShareOutError` (`PYTHON_NO_BROWSER`) outside a browser.

## Examples

### Compute with numpy

```javascript
const { result, stdout } = await sdk.python.run(`
import numpy as np
print("computing…")
float(np.mean([1, 2, 3, 4]))
`, { packages: ['numpy'], onStdout: (l) => console.log(l) });

console.log(result); // 2.5
```

### Inject your own callbacks (any backend, not the SDK)

```javascript
async function sql(statement) { /* your fetch to a data endpoint */ }

await sdk.python.run(`
from datetime import date, timedelta
weeks = [date.today() - timedelta(weeks=i) for i in range(4)]
for wk in weeks:
    await run_sql(MERGE_TEMPLATE.replace("{W}", wk.isoformat()))
    log(f"week {wk} → done")
`, {
  globals: {
    MERGE_TEMPLATE,
    run_sql: async (s) => { await sql(s); },
    log: (m) => console.log(m),
  },
});
```

### Preload to hide latency

```javascript
sdk.python.ready();                 // start loading on page open
// …later, when the user clicks Run:
await sdk.python.run(userCode);     // runtime already warm
```

## Notes

- No manifest declaration required — `sdk.python` stores no artifact data.
- Pyodide is fetched from a CDN on first use (~several MB). Override the source/version with `ready({ indexURL })`.
- Heavy compute blocks the main thread; keep long jobs chunked and stream progress via `onStdout`.

## Sandbox gotcha (read this if you load Pyodide yourself)

Published artifacts run in an **opaque-origin sandbox** (ADR 30, `<hex>.shareoutcdn.site`, no `allow-same-origin`). In that context **`sessionStorage`/`localStorage` access throws `SecurityError`**, and Pyodide touches storage while loading — so a naive load fails with *"Could not load Python runtime."*

- **Using `sdk.python`?** Nothing to do — the SDK installs an in-memory storage shim before loading Pyodide, so it works inside the sandbox automatically.
- **Loading Pyodide manually** (raw `<script src=".../pyodide.js">` or `import("…/pyodide.mjs")` instead of the SDK)? Either switch to `sdk.python`, or install the shim **before** the load:

```javascript
// Run BEFORE loading Pyodide. No-op outside the sandbox (only shims when blocked).
['sessionStorage', 'localStorage'].forEach((key) => {
  let blocked = false;
  try { void window[key]; } catch { blocked = true; }
  if (blocked) {
    const map = new Map();
    Object.defineProperty(window, key, { configurable: true, value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    }});
  }
});
```

Same applies to other WASM/storage-touching libraries (SQL.js, DuckDB-WASM). Prefer `sdk.python` so you never hit this.

## Related

- [SDK Overview](overview.md) - Loading, initialization, errors
- [Integrations](../integrations/overview.md) - Data Platform connections to feed Python
