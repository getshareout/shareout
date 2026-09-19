// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  formatPartialApplyMessage,
  type PatchApplyResult,
} from '../src/chat/chat';

function createCtx(html: string): any {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    state: {
      html,
      isDirty: false,
    },
    dom: {
      canvasFrame: { contentDocument: doc },
      saveStatus: null,
    },
  };
}

describe('applyPatches', () => {
  it('returns applied/failed/not-found counts for partial apply', () => {
    const ctx = createCtx('<!doctype html><html><body><h1 id="title">Old</h1></body></html>');
    const patches = [
      { selector: '#title', action: 'replace', content: '<h1 id="title">New</h1>' },
      { selector: '#missing', action: 'replace', content: '<p>Never found</p>' },
    ];
    const result = applyPatches(ctx, patches);
    expect(result).toMatchObject({
      applied: 1,
      failed: 1,
      notFound: 1,
    });
    expect(result.appliedPatches).toHaveLength(1);
    expect(result.failedPatches).toHaveLength(1);
  });

  it('does not mark draft dirty when no patch applies', () => {
    const ctx = createCtx('<!doctype html><html><body><h1 id="title">Old</h1></body></html>');
    const result = applyPatches(ctx, [
      { selector: '#missing', action: 'replace', content: '<h1 id="title">New</h1>' },
    ]);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(ctx.state.isDirty).toBe(false);
  });
});

describe('formatPartialApplyMessage', () => {
  it('formats a clear not-found warning', () => {
    const result: PatchApplyResult = {
      applied: 3,
      failed: 2,
      notFound: 2,
      appliedPatches: [],
      failedPatches: [],
    };
    expect(formatPartialApplyMessage(result, 5)).toBe(
      "Applied 3 of 5 changes — 2 changes couldn't find their target"
    );
  });
});
