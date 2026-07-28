// @vitest-environment node
/**
 * Shared Vitest mocks for comments handler suites.
 * Import this module first so vi.mock hoisting applies before handler imports.
 */
import { vi } from 'vitest';

export const dispatchCommentNotify = vi.fn();
export const dispatchActionItemResolved = vi.fn();

vi.mock('../../../../src/data/comment-notify', () => ({
  dispatchCommentNotify: (...args: unknown[]) => dispatchCommentNotify(...args),
  dispatchActionItemResolved: (...args: unknown[]) => dispatchActionItemResolved(...args),
}));

export let cmtSeq = 0;

export function resetCmtSeq(): void {
  cmtSeq = 0;
}

vi.mock('../../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => {
    if (prefix === 'cmt') {
      return `cmt_${String(++cmtSeq).padStart(24, '0')}`;
    }
    return `${prefix}_${++cmtSeq}`;
  }),
}));
