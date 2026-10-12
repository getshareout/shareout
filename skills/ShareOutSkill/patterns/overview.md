# Pattern Library

Copy-paste reference implementations with best practices baked in. Adapt libraries as needed.

## Available Patterns

| Pattern | Use Case | Data Tier |
|---------|----------|-----------|
| [Forms](forms.md) | Data collection, submissions | `sdk.table()` |
| [Tables](tables.md) | Data display, filtering, sorting | `sdk.table()` |
| [Dashboards](dashboards.md) | Charts, KPIs, metrics | `sdk.json` + data sources |
| [Uploads](uploads.md) | File uploads, galleries | `sdk.blobs` |
| [Data provenance](data-provenance.md) | "Where does this data come from?" drawer + badges | manifest + `so.sources` |
| [Performance](performance.md) | Instant first paint, no blank screen | any |

## Best Practices (All Patterns)

- Ship real static HTML so the page paints before JS runs; keep live queries off first paint — [Performance](performance.md)
- Pin CDN versions to avoid breaking changes
- Mobile-responsive by default
- SDK wired in where applicable
- Sandbox-safe configurations
- Compliant with [HTML Spec](../core/html-spec/overview.md)

## Quick Selection

| Building... | Start With |
|-------------|------------|
| Contact form | [Forms: Contact](forms.md#contact-form-emails-owner) |
| Survey | [Forms: Data collection](forms.md#data-collection-form) |
| Sortable data table | [Tables: Sortable](tables.md#sortable-table) |
| KPI dashboard | [Dashboards: Metric cards](dashboards.md#metric-cards) |
| Chart dashboard | [Dashboards: Charts](dashboards.md#chart-dashboard) |
| Image gallery | [Uploads: Image upload](uploads.md#basic-image-upload) |
| Multi-file upload | [Uploads: Drag & drop](uploads.md#drag--drop-upload) |

## Libraries Used

These patterns use popular libraries. Swap as needed:

| Category | Default | Alternatives |
|----------|---------|--------------|
| Charts | ECharts | Chart.js, Plotly, D3.js |
| State | Alpine.js | Vue, Petite-Vue, vanilla JS |
| Tables | Tabulator | AG Grid, DataTables |
| CSS | Pico CSS | Tailwind, Bootstrap, vanilla |
| Forms | Native + Alpine | React Hook Form, Formik |

## Pattern Structure

Each pattern file contains:
1. **Goal** - What it solves
2. **Prerequisites** - Required SDK features
3. **Full Example** - Copy-paste starter
4. **Customization** - Common modifications
5. **Related** - Links to deeper docs

## Related

- [SDK Overview](../sdk/overview.md) - SDK loading
- [HTML Spec](../core/html-spec/overview.md) - Compliance requirements
