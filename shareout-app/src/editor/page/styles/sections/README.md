# Editor style sections

The visual editor page injects one large CSS bundle via `getEditorStyles()` in
`../editor-styles.ts`. That bundle is assembled from the modules in this folder
so each UI area can evolve independently and no single file exceeds 1000 lines.

## Module map

| Module | UI area |
|--------|---------|
| `tokens.css.ts` | Design tokens (`:root`, dark theme) |
| `base.css.ts` | Reset and base element rules |
| `topbar.css.ts` | Floating glass topbar |
| `workspace-menu.css.ts` | Workspace dropdown menu |
| `canvas.css.ts` | Full-viewport canvas |
| `style-popover.css.ts` | Inline style popover |
| `studio-rail-shell.css.ts` | Studio rail layout, tabs, panes |
| `studio-rail-agent.css.ts` | Agent chat, share form, welcome |
| `studio-rail-inspect.css.ts` | Inspect / property panel |
| `studio-rail-data.css.ts` | Data browser, chat input, agent plan |
| `workspace-drawer.css.ts` | Workspace slide-over drawer |
| `outline-panel.css.ts` | Outline tree in drawer |
| `artifact-details-drawer.css.ts` | Artifact details in drawer |
| `selection-handles.css.ts` | Selection box and handles |
| `lasso-tool.css.ts` | Lasso selection tool |
| `responsive.css.ts` | Breakpoint overrides |
| `utilities.css.ts` | Utility and a11y helpers |
| `variable-popover.css.ts` | Variable info popover |
| `artifact-details-enhanced.css.ts` | Enhanced details panel (storage, files) |
| `validation-panel.css.ts` | Publish validation panel |

## Adding or changing styles

1. Edit the module that owns the selectors you need (grep for a class name).
2. Keep section order in `getEditorStyles()` — tokens and base must come first.
3. Run `npm test -- test/editor/page/editor-styles.test.ts`.
