#!/usr/bin/env node
/**
 * Splits tests/unit/data/tables.test.ts into focused modules under tests/unit/data/tables/.
 * Run from shareout-app/: node scripts/split-tables-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tests/unit/data/tables.test.ts');
const OUT = path.join(ROOT, 'tests/unit/data/tables');
const MOCK_DB = path.join(ROOT, 'tests/unit/data/tables-mock-db.ts');

/** [describe label, output filename, extra imports beyond handleTables] */
const SUITES = [
  ['handleTables validation', 'handler-validation.test.ts', []],
  ['handleTables list and schema', 'list-schema.test.ts', []],
  ['handleTables CSV export', 'csv-export.test.ts', []],
  ['handleTables row CRUD', 'row-crud.test.ts', []],
  ['handleTables row limits', 'row-limits.test.ts', []],
  ['handleTables query actions', 'query-actions.test.ts', []],
  ['handleTables query count opt-out (opt-013)', 'query-count-opt-out.test.ts', ['vi']],
  ['handleTables method guards', 'method-guards.test.ts', []],
  ['handleTables opt-012 name→id JOIN', 'name-id-join.test.ts', []],
  [
    'tables auth via dataMiddleware',
    'auth.test.ts',
    ['dataMiddleware', 'handleDataRequest', 'createAccessToken', 'Env'],
  ],
];

const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

// 1-based line numbers where each describe() starts; last entry is EOF.
const BOUNDARIES = [436, 507, 574, 616, 856, 902, 1184, 1277, 1300, 1347, 1430];

const mockDbBody = lines.slice(15, 405).join('\n');
const sharedHelpers = lines.slice(406, 426).join('\n');

fs.writeFileSync(
  MOCK_DB,
  `// @vitest-environment node
/**
 * In-memory D1 mock for tables handler unit tests.
 * Mirrors artifact_tables / artifact_rows SQL used by src/data/tables/.
 * @module tests/unit/data/tables-mock-db
 */
import { vi } from 'vitest';

${mockDbBody}
`,
);

const sharedTs = `// @vitest-environment node
/**
 * Shared fixtures and request helpers for tables handler unit tests.
 * @module tests/unit/data/tables/shared
 */
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import { createTablesDb } from '../tables-mock-db';

export { createTablesDb };
export type TablesDb = ReturnType<typeof createTablesDb>;

export const ARTIFACT_ID = 'art_1';

${sharedHelpers.replace('art_1', 'ARTIFACT_ID').replace("'art_1'", 'ARTIFACT_ID')}
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'shared.ts'), sharedTs);

fs.writeFileSync(
  path.join(OUT, 'mocks.ts'),
  `// @vitest-environment node
/**
 * Shared Vitest mocks for tables handler suites.
 * Import first so vi.mock hoisting applies before handler imports.
 */
import { vi } from 'vitest';

export let tablesIdSeq = 0;

export function resetTablesIdSeq(): void {
  tablesIdSeq = 0;
}

vi.mock('../../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => \`\${prefix}_id\${++tablesIdSeq}\`),
}));
`,
);

fs.writeFileSync(
  path.join(OUT, 'setup.ts'),
  `// @vitest-environment node
/** Per-test cleanup for tables handler suites. */
import { afterEach, beforeEach, vi } from 'vitest';
import { resetTablesIdSeq } from './mocks';

beforeEach(() => {
  resetTablesIdSeq();
});

afterEach(() => {
  vi.restoreAllMocks();
});
`,
);

fs.writeFileSync(
  path.join(OUT, 'index.ts'),
  `/** Barrel for tables handler test support modules (Vitest discovers *.test.ts). */
export * from './shared';
`,
);

function suiteHeader(filename, extra) {
  const needsVi = extra.includes('vi');
  const vitestImports = needsVi ? 'describe, expect, it, vi' : 'describe, expect, it';
  const handlerImport = "import { handleTables } from '../../../../src/data/tables';";
  const extraImports = [];
  if (extra.includes('dataMiddleware')) {
    extraImports.push("import { dataMiddleware } from '../../../../src/data/middleware';");
  }
  if (extra.includes('handleDataRequest')) {
    extraImports.push("import { handleDataRequest } from '../../../../src/data/router';");
  }
  if (extra.includes('createAccessToken')) {
    extraImports.push("import { createAccessToken } from '../../../../src/token';");
  }
  if (extra.includes('Env')) {
    extraImports.push("import type { Env } from '../../../../src/types';");
  }
  const sharedImport =
    filename === 'query-count-opt-out.test.ts'
      ? "import { createTablesDb, ctxFromDb, tablesRequest } from './shared';"
      : filename === 'auth.test.ts'
        ? "import { createTablesDb } from './shared';"
        : "import { createTablesDb, ctxFromDb, tablesRequest } from './shared';";

  return `// @vitest-environment node
/**
 * Tables handler tests — ${filename.replace('.test.ts', '').replace(/-/g, ' ')}.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { ${vitestImports} } from 'vitest';
${handlerImport}
${extraImports.join('\n')}
${sharedImport}
`;
}

for (let i = 0; i < SUITES.length; i++) {
  const [, filename, extra] = SUITES[i];
  const start = BOUNDARIES[i] - 1;
  const end = BOUNDARIES[i + 1] - 1;
  const body = lines.slice(start, end).join('\n');
  fs.writeFileSync(path.join(OUT, filename), `${suiteHeader(filename, extra)}\n${body}\n`);
}

console.log(`Wrote ${SUITES.length} suites + shared modules. Delete ${SRC} after verifying tests.`);
