import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  minify: true,
  platform: 'browser',
  splitting: false,
  // tsup externalises everything in `dependencies` by default, which is wrong for a browser
  // bundle: `@shareout/*` are local workspace packages, so they survived into the output as
  // bare `import ... from "@shareout/chat-core"`. A browser cannot resolve a bare specifier
  // without an import map, and there is none — so the module threw on evaluation, the editor
  // never booted, and the canvas iframe stayed about:blank while the server-rendered shell
  // around it still looked fine. Bundle them.
  noExternal: ['html2canvas', /^@shareout\//],
});
