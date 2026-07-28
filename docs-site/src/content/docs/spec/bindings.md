---
title: Bindings
description: Connecting HTML elements to data sources with data-shareout-binding.
---

Data bindings connect HTML elements to manifest sources. Every dynamic value in an
artifact must use `data-shareout-binding` — direct DOM manipulation via JavaScript hides
values from the editor's data panel and variable tracker.

## Syntax

```
data-shareout-binding="TYPE:PATH"
```

## Binding types

| Type | Syntax | Example |
|------|--------|---------|
| JSON key | `json:key` | `json:settings.theme` |
| JSON nested | `json:key.path.to.value` | `json:metrics.revenue.total` |
| Table row field | `table:name:row:$id:field` | `table:tasks:row:$id:title` |
| Table row (static ID) | `table:name:row:ID:field` | `table:tasks:row:task-1:title` |
| Table count | `table:name:count:field` | `table:tasks:count:id` |
| Table count filtered | `table:name:count:field:filter` | `table:tasks:count:id:done=true` |
| Table sum | `table:name:sum:field` | `table:orders:sum:amount` |
| Table avg | `table:name:avg:field` | `table:orders:avg:amount` |
| Computed | `computed:name` | `computed:completedCount` |

## Basic example

```html
<!-- CORRECT: editor tracks this binding -->
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>

<!-- WRONG: hidden from editor -->
<span id="revenue"></span>
<script>document.getElementById('revenue').textContent = await sdk.json.get('metrics.revenue')</script>
```

## Format attribute

Apply a display format with `data-shareout-format`:

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency">$0</span>
```

| Format | Parameters | Output example |
|--------|------------|----------------|
| `currency` | — | $1,234.56 |
| `percent` | — | 12.5% |
| `number` | — | 1,234 |
| `number:0` | 0 decimals | 1,235 |
| `number:2` | 2 decimals | 1,234.56 |
| `date` | — | May 29, 2026 |
| `date:short` | — | 5/29/26 |
| `date:long` | — | May 29, 2026 |
| `date:iso` | — | 2026-05-29 |
| `time` | — | 3:45 PM |
| `datetime` | — | May 29, 2026 3:45 PM |

In Live Studio **Inspect** mode, bound elements show a **Format** control (plain text,
number, currency, percent, date) that reads and writes `data-shareout-format` — no need to
edit the attribute by hand.

## Display label

`data-shareout-display` provides a human-readable label shown in the editor's data panel:

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>
```

## Editable bindings

Add `data-shareout-editable="true"` to allow viewers to edit the value in place:

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

## Validation rules

| Rule | Syntax | Example |
|------|--------|---------|
| Number | `number` | `number` |
| Number with range | `number:min=X:max=Y` | `number:min=0:max=100` |
| String | `string` | `string` |
| String with length | `string:minLength=X:maxLength=Y` | `string:minLength=1:maxLength=50` |
| Email | `email` | `email` |
| URL | `url` | `url` |
| Pattern | `pattern:REGEX` | `pattern:^[A-Z]{2}[0-9]{4}$` |

## Aggregate bindings

```html
<!-- Count all rows -->
<span data-shareout-binding="table:tasks:count:id">0</span>

<!-- Count filtered rows -->
<span data-shareout-binding="table:tasks:count:id:done=true">0</span>

<!-- Sum -->
<span data-shareout-binding="table:orders:sum:amount"
      data-shareout-format="currency">$0</span>

<!-- Average -->
<span data-shareout-binding="table:orders:avg:amount"
      data-shareout-format="currency">$0</span>
```

## Computed bindings

Reference a value declared in `manifest.computed`:

```html
<span data-shareout-binding="computed:completedCount"
      data-shareout-display="Completed Tasks">0</span>
```

## Checklist

- Every dynamic value has `data-shareout-binding`.
- No `element.textContent = ` or `innerHTML = ` without a corresponding binding.
- Binding paths match keys and table names declared in the [manifest](/spec/manifest/).
- Editable bindings have both `data-shareout-editable="true"` and `data-shareout-validation`.

## Related

- [Manifest](/spec/manifest/) — declaring sources that bindings reference
- [Templates](/spec/templates/) — bindings inside repeating content use `$id` and `$index`
- [Overview](/spec/overview/) — full attribute reference
