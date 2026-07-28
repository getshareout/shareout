---
title: Python en el navegador
description: Ejecutá Python dentro de un artifact con Pyodide.
---

import { Aside } from '@astrojs/starlight/components';

Ejecutá Python real dentro de la página vía [Pyodide](https://pyodide.org), cargado bajo
demanda. Accedé vía `sdk.python`. Corre *cualquier* Python — `numpy`, `pandas`,
tu propia lógica — y alcanza el mundo exterior únicamente a través de funciones JS que
inyectás explícitamente.

## Métodos

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

## Cómputo

```javascript
const { result } = await sdk.python.run(`
import numpy as np
float(np.mean([1, 2, 3, 4]))
`, { packages: ['numpy'] });

console.log(result); // 2.5
```

## Inyectá tus propios callbacks

Python puede hacer `await` de funciones JS async que le pasás en `globals`:

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
El runtime es un singleton perezoso — se carga en el primer `run()` (unos segundos)
y se reutiliza. Llamá a `sdk.python.ready()` al abrir la página para esconder esa latencia,
y así `run()` queda tibio. Los globals inyectados se limpian después de cada llamada y no
se filtran.
</Aside>

No hace falta manifest — `sdk.python` no almacena datos del artifact. Mantené los jobs
largos divididos en chunks y transmití el progreso vía `onStdout`, ya que el cómputo
pesado bloquea el hilo principal.
