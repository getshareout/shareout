---
title: Python in the browser
description: Run Python inside an artifact with Pyodide.
---

import { Aside } from '@astrojs/starlight/components';

Run real Python inside the page via [Pyodide](https://pyodide.org), loaded on
demand. Access via `sdk.python`. It runs *any* Python — `numpy`, `pandas`,
your own logic — and reaches the outside world only through JS functions you
explicitly inject.

## Methods

```typescript
run<T>(code, options?): Promise<{ result: T; stdout: string; stderr: string }>
ready(options?): Promise<void>   // preload the runtime
reset(): void                    // drop the cached runtime
readonly loaded: boolean
```

```typescript
interface PythonRunOptions {
  globals?: Record<string, unknown>;  // JS values/functions exposed to Python
  packages?: string[];                // e.g. ['numpy', 'pandas']
  install?: string[];                 // pure-Python wheels via micropip
  onStdout?: (line: string) => void;  // streamed print() output
  onStderr?: (line: string) => void;
}
```

## Compute

```javascript
const { result } = await sdk.python.run(`
import numpy as np
float(np.mean([1, 2, 3, 4]))
`, { packages: ['numpy'] });

console.log(result); // 2.5
```

## Inject your own callbacks

Python can `await` async JS functions you pass in `globals`:

```javascript
await sdk.python.run(`
for wk in weeks:
    await run_sql(TEMPLATE.replace("{W}", wk))
    log(f"{wk} done")
`, {
  globals: { weeks, TEMPLATE, run_sql: async (s) => fetchData(s), log: console.log },
});
```

<Aside type="tip">
The runtime is a lazy singleton — it loads on the first `run()` (a few seconds)
and is reused. Call `sdk.python.ready()` on page open to hide that latency, then
`run()` is warm. Injected globals are cleared after each call and don't leak.
</Aside>

No manifest needed — `sdk.python` stores no artifact data. Keep long jobs chunked
and stream progress via `onStdout`, since heavy compute blocks the main thread.
