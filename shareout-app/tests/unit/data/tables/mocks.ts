// @vitest-environment node
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
  generateId: vi.fn((prefix: string) => `${prefix}_id${++tablesIdSeq}`),
}));
