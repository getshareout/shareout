import { defineConfig } from 'tsup';

// Lazy grid UI bundle: Tabulator + ShareOut theme, fully self-contained so it
// can be dynamically imported by Grid.render() with no bare specifiers left.
// noExternal bundles tabulator-tables (tsup auto-externalizes deps otherwise).
export default defineConfig({
  entry: ['src/grid/ui/index.ts'],
  format: ['esm'],
  outDir: 'dist/grid',
  minify: true,
  dts: false,
  clean: true,
  noExternal: [/.*/],
  injectStyle: false,
});
