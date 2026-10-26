// The script-tag SDK bundle (public/sdk/v1/shareout.js) as an artifact sees it: `ShareOut`
// is the class, and the documented `e instanceof ShareOutError` must not throw.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadBundle(prelude = ''): Record<string, unknown> {
  const code = readFileSync(join(__dirname, '../../public/sdk/v1/shareout.js'), 'utf8');
  const ctx: Record<string, unknown> = { console, setTimeout, clearTimeout, URL, URLSearchParams, Headers, Response, Request };
  ctx.globalThis = ctx;
  createContext(ctx);
  if (prelude) runInContext(prelude, ctx);
  runInContext(code, ctx);
  return ctx;
}

describe('SDK script-tag bundle globals', () => {
  it('exposes ShareOut as the class with the error classes as statics and globals', () => {
    const ctx = loadBundle();
    expect(runInContext('typeof ShareOut', ctx)).toBe('function');
    expect(runInContext('ShareOut.ShareOutError === ShareOutError', ctx)).toBe(true);
    expect(runInContext('ShareOut.ConsentRequiredError === ConsentRequiredError', ctx)).toBe(true);
    expect(runInContext('typeof ShareOut.McpError', ctx)).toBe('function');
    expect(runInContext(`(() => { try { throw new ShareOutError('x', 'X', 400); } catch (e) { return e instanceof ShareOutError; } })()`, ctx)).toBe(true);
  });

  it('does not clobber a page-defined ShareOutError global', () => {
    const ctx = loadBundle('var ShareOutError = "mine";');
    expect(runInContext('ShareOutError', ctx)).toBe('mine');
    expect(runInContext('typeof ShareOut.ShareOutError', ctx)).toBe('function');
  });
});
