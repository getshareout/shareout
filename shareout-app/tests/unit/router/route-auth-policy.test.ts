// Guard: every route the worker matches either refuses an anonymous caller (401, 403 or a
// redirect to sign-in) or is listed in route-policies.ts with the reason it is open.
// Routes are read from router source (route-matchers.ts), so a new route is covered the
// moment it is written. Same idea for `sot_` tokens: only the routers that enforce their
// workspace boundary may answer them with data.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleFetch } from '../../../src/router/handle-fetch';
import { hashToken } from '../../../src/api-auth';
import { extractRouteMatchers, sampleUrlFor, type RouteMatcher } from './route-matchers';
import { AGENT_TOKEN_ROUTERS, OPEN_ROUTES } from './route-policies';

const sources = import.meta.glob(['../../../src/router/**/*.ts', '../../../src/mcp/index.ts', '../../../src/email/routes.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const matchers = extractRouteMatchers(sources);
const AGENT_TOKEN = 'sot_' + '9'.repeat(64);
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name, is_service) VALUES ('usr_rap_agent', NULL, 'agent', 1), ('usr_rap_owner', 'owner@example.com', 'o', 0)"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('wsp_rap', 'W', 'rap', 'usr_rap_owner')"),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_rap_1', 'wsp_rap', 'usr_rap_owner', 'owner', 'internal'), ('wm_rap_2', 'wsp_rap', 'usr_rap_agent', 'member', 'internal')"),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, scopes) VALUES ('sot_rap', 'workspace', 'wsp_rap', 'usr_rap_agent', ?, 'artifacts:read,artifacts:publish,data:read,data:write')")
    .bind(await hashToken(AGENT_TOKEN)).run();
});

function urlFor(m: RouteMatcher): string {
  return sampleUrlFor(m.matcher, m.kind).replace(/\/workspaces\/probe(?=\/|$)/, '/workspaces/wsp_rap');
}

async function probe(path: string, method: string, auth?: string): Promise<Response> {
  return handleFetch(new Request(`https://shareout.test${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: method === 'GET' ? undefined : '{}',
  }), e);
}

function refusesAnonymous(res: Response): boolean {
  if (res.status === 401 || res.status === 403) return true;
  const loc = res.headers.get('Location') || '';
  return res.status >= 300 && res.status < 400 && /\/auth\/login|\/setup/.test(loc);
}

describe('route matcher extraction', () => {
  it('finds the router surface', () => {
    expect(matchers.length).toBeGreaterThan(300);
  });

  it('builds a sample URL every regex route accepts', () => {
    const bad = matchers.filter((m) => m.kind === 'regex' && !new RegExp(m.matcher).test(sampleUrlFor(m.matcher, m.kind)));
    expect(bad.map((m) => m.matcher)).toEqual([]);
  });
});

describe('route auth policy', () => {
  it('has no stale entries in the open-route list', () => {
    const known = new Set(matchers.map((m) => m.matcher));
    expect(Object.keys(OPEN_ROUTES).filter((k) => !known.has(k))).toEqual([]);
  });

  it('every route refuses an anonymous caller or is listed as open, with a reason', async () => {
    const unlisted: string[] = [];
    for (const m of matchers) {
      if (OPEN_ROUTES[m.matcher]) continue;
      const url = urlFor(m);
      const results = await Promise.all(METHODS.map(async (method) => {
        const res = await probe(url, method);
        await res.body?.cancel();
        return { method, res };
      }));
      const ok = results.filter(({ res }) => res.status >= 200 && res.status < 300);
      if (ok.length || !results.some(({ res }) => refusesAnonymous(res))) {
        unlisted.push(`${m.matcher}  (${results.map(({ method, res }) => `${method} ${res.status}`).join(', ')})  in ${m.files.join(', ')}`);
      }
    }
    expect(unlisted, 'Gate these routes, or add them to OPEN_ROUTES in tests/unit/router/route-policies.ts with a reason').toEqual([]);
  }, 180_000);

  it('workspace Agent tokens get data only from the routers that enforce their boundary', async () => {
    const leaks: string[] = [];
    for (const m of matchers) {
      if (OPEN_ROUTES[m.matcher]) continue;
      if (m.files.some((f) => AGENT_TOKEN_ROUTERS.includes(f))) continue;
      const url = urlFor(m);
      for (const method of METHODS) {
        const res = await probe(url, method, AGENT_TOKEN);
        await res.body?.cancel();
        if (res.status >= 200 && res.status < 300) leaks.push(`${method} ${url} → ${res.status}  in ${m.files.join(', ')}`);
      }
    }
    expect(leaks, 'A route outside AGENT_TOKEN_ROUTERS answered an Agent token; use the default auth guards').toEqual([]);
  }, 180_000);
});
