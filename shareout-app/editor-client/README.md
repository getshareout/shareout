# Editor client

Browser bundle for the visual editor (`/sdk/editor.js`).

## Layout

```
src/
  boot.ts              # Re-exports bootEditor
  editor/
    init.ts            # Bootstrap + init orchestration
    context.ts         # Shared EditorContext type
    logger.ts          # Scoped logging
    dom.ts             # DOM reference collection
    types.ts           # EditorState
  canvas/              # Iframe canvas, selection, drag, resize
  dom/                 # Element selector utilities
  history/             # Undo/redo + HTML sync
  properties/          # Property inspector panel
  charts/              # Chart init + chart property editor
  sdk/                 # SDK data editors (JSON, table, blobs, …)
  chat/                # AI chat panel
  collab/              # WebSocket collaboration
  toolbar/             # Toolbar + keyboard shortcuts
  palette/             # Component palettes
  persistence/         # Save, publish, version history
  elements/            # Duplicate, nudge, style toggles
  lasso/               # Lasso selection tool
  sidecars/            # Presentation / dashboard sidecars
test/                  # Vitest unit tests
```

## Scripts

```bash
npm run build      # dist/index.js + dist/editor.js
npm test           # Unit tests (happy-dom)
npm run typecheck  # tsc --noEmit
```

Worker embed: from repo root, `npm run build:editor`.
