import { defineConfig } from 'tsup';

// Builds the browser IIFE consumed by server-rendered pages (home, create) via
// <script src="/sdk/chat-core.js">, exposing the named exports under the global
// `ChatCore`. The editor client imports the TS source directly (see package
// exports), so it never loads this asset.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['iife'],
  globalName: 'ChatCore',
  minify: true,
  platform: 'browser',
  splitting: false,
  clean: true,
  outExtension() {
    return { js: '.global.js' };
  },
});
