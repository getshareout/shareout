# ShareOut Data Bindings

Data bindings connect HTML elements to data sources. Required for all dynamic content.

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
| Multi-source | `multi:source1+source2` | `multi:json:a+table:b:sum:c` |

## Basic Example

```html
<!-- CORRECT: Editor can track this -->
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency"
      data-shareout-display="Total Revenue">$0</span>

<!-- WRONG: Hidden from editor -->
<span id="revenue"></span>
<script>document.getElementById('revenue').textContent = await sdk.json.get('metrics.revenue')</script>
```

## Format Attribute

```html
<span data-shareout-binding="json:metrics.revenue"
      data-shareout-format="currency">$0</span>
```

| Format | Parameters | Output Example |
|--------|------------|----------------|
| `currency` | none | $1,234.56 |
| `percent` | none | 12.5% |
| `number` | `:decimals` | 1,234.56 |
| `number:0` | 0 decimals | 1,235 |
| `number:2` | 2 decimals | 1,234.56 |
| `date` | none | May 29, 2026 |
| `date:short` | none | 5/29/26 |
| `date:long` | none | May 29, 2026 |
| `date:iso` | none | 2026-05-29 |
| `time` | none | 3:45 PM |
| `datetime` | none | May 29, 2026 3:45 PM |

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

## Related

- [Manifest](manifest.md) - Declaring data sources
- [Templates](templates.md) - Bindings in repeating content
