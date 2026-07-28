// @vitest-environment node
/** Per-test cleanup for tables handler suites. */
import { afterEach, beforeEach, vi } from 'vitest';
import { resetTablesIdSeq } from './mocks';

beforeEach(() => {
  resetTablesIdSeq();
});

afterEach(() => {
  vi.restoreAllMocks();
});
