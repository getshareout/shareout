#!/usr/bin/env node
/**
 * Splits tests/unit/artifacts.test.ts into focused modules under tests/unit/artifacts/.
 * Uses precomputed line boundaries (nested braces break naive depth counting).
 * Run from shareout-app/: node scripts/split-artifacts-tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'tests/unit/artifacts.test.ts');
const OUT = path.join(ROOT, 'tests/unit/artifacts');

/** [describe label, output filename, handler import line] */
const SUITES = [
  ['getUserRole', 'get-user-role.test.ts', "import { getUserRole } from '../../../src/artifacts';"],
  ['handleListArtifacts', 'list-artifacts.test.ts', "import { handleListArtifacts } from '../../../src/artifacts';"],
  ['handleGetArtifact', 'get-artifact.test.ts', "import { handleGetArtifact } from '../../../src/artifacts';"],
  ['handleUpdateArtifact', 'update-artifact.test.ts', "import { handleUpdateArtifact } from '../../../src/artifacts';"],
  ['handleDeleteArtifact', 'delete-artifact.test.ts', "import { handleDeleteArtifact } from '../../../src/artifacts';"],
  ['handleRestoreArtifact', 'restore-artifact.test.ts', "import { handleRestoreArtifact } from '../../../src/artifacts';"],
  ['purgeSoftDeleted', 'purge-soft-deleted.test.ts', "import { purgeSoftDeleted } from '../../../src/artifacts';"],
  ['handleGetArtifactFiles', 'get-artifact-files.test.ts', "import { handleGetArtifactFiles } from '../../../src/artifacts';"],
  ['handleGetCollaborators', 'get-collaborators.test.ts', "import { handleGetCollaborators } from '../../../src/artifacts';"],
  ['handleAddCollaborators', 'add-collaborators.test.ts', "import { handleAddCollaborators } from '../../../src/artifacts';"],
  ['handleRemoveCollaborator', 'remove-collaborator.test.ts', "import { handleRemoveCollaborator } from '../../../src/artifacts';"],
  ['handleTransferOwnership', 'transfer-ownership.test.ts', "import { handleTransferOwnership } from '../../../src/artifacts';"],
  ['handleGetVersions', 'get-versions.test.ts', "import { handleGetVersions } from '../../../src/artifacts';"],
  ['handleRollback', 'rollback.test.ts', "import { handleRollback } from '../../../src/artifacts';"],
  [
    'artifact tags',
    'tags.test.ts',
    "import { handleGetTags, handleAddTag, handleRemoveTag } from '../../../src/artifacts';",
  ],
];

const source = fs.readFileSync(SRC, 'utf8');
const lines = source.split('\n');

// Line numbers are 1-based in editor; convert to 0-based slice indices.
const BOUNDARIES = [
  114, 161, 382, 486, 618, 777, 837, 864, 1100, 1179, 1364, 1498, 1736, 1815, 1978, 2085,
];

const sharedEnd = lines.findIndex((l) => l.startsWith('afterEach('));
const fixtureBody = lines.slice(23, sharedEnd).join('\n');

const sharedTs = `// @vitest-environment node
/**
 * Shared fixtures and DB/R2 mocks for artifact handler unit tests.
 * @module tests/unit/artifacts/shared
 */
import { vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

${fixtureBody}

export {
  user,
  baseEnv,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  jsonBody,
  artifactRow,
  ownerRoleFirst,
};
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'shared.ts'), sharedTs);

fs.writeFileSync(
  path.join(OUT, 'setup.ts'),
  `// @vitest-environment node
/** Per-test cleanup — imported by every artifact handler suite. */
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
`,
);

const SHARED_IMPORT = `import {
  artifactRow,
  baseEnv,
  jsonBody,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  ownerRoleFirst,
  user,
} from './shared';`;

for (let i = 0; i < SUITES.length; i++) {
  const [label, file, handlerImport] = SUITES[i];
  const start = BOUNDARIES[i] - 1;
  const end = BOUNDARIES[i + 1] - 1;
  const body = lines.slice(start, end).join('\n');

  const needsEnv = body.includes(' as Env') || body.includes(': Env');
  const envImport = needsEnv ? "import type { Env } from '../../../src/types';\n" : '';

  const content = `// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
${handlerImport}
${envImport}${SHARED_IMPORT}

${body}
`;
  fs.writeFileSync(path.join(OUT, file), content);
}

fs.writeFileSync(
  path.join(OUT, 'index.ts'),
  `/** Barrel for artifact handler test support modules (Vitest discovers *.test.ts). */
export * from './shared';
`,
);

fs.unlinkSync(SRC);
console.log(`Split ${SUITES.length} suites into ${OUT}/ (kept share.test.ts, roles.test.ts)`);
