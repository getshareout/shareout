// @vitest-environment node
/** Per-test cleanup for comments handler suites. */
import { afterEach, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { dispatchActionItemResolved, dispatchCommentNotify, resetCmtSeq } from './mocks';

beforeEach(() => {
  resetCmtSeq();
  dispatchCommentNotify.mockClear();
  dispatchActionItemResolved.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});
