#!/usr/bin/env node
/**
 * Splits tests/unit/data/slides.test.ts into focused modules under tests/unit/data/slides/.
 * Uses precomputed line boundaries (nested braces break naive depth counting).
 * Run from shareout-app/: node scripts/split-slides-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tests/unit/data/slides.test.ts');
const OUT = path.join(ROOT, 'tests/unit/data/slides');

/** [describe label, output filename, needs handler mocks] */
const SUITES = [
  ['slides db mappers', 'db-mappers.test.ts', false],
  ['slides auth', 'auth.test.ts', false],
  ['handleSlides routing', 'routing.test.ts', true],
  ['slide CRUD routes', 'slide-crud.test.ts', true],
  ['version routes', 'versions.test.ts', true],
  ['presenter routes', 'presenter.test.ts', true],
  ['publish routes', 'publish.test.ts', true],
  ['presentations edge cases', 'presentations-edge.test.ts', true],
  ['slides error paths', 'slides-errors.test.ts', true],
  ['versions error paths', 'versions-errors.test.ts', true],
  ['presenter error paths', 'presenter-errors.test.ts', true],
  ['publish error paths', 'publish-errors.test.ts', true],
  ['slides generate', 'generate.test.ts', true],
  ['slide ai actions', 'ai-actions.test.ts', true],
  ['slide export', 'export.test.ts', true],
];

const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

// 1-based describe start lines from slides.test.ts
const BOUNDARIES = [
  88, 125, 269, 385, 734, 968, 1118, 1186, 1273, 1489, 1688, 1861, 1953, 2028, 2093,
  lines.length + 1,
];

const MOCKS_BLOCK = `let idSeq = 0;

vi.mock('../../../../src/data/slides/realtime', () => ({
  broadcastEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/data/agent/anthropic', () => ({
  getBuildConfig: vi.fn(() => ({ provider: 'openai', apiKey: 'k', baseUrl: 'http://x', model: 'm' })),
  chat: vi.fn(),
}));

vi.mock('../../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => {
    idSeq += 1;
    const hex = idSeq.toString(16).padStart(24, '0').slice(-24);
    return \`\${prefix}_\${hex}\`;
  }),
}));
`;

const sharedTs = `// @vitest-environment node
/**
 * Shared fixtures and request helpers for slides handler unit tests.
 * @module tests/unit/data/slides/shared
 */
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import {
  createSlidesDb,
  makePresentation,
  makeSlide,
} from '../slides-mock-db';

export const ARTIFACT_ID = 'art_test';
export const PRES_ID = 'pres_' + 'a'.repeat(24);
export const SLIDE_ID_1 = 'slide_' + 'b'.repeat(24);
export const SLIDE_ID_2 = 'slide_' + 'c'.repeat(24);
export const VER_ID = 'ver_' + 'd'.repeat(24);
export const BASE_URL = 'https://shareout.example.com';

export function makeCtx(db: ReturnType<typeof createSlidesDb>['db']): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'demo-deck',
      visibility: 'private',
      auth_method: null,
    },
    env: {
      DB: db as unknown as Env['DB'],
      SHAREOUT_BASE_URL: BASE_URL,
      REALTIME: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    } as Env,
    origin: 'https://app.example.com',
  };
}

export function jsonRequest(method: string, path: string, body?: unknown): Request {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(\`\${BASE_URL}/v1/data/\${ARTIFACT_ID}/slides/\${path}\`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function parseJson(res: Response) {
  return res.json() as Promise<{ success: boolean; data?: Record<string, unknown>; code?: string; error?: string }>;
}

export function seedPresentationWithSlides() {
  const pres = makePresentation({ id: PRES_ID, artifact_id: ARTIFACT_ID });
  const slide1 = makeSlide({ id: SLIDE_ID_1, presentation_id: PRES_ID, position: 0, content: 'Slide 1' });
  const slide2 = makeSlide({ id: SLIDE_ID_2, presentation_id: PRES_ID, position: 1, content: 'Slide 2' });
  return createSlidesDb({ presentations: [pres], slides: [slide1, slide2] });
}

/** Reset generateId sequence — call in beforeEach when IDs must be deterministic. */
export function resetIdSeq(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__slidesIdSeq = ((globalThis as any).__slidesIdSeq ?? 0);
}
`;

