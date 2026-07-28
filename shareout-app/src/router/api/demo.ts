// Showtime control API (work/044 §6.1). Kicks/stops/inspects a demo scenario run.
// Gated: super-admin OR sales email (superadmin-recipients.json) via session, AND the
// target workspace must be a demo workspace (`demo-*` slug). Refuses anything else.

import type { FetchContext } from '../context';
import { getTokenOrSessionUser } from '../helpers/auth-guard';
import { isSuperAdminEmail } from '../../superadmin/recipients';
import { jsonError, jsonResponse } from '../helpers/json-response';
import { logScenarioFailure, mapScenarioFailure } from '../../demo/errors';
import { buildScenario, SCENARIOS } from '../../demo/scenarios';

async function demoWorkspace(env: FetchContext['env'], slug: string): Promise<{ id: string; slug: string } | null> {
  if (!slug || !slug.startsWith('demo-')) return null;
  const row = await env.DB.prepare('SELECT id, slug FROM workspaces WHERE slug = ? LIMIT 1')
    .bind(slug).first<{ id: string; slug: string }>();
  return row ?? null;
}

const stub = (env: FetchContext['env'], workspaceId: string, scenario: string) =>
  env.SHOWTIME.get(env.SHOWTIME.idFromName(`${workspaceId}:${scenario}`));

export async function routeDemoApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, addCORS } = ctx;
  if (!path.startsWith('/v1/demo/')) return null;

  // Sales/admin only — token OR session, restricted to super-admin emails. Token support
  // lets the control-panel artifact (cross-origin) and a CLI remote trigger runs; the
  // demo-* workspace check below is the second lock.
  const admin = await getTokenOrSessionUser(ctx);
  if (!admin || !isSuperAdminEmail(admin.email)) {
    return addCORS(jsonError('Forbidden — sales/admin only', 'FORBIDDEN', 403));
  }

  // Scenario catalog for the control panel.
  if (path === '/v1/demo/scenarios' && request.method === 'GET') {
    return addCORS(jsonResponse({ scenarios: SCENARIOS }));
  }

  if (path === '/v1/demo/run' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { workspace?: string; scenario?: string };
    const ws = await demoWorkspace(env, body.workspace ?? '');
    if (!ws) return addCORS(jsonError('workspace must be a demo-* workspace', 'NOT_DEMO_WORKSPACE', 400));
    const scenario = body.scenario ?? '';
    let timeline;
    try {
      timeline = await buildScenario(env, scenario, ws.id);
    } catch (err) {
      logScenarioFailure(env, err, { workspace: body.workspace ?? '', scenario });
      const failure = mapScenarioFailure(err);
      return addCORS(jsonError(failure.message, failure.code, failure.status));
    }
    const res = await stub(env, ws.id, scenario).fetch('https://do/start', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: ws.id, scenario, startedBy: admin.email ?? 'sales', timeline }),
    });
    const out = await res.json<{ steps: number }>();
    return addCORS(jsonResponse({ ok: true, workspace: ws.slug, scenario, steps: out.steps }));
  }

  if (path === '/v1/demo/stop' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { workspace?: string; scenario?: string };
    const ws = await demoWorkspace(env, body.workspace ?? '');
    if (!ws) return addCORS(jsonError('workspace must be a demo-* workspace', 'NOT_DEMO_WORKSPACE', 400));
    await stub(env, ws.id, body.scenario ?? '').fetch('https://do/stop', { method: 'POST' });
    return addCORS(jsonResponse({ ok: true, stopped: true }));
  }

  if (path === '/v1/demo/status' && request.method === 'GET') {
    const slug = url.searchParams.get('workspace') ?? '';
    const scenario = url.searchParams.get('scenario') ?? '';
    const ws = await demoWorkspace(env, slug);
    if (!ws) return addCORS(jsonError('workspace must be a demo-* workspace', 'NOT_DEMO_WORKSPACE', 400));
    const res = await stub(env, ws.id, scenario).fetch('https://do/status');
    return addCORS(jsonResponse(await res.json()));
  }

  return null;
}
