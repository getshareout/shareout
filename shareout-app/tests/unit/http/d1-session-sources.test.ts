// @vitest-environment node
// D1 sessions (D1_READ_REPLICAS) are opened in one place: the request scope, which only
// the fetch dispatcher creates. Cron, queues, email, Durable Objects and workflows never
// pass through handleFetch, so they keep the plain primary-backed env.DB.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../src');
const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((rel) => rel.endsWith('.ts'))
  .map((rel) => ({ rel: `src/${rel.split('\\').join('/')}`, text: readFileSync(join(SRC, rel), 'utf8') }));

describe('non-request paths keep the plain D1 binding', () => {
  it('withSession is only called by the request scope', () => {
    expect(sources.filter((f) => /\.withSession\(/.test(f.text)).map((f) => f.rel)).toEqual(['src/http/request-scope.ts']);
  });

  it('scopeRequest (and so a session) is only opened by the fetch dispatcher', () => {
    const users = sources.filter((f) => /\bscopeRequest\(/.test(f.text) && f.rel !== 'src/http/request-scope.ts');
    expect(users.map((f) => f.rel)).toEqual(['src/router/handle-fetch.ts']);
  });
});
