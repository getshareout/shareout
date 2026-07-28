#!/usr/bin/env node
/**
 * Splits tests/unit/index-router.test.ts into focused modules under tests/unit/index-router/.
 *
 * Layout:
 * - index.test.ts — Vitest entry (vi.mock + vi.hoisted must live here)
 * - handlers.ts — HandlerMocks type + createHandlerMocks factory (reference / regen)
 * - fixtures.ts — fetchPath, createEnv, auth helpers
 * - suites/*.ts — route-area describe blocks registered from index.test.ts
 *
 * Run from shareout-app/: node scripts/split-index-router-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tests/unit/index-router.test.ts');
const OUT = path.join(ROOT, 'tests/unit/index-router');
const SUITES = path.join(OUT, 'suites');

/** [output filename, 1-based start line, 1-based end line (inclusive)] */
const SUITE_BOUNDARIES = [
  ['cors-preflight', 317, 363],
  ['health-fallthrough', 365, 398],
  ['data-api', 400, 411],
  ['subdomain-routing', 413, 533],
  ['account-auth', 535, 599],
  ['enterprise-routes', 601, 613],
  ['publish-artifacts', 615, 701],
  ['workspaces-folders', 703, 726],
  ['browser-auth-sdk', 728, 763],
  ['artifact-serving', 765, 885],
  ['jobs-proxy-landing', 887, 998],
  ['scheduled-cron', 1000, 1009],
];

if (!fs.existsSync(SRC)) {
  console.error(`Source not found: ${SRC}`);
  process.exit(1);
}

const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

function camelRegister(name) {
  const parts = name.split('-').map((p) => p[0].toUpperCase() + p.slice(1));
  return `register${parts.join('')}Tests`;
}

const handlersTs = `/**
 * Factory for mocked worker handler stubs used by index router integration tests.
 * The live mock instances are created inside \`vi.hoisted()\` in \`index.test.ts\`.
 * @module tests/unit/index-router/handlers
 */
import { vi } from 'vitest';

export const mockResponse = (tag: string, status = 200) =>
  new Response(JSON.stringify({ handler: tag }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Mock-Handler': tag },
  });

export type HandlerMocks = ReturnType<typeof createHandlerMocks>;

export function createHandlerMocks() {
  return {
${lines.slice(17, 107).join('\n').replace(/^  handlers = vi\.hoisted\(\(\) => \(\{/, '').replace(/\}\)\);$/, '')}
  };
}
`;

const fixtureBody = lines.slice(222, 289).join('\n').replace('../../src/', '../../../src/');

const fixturesTs = `// @vitest-environment node
/**
 * Shared request helpers and env factories for index router integration tests.
 * @module tests/unit/index-router/fixtures
 */
import type { Env } from '../../../src/types';
import { vi } from 'vitest';
import worker from '../../../src/index';

${fixtureBody}

export {
  APEX,
  SUB,
  createDb,
  createEnv,
  fetchPath,
  authed,
  handlerTag,
  sheetsState,
  githubState,
};
`;

const mockBlock = lines.slice(4, 108).join('\n')
  .replace("import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';", "import { vi } from 'vitest';")
  .replace('const handlers = vi.hoisted(() => ({', 'const handlers: HandlerMocks = vi.hoisted(() => ({');

const mockSection = lines.slice(109, 218).join('\n').replaceAll('../../src/', '../../../src/');

const indexTestTs = `// @vitest-environment node
/**
 * Index router integration tests — single Vitest entry file.
 *
 * Vitest only hoists \`vi.mock\` in files matching \`*.test.ts\`, so all module mocks
 * and the worker import live here. Individual route areas are split under \`suites/\`.
 *
 * @module tests/unit/index-router/index.test
 */
import { afterEach, beforeEach, vi } from 'vitest';
import type { HandlerMocks } from './handlers';

${mockBlock}

${mockSection}

import worker from '../../../src/index';
${SUITE_BOUNDARIES.map(([name]) => {
  const fn = camelRegister(name);
  return `import { ${fn} } from './suites/${name}';`;
}).join('\n')}

export { handlers };
export type { HandlerMocks };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.validateToken.mockImplementation(async (request: Request) => {
    const auth = request.headers.get('Authorization');
    if (auth === 'Bearer valid-token') {
      return { id: 'usr_1', email: 'owner@example.com', username: 'owner' };
    }
    return null;
  });
  handlers.getSessionUser.mockResolvedValue(null);
  handlers.checkAccountCreation.mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

${SUITE_BOUNDARIES.map(([name]) => `${camelRegister(name)}(handlers);`).join('\n')}
`;

fs.mkdirSync(SUITES, { recursive: true });
fs.writeFileSync(path.join(OUT, 'handlers.ts'), handlersTs);
fs.writeFileSync(path.join(OUT, 'fixtures.ts'), fixturesTs);
fs.writeFileSync(path.join(OUT, 'index.test.ts'), indexTestTs);

for (const [name, start, end] of SUITE_BOUNDARIES) {
  const body = lines.slice(start - 1, end).join('\n');
  const fn = camelRegister(name);
  const workerImport = name === 'scheduled-cron'
    ? "import worker from '../../../../src/index';\n"
    : '';
  const suiteTs = `/**
 * Index router test suite: ${name.replace(/-/g, ' ')}.
 * Registered from \`index.test.ts\` so Vitest hoists \`vi.mock\` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
${workerImport}import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function ${fn}(handlers: HandlerMocks): void {
${body}
}
`;
  fs.writeFileSync(path.join(SUITES, `${name}.ts`), suiteTs);
}

console.log(`Wrote index-router modules under ${path.relative(ROOT, OUT)}/`);
