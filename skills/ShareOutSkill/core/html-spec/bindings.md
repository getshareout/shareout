# ShareOut Data Bindings

Data bindings declare which data source each element shows. Required for all dynamic content.

> **Bindings are metadata, not a renderer.** Nothing paints `data-shareout-binding`,
> `data-shareout-template` or `data-shareout-chart` for viewers — not the served SDK, not the
> editor. The attributes tell the Live Editor what an element shows (data panel, Inspect,
> Format control, `editor_readiness`). **Your own JS must read via the SDK and write the
> value into the bound element.** Keep the attribute on the element you paint, and use the
> drop-in helper in [Rendering for viewers](#rendering-for-viewers) instead of hand-wiring
> each element.

## Binding Syntax

```
data-shareout-binding="TYPE:PATH"
```

## Binding Types

| Type | Syntax | Example |
|------|--------|---------|
| JSON | `json:key` | `json:settings.theme` |
| JSON nested | `json:key.path.to.value` | `json:metrics.revenue.total` |
| Table row | `table:name:row:ID:field` | `table:tasks:row:task-1:title` |
| Table row (template) | `table:name:row:$id:field` | `table:tasks:row:$id:title` |
| Table aggregate | `table:name:sum:field` | `table:orders:sum:amount` |
| Table count | `table:name:count:field` | `table:tasks:count:id` |
| Table filtered | `table:name:count:field:filter` | `table:tasks:count:id:done=true` |
| Computed | `computed:name` | `computed:completedCount` |
| Multi-source | `multi:op:source1\|source2` (op: `sum`, `diff`, `product`, `ratio`) | `multi:ratio:json:a\|table:orders:sum:amount` |

## Basic Example

```html
<!-- CORRECT: editor can track it; paintBindings() fills it for viewers -->
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>

<!-- WRONG: hidden from the editor (no binding attribute) -->
<span id="revenue"></span>
```

`json:metrics.revenue` reads json key `metrics` and walks `.revenue` inside its value.

## Format Attribute

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency">$0</span>
```

| Format | Parameters | Output Example |
|--------|------------|----------------|
| `currency` | `:CODE` (ISO 4217, default `USD`) | $1,234.56 · `currency:EUR` → €1,234.56 |
| `percent` | `:decimals` (default 1) — value is already in percent units | `12.5` → 12.5% |
| `number` | `:decimals` (default 0) | 1,235 |
| `number:0` | 0 decimals | 1,235 |
| `number:2` | 2 decimals | 1,234.56 |
| `date` | none | May 29, 2026 |
| `date:short` | none | 5/29/26 |
| `date:long` | none | May 29, 2026 |
| `date:iso` | none | 2026-05-29 |

`time` and `datetime` are **not honored by the editor today** — the parser only
recognizes `currency | percent | number | date` and silently falls back to plain text
(the raw value, unformatted) for anything else. Format a time/datetime value yourself
(e.g. in a `computed:` binding or client-side) rather than relying on
`data-shareout-format="time"` / `"datetime"`.

In Live Studio **Inspect** mode, bound elements show a **Format** control (plain text, number, currency, percent, date) that reads and writes `data-shareout-format` — no need to edit the attribute by hand.

## Editable Bindings

```html
<input data-shareout-binding="json:settings.name"
       data-shareout-editable="true"
       data-shareout-validation="string:minLength=1:maxLength=100">

<input type="number"
       data-shareout-binding="json:settings.goal"
       data-shareout-editable="true"
       data-shareout-validation="number:min=0:max=100">

<input type="checkbox"
       data-shareout-binding="table:tasks:row:$id:done"
       data-shareout-editable="true">
```

## Validation Rules

| Rule | Syntax | Example |
|------|--------|---------|
| Number | `number` | `number` |
| Number with range | `number:min=X:max=Y` | `number:min=0:max=100` |
| String | `string` | `string` |
| String with length | `string:minLength=X:maxLength=Y` | `string:minLength=1:maxLength=50` |
| Email | `email` | `email` |
| URL | `url` | `url` |
| Pattern | `pattern:REGEX` | `pattern:^[A-Z]{2}[0-9]{4}$` |

## Display Label

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>
```

The `data-shareout-display` attribute provides a human-readable label for the editor UI.

## Aggregate Bindings

```html
<!-- Count all -->
<span data-shareout-binding="table:tasks:count:id">0</span>

<!-- Count filtered -->
<span data-shareout-binding="table:tasks:count:id:done=true">0</span>

<!-- Sum -->
<span data-shareout-binding="table:orders:sum:amount"
      data-shareout-format="currency">$0</span>

<!-- Average -->
<span data-shareout-binding="table:orders:avg:amount"
      data-shareout-format="currency">$0</span>
```

## Computed Bindings

Reference computed values from manifest:

```html
<span data-shareout-binding="computed:completedCount"
      data-shareout-display="Completed Tasks">0</span>
```

## Validation Checklist

Full compliance checklist: [overview.md](overview.md#compliance-checklist). Bindings-specific checks:

- [ ] Binding paths match manifest declarations
- [ ] Editable bindings have `data-shareout-editable="true"`
- [ ] Editable bindings have appropriate `data-shareout-validation`
- [ ] Format is `currency`, `percent`, `number`, or `date` — not `time`/`datetime` (not editor-honored, see above)

**Markers the editor actually parses and renders controls for today:** `json:key`
(incl. nested paths), `table:name:row:ID:field` (incl. `$id` template form),
`table:name:sum/count/avg/min/max:field[:filter]`, `computed:name`,
`data-shareout-editable` + `data-shareout-validation` (`number`/`string`/`email`/`url`/`pattern`
rules), `data-shareout-display`, and the outline attributes
(`data-shareout-page`/`-section`/`-tabs`/`-tab`). `multi:` sources parse per the table
above. When in doubt, publish and read back the advisory `editor_readiness` profile
(see [pre-ship.md](../../creating/pre-ship.md)) rather than assuming a marker is honored.

## Rendering for viewers

Paste this once into `app.js` and call it after `ShareOut.create()` and after every write.
It fills `json:` and `table:` bindings (row, `count`/`sum`/`avg`/`min`/`max`, `field=value`
filter) and expands `data-shareout-template` lists, honoring `data-shareout-format`.
`computed:` and `multi:` bindings are yours to compute and set; charts are drawn with your
chart library (see [templates.md](templates.md#charts)).

```js
async function paintBindings(sdk, root = document) {
  const tables = {}, keys = {};
  const rowsOf = (name) => (tables[name] ??= sdk.table(name).find().exec());
  const jsonAt = async (path) => {
    const [key, ...rest] = path.replace(/\[(\w+)\]/g, '.$1').split('.');
    let v = await (keys[key] ??= sdk.json.get(key));
    for (const k of rest) v = v?.[k];
    return v;
  };
  const resolve = async (binding) => {
    const [type, name, op, a, b] = binding.split(':');
    if (type === 'json') return jsonAt(binding.slice(5));
    if (type !== 'table') return undefined;
    let rows = await rowsOf(name);
    if (op === 'row') return rows.find((r) => r.id === a)?.[b];
    if (b) { const [k, v] = b.split('='); rows = rows.filter((r) => String(r[k]) === v); }
    const nums = rows.map((r) => Number(r[a]) || 0);
    const sum = nums.reduce((s, n) => s + n, 0);
    return { count: rows.length, sum, avg: nums.length ? sum / nums.length : 0,
             min: Math.min(...nums), max: Math.max(...nums) }[op];
  };
  const format = (v, f) => {
    if (v == null) return '';
    const [t, p] = (f || '').split(':');
    const nf = (o) => new Intl.NumberFormat(undefined, o).format(Number(v));
    if (t === 'currency') return nf({ style: 'currency', currency: p || 'USD' });
    if (t === 'percent') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: p ? +p : 1 }).format(Number(v) / 100);
    if (t === 'number') return nf({ minimumFractionDigits: +(p || 0), maximumFractionDigits: +(p || 0) });
    if (t === 'date') return p === 'iso' ? new Date(v).toISOString().slice(0, 10) : new Date(v).toLocaleDateString();
    return String(v);
  };

  for (const list of root.querySelectorAll('[data-shareout-template]')) {
    list._proto ??= list.querySelector('[data-shareout-template-item]');
    if (!list._proto) continue;
    list.querySelectorAll('[data-shareout-template-item]').forEach((el) => el.remove());
    const src = list.dataset.shareoutTemplateSource || '';
    const items = src.startsWith('table:') ? await rowsOf(src.slice(6)) : (await jsonAt(src.slice(5))) || [];
    items.forEach((item, i) => {
      const el = list._proto.cloneNode(true);
      for (const n of [el, ...el.querySelectorAll('[data-shareout-binding]')]) {
        const b = n.getAttribute('data-shareout-binding');
        if (b) n.setAttribute('data-shareout-binding', b.replaceAll('$id', item.id).replaceAll('$index', i));
      }
      list.append(el);
    });
  }

  for (const el of root.querySelectorAll('[data-shareout-binding]')) {
    const b = el.getAttribute('data-shareout-binding');
    if (b.includes('$id') || b.includes('$index')) continue;
    const v = await resolve(b);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.matches('input, select, textarea')) el.value = v ?? '';
    else if (el.tagName === 'IMG') { if (v) el.src = v; }
    else el.textContent = format(v, el.dataset.shareoutFormat);
  }
}

// app.js
(async () => {
  const sdk = await ShareOut.create();
  await paintBindings(sdk);
  // after a write: await sdk.table('tasks').insert({ ... }); await paintBindings(sdk);
})();
```

Editable bindings (`data-shareout-editable`) are not saved for you either — add a
`change` listener that writes with `sdk.json.set` / `sdk.table(name).updateById`.

## Related

- [Manifest](manifest.md) - Declaring data sources
- [Templates](templates.md) - Bindings in repeating content