// Fix shared.ts - makeCtx uses vi.fn() but vi isn't imported. Need to import vi in shared.ts
const sharedTsFixed = sharedTs.replace(
  "import type { Env } from '../../../../src/types';",
  "import { vi } from 'vitest';\nimport type { Env } from '../../../../src/types';",
).replace(
  `/** Reset generateId sequence — call in beforeEach when IDs must be deterministic. */
export function resetIdSeq(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__slidesIdSeq = ((globalThis as any).__slidesIdSeq ?? 0);
}
`,
  '',
);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'shared.ts'), sharedTsFixed);

fs.writeFileSync(
  path.join(OUT, 'setup.ts'),
  `// @vitest-environment node
/** Per-test cleanup — imported by every slides handler suite. */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
`,
);

fs.writeFileSync(
  path.join(OUT, 'index.ts'),
  `/** Barrel for slides handler test support modules (Vitest discovers *.test.ts). */
export * from './shared';
`,
);

const HANDLER_IMPORTS = `import * as middleware from '../../../../src/data/middleware';
import { handleSlides } from '../../../../src/data/slides/handler';
import { broadcastEvent } from '../../../../src/data/slides/realtime';
import { createSlidesDb } from '../slides-mock-db';
import {
  ARTIFACT_ID,
  BASE_URL,
  PRES_ID,
  SLIDE_ID_1,
  SLIDE_ID_2,
  VER_ID,
  jsonRequest,
  makeCtx,
  parseJson,
  seedPresentationWithSlides,
} from './shared';
`;

const DB_MAPPERS_IMPORTS = `import { mapPresentation, mapSlide } from '../../../../src/data/slides/db';
import { makePresentation, makeSlide } from '../slides-mock-db';
`;

const AUTH_IMPORTS = `import type { DataContext } from '../../../../src/data/middleware';
import * as middleware from '../../../../src/data/middleware';
import { canEditPresentation, canEditSlide, getSession } from '../../../../src/data/slides/auth';
import { makeSlide } from '../slides-mock-db';
import type { Env } from '../../../../src/types';
import { createSlidesDb, makePresentation } from '../slides-mock-db';
import { ARTIFACT_ID, PRES_ID, makeCtx } from './shared';
`;

const GENERATE_IMPORTS = `import { chat, getBuildConfig } from '../../../../src/data/agent/anthropic';
`;

const EXPORT_IMPORTS = `import { mapPresentation } from '../../../../src/data/slides/db';
import { buildSlideHtml, buildDeckHtml } from '../../../../src/data/slides/export';
import { makePresentation } from '../slides-mock-db';
`;

for (let i = 0; i < SUITES.length; i++) {
  const [label, file, needsMocks] = SUITES[i];
  const start = BOUNDARIES[i] - 1;
  const end = BOUNDARIES[i + 1] - 1;
  let body = lines.slice(start, end).join('\n');

  // Replace idSeq = 0 with comment — idSeq lives in files with mocks
  if (needsMocks) {
    body = body.replace(/^\s*idSeq = 0;\n/gm, '');
  }

  let extraImports = '';
  if (file === 'db-mappers.test.ts') extraImports = DB_MAPPERS_IMPORTS;
  else if (file === 'auth.test.ts') extraImports = AUTH_IMPORTS;
  else if (file === 'generate.test.ts' || file === 'ai-actions.test.ts') {
    extraImports = HANDLER_IMPORTS + GENERATE_IMPORTS;
  } else if (file === 'export.test.ts') {
    extraImports = HANDLER_IMPORTS + EXPORT_IMPORTS;
  } else if (needsMocks) {
    extraImports = HANDLER_IMPORTS;
  }

  const mocks = needsMocks ? MOCKS_BLOCK : '';
  const vitestImports = needsMocks
    ? "import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';"
    : file === 'auth.test.ts'
      ? "import { afterEach, describe, expect, it, vi } from 'vitest';"
      : "import { describe, expect, it } from 'vitest';";

  const setupImport = file === 'db-mappers.test.ts' ? '' : "import './setup';\n";

  const content = `// @vitest-environment node
${setupImport}${vitestImports}
${mocks}${extraImports}

${body}
`;
  fs.writeFileSync(path.join(OUT, file), content);
}

fs.unlinkSync(SRC);
console.log(`Split ${SUITES.length} suites into ${OUT}/`);
