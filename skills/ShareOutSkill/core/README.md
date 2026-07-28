# Core Specifications

Mandatory specifications that apply to ALL ShareOut artifacts.

## Contents

| File | Purpose | When to Load |
|------|---------|--------------|
| [editor.md](editor.md) | Visual studio at `/a/{slug}/edit` | Editing workflow, studio API |
| [html-spec/overview.md](html-spec/overview.md) | Quick reference, compliance checklist | Always |
| [html-spec/manifest.md](html-spec/manifest.md) | Manifest structure, data sources | Building artifacts |
| [html-spec/bindings.md](html-spec/bindings.md) | Data binding syntax, formats | Dynamic content |
| [html-spec/templates.md](html-spec/templates.md) | Repeating content, charts, realtime | Lists, charts |
| [html-spec/pages.md](html-spec/pages.md) | Page structure, navigation | Multi-page apps |

## Loading Order

1. **overview.md** - Always load first for compliance checklist
2. **manifest.md** - When building any artifact
3. **bindings.md** - When adding dynamic content
4. **templates.md** - When adding lists or charts
5. **pages.md** - When building multi-page or navigated apps

## Key Principle

Every ShareOut artifact MUST comply with the HTML spec. Non-compliant artifacts will have degraded Live Editor functionality.

See [html-spec/overview.md](html-spec/overview.md) for the compliance checklist.
