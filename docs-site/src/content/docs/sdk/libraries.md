---
title: Libraries (so.lib)
description: Import a private, versioned JavaScript module your workspace or account published — like a CDN library, scoped to you.
---

import { Aside } from '@astrojs/starlight/components';

Import a private, versioned JavaScript module — like importing a CDN library, but scoped
to your workspace or account. Access via `so.lib(name)`.

<Aside type="note">
Publishing modules requires a **Teams or Enterprise** plan (see
[Workspace Library](/teams/libraries/)). Any artifact in scope can import them.
</Aside>

## Method

```typescript
// Resolve the pinned-or-latest version of a module by name and dynamic-import it.
lib<T = Record<string, unknown>>(name: string): Promise<T>
```

## Examples

```javascript
// Resolve + import by name — version is resolved server-side for this artifact's scope.
const { bar, formatCurrency } = await so.lib('charts');
bar(document.getElementById('chart'), rows);
```

```html
<!-- Plain HTML, no SDK — import the versioned URL directly. Same-origin, immutable. -->
<script type="module">
  import { bar } from "/lib/your-workspace/charts@1.0.0.js";
</script>
```

`so.lib('charts')` resolves the module in this artifact's scope — its workspace library
first, then the owner's personal library — honoring any version **pin** on the artifact,
otherwise the latest version, then imports same-origin.

## Pure modules

Library modules are **pure**: they receive data as arguments and have **no ambient SDK,
credentials, or network** — like `Plotly.newPlot(el, data)`. The host artifact owns the
data and decides what to pass in.

```javascript
export const bar = (el, rows, opts) => { /* render only */ };
```

## Versioning

Published versions are **immutable** (semver). An artifact can **pin** a module to a
chosen version to stay stable across re-publishes; without a pin, `so.lib` follows the
latest version. Old pinned import URLs keep resolving forever.

## Related

- [Workspace Library](/teams/libraries/) — publishing, scopes, and endpoints
