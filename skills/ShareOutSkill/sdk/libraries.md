# SDK: Workspace Library (`so.lib`)

Import a private, versioned JavaScript module your workspace (or your own account)
published — like importing a CDN library, but scoped to you. Access via `sdk.lib(name)`.

Requires a **Teams or Enterprise** plan to *publish* modules (see
[../team/libraries.md](../team/libraries.md)); any artifact in scope can *import* them.

## Method

```typescript
// Resolve the pinned-or-latest version of a module by name and dynamic-import it.
// Returns the module's exports. Cached per name for the page lifetime.
lib<T = Record<string, unknown>>(name: string): Promise<T>
```

## Examples

```javascript
// Import a workspace/personal module by name — version is resolved server-side.
const { bar, formatCurrency } = await sdk.lib('charts');
bar(document.getElementById('chart'), rows);

// Plain HTML (no SDK) — import the versioned URL directly. Same-origin, immutable.
// <script type="module">
//   import { bar } from "/lib/<workspace-slug>/charts@1.0.0.js";
// </script>
```

`sdk.lib('charts')` resolves the module in this artifact's scope (its workspace
library first, then the owner's personal library), honoring any version **pin** set on
the artifact, otherwise the module's latest version. It then imports same-origin.

## Pure modules

Library modules are **pure** in v1: they receive data as arguments and have **no
ambient SDK, credentials, or network**. Pass data in from the host artifact — like
`Plotly.newPlot(el, data)`. A module that needs data gets it as a function argument,
never by reaching into `so.table`/secrets.

```javascript
// Good — pure: host owns the data and creds.
export const bar = (el, rows, opts) => { /* render only */ };
```

## Versioning

Published versions are **immutable** (semver). Re-publishing the same version is
rejected. An artifact can **pin** a module at a chosen version so it stays stable across
re-publishes; without a pin, `so.lib` follows the module's latest version. Old pinned
import URLs keep resolving forever.

## Use Cases

| Use Case | Example |
|----------|---------|
| Shared chart helpers | `const { bar } = await so.lib('charts')` |
| Formatting utilities | `formatCurrency`, `formatDate` |
| Reusable UI components | a custom table/filter widget |
| House design helpers | brand-styled render functions |

## Related

- [Workspace Library (Teams)](../team/libraries.md) — publishing, scopes, endpoints
- [Manifest](../core/html-spec/manifest.md) — declaring sources
