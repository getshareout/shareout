// Minimal baseline for contributor tooling. CI runs `npm run lint` (0 errors).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.wrangler/**',
      'public/**',
      'migrations/**',
      'src/discovery/openapi.spec.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // Existing codebase uses these widely; tighten later with autofix waves.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['sdk/src/comments-agent/agent.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // @ts-nocheck removal is editor slice 4 — keep lint clean without surfacing the backlog here.
  {
    files: [
      'editor-client/src/charts/chart-editor.ts',
      'editor-client/src/chat/chat.ts',
      'editor-client/src/lasso/lasso.ts',
      'editor-client/src/properties/property-panel.ts',
    ],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
);
