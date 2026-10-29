import { describe, expect, it } from 'vitest';
import { createClient, parseSse } from '../../../../evals/page-build/client';
import { deletePages, EVAL_TAG, runEval, selectItems } from '../../../../evals/page-build/runner';
import { EVAL_SET } from '../../../../evals/page-build/set';
import { TASKS_SEED } from '../../../../evals/page-build/seeds';
import { mockInstance } from './mock-api';

const SECRET = 'sot_super_secret_value';
const origin = 'https://instance.example';

const good = (tables: string[]) => [{
  path: 'index.html',
  content: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>@media(max-width:600px){}</style>
<script type="shareout/manifest">${JSON.stringify({ sources: { tables: Object.fromEntries(tables.map((t) => [t, { a: 'text' }])) } })}</script></head>
<body><form><input required><input required><input><input><input></form><script>const t = shareout.table('${tables[0] ?? 'x'}'); t.insert({a:1}); [1].reduce((a,b)=>a+b,0); /* delete overlap */</script></body></html>`,
}];
const broken = [{ path: 'index.html', content: '<html><body><script>const a = ;</script></body></html>' }];

const pick = (...ids: string[]) => selectItems(ids);
const setup = (m: Parameters<typeof mockInstance>[0]) => {
  const api = mockInstance(m);
  const client = createClient({ origin, token: SECRET, fetch: api.fetch });
  return { api, client };
};

describe('parseSse', () => {
  it('reads data events and skips noise', () => {
    expect(parseSse('data: {"a":1}\n\n: keep-alive\n\ndata: not json\n\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('selectItems', () => {
  it('narrows the set and rejects an unknown id loudly', () => {
    expect(selectItems(['crud-tasks-en']).map((i) => i.id)).toEqual(['crud-tasks-en']);
    expect(selectItems(undefined)).toBe(EVAL_SET);
    expect(() => selectItems(['nope'])).toThrow(/Unknown eval item/);
  });
});

describe('runEval', () => {
  it('builds through chat then confirm, reads the files back, scores and tags the page', async () => {
    const { api, client } = setup({ files: () => good(['tasks']) });
    const res = await runEval({ client, origin, workspace: 'wsp_1', items: pick('crud-tasks-en'), now: () => 0 });

    const run = res.runs[0];
    expect(run.built).toBe(true);
    expect(run.error).toBeUndefined();
    expect(run.steps).toEqual(['Designing', 'Publishing']);
    expect(run.static?.errors).toBe(0);
    expect(run.verify?.status).toBe('pass');
    expect(run.checks.filter((c) => !c.pass)).toEqual([]);
    expect(run.passed).toBe(true);
    expect(res.aggregate).toMatchObject({ runs: 1, passed: 1, passRate: 1, built: 1, verified: 1 });
    expect(res.created).toEqual([run.artifactId]);

    const paths = api.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain('POST /v1/workspace/wsp_1/agent/chat');
    expect(paths).toContain('POST /v1/workspace/wsp_1/agent/confirm');
    expect(paths).toContain(`POST /v1/artifacts/${run.artifactId}/tags`);
    expect(api.calls.find((c) => c.path.endsWith('/tags'))?.body).toEqual({ label: EVAL_TAG });
    expect(api.calls.find((c) => c.path.endsWith('/agent/chat'))?.body).toEqual({ text: EVAL_SET.find((i) => i.id === 'crud-tasks-en')!.prompt });
  });

  it('sends the token only as a bearer header and never puts it in the results', async () => {
    const { api, client } = setup({ files: () => good(['tasks']) });
    const res = await runEval({ client, origin, workspace: 'wsp_1', items: pick('crud-tasks-en') });
    expect(api.calls.every((c) => c.auth === `Bearer ${SECRET}`)).toBe(true);
    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(JSON.stringify(api.calls.map((c) => c.path))).not.toContain(SECRET);
  });

  it('fails a page whose static check has errors, and says why', async () => {
    const { client } = setup({ files: () => broken });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(res.runs[0].passed).toBe(false);
    expect(res.runs[0].built).toBe(true);
    expect(res.runs[0].static?.issues.map((i) => i.rule)).toContain('js_syntax');
    expect(res.aggregate.passRate).toBe(0);
    expect(res.aggregate.meanStaticIssues).toBeGreaterThan(0);
  });

  it('fails a page the browser verify fails, but not one it could not render', async () => {
    const fail = setup({ files: () => good(['tasks']), verifyBody: { status: 'fail', counts: { error: 2, warning: 1 }, issues: [{ rule: 'js_error', severity: 'error', message: 'boom' }] } });
    const a = await runEval({ client: fail.client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(a.runs[0].passed).toBe(false);
    expect(a.runs[0].verify).toMatchObject({ status: 'fail', errors: 2 });

    const partial = setup({ files: () => good(['tasks']), verifyBody: { status: 'partial', counts: { error: 0, warning: 0 }, issues: [] } });
    const b = await runEval({ client: partial.client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(b.runs[0].passed).toBe(true);
    expect(b.runs[0].verifyNote).toMatch(/partial/);
    expect(b.aggregate.verified).toBe(0);
    expect(b.aggregate.meanVerifyIssues).toBeNull();
  });

  it('records a verify call that errors instead of aborting the run', async () => {
    const { client } = setup({ files: () => good(['tasks']), verifyStatus: 500, verifyBody: { error: 'no browser' } });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(res.runs[0].built).toBe(true);
    expect(res.runs[0].verify).toBeNull();
    expect(res.runs[0].verifyNote).toMatch(/verify failed/);
  });

  it('skips verify with verify:false', async () => {
    const { api, client } = setup({ files: () => good(['tasks']) });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en'), verify: false });
    expect(api.calls.some((c) => c.path.endsWith('/verify'))).toBe(false);
    expect(res.verify).toBe(false);
    expect(res.runs[0].passed).toBe(true);
  });

  it('records an assistant that proposes nothing, and a build that fails, without stopping the set', async () => {
    const items = pick('crud-tasks-en', 'crud-contacts-es', 'crud-expenses-es');
    const { client } = setup({ files: () => good(['x']), noProposalFor: /agenda de contactos/, failConfirmFor: /planilla para registrar gastos/ });
    const res = await runEval({ client, origin, workspace: 'w', items });
    expect(res.runs.map((r) => r.itemId)).toEqual(['crud-tasks-en', 'crud-contacts-es', 'crud-expenses-es']);
    expect(res.runs[1].error).toMatch(/proposed no build.*colours/);
    expect(res.runs[2].error).toMatch(/did not finish.*own checks/);
    expect(res.runs.map((r) => r.built)).toEqual([true, false, false]);
    expect(res.aggregate).toMatchObject({ runs: 3, built: 1, passed: 0 });
  });

  it('turns an API error into a failed run with the status, never the token', async () => {
    const client = createClient({ origin, token: SECRET, fetch: async () => new Response('{"error":"Forbidden"}', { status: 403 }) });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(res.runs[0].error).toMatch(/403 Forbidden/);
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('repeats each item and keeps the runs numbered', async () => {
    const { client } = setup({ files: () => good(['tasks']) });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en', 'crud-bookings-en'), repeat: 2 });
    expect(res.runs.map((r) => `${r.itemId}#${r.run}`)).toEqual(['crud-tasks-en#1', 'crud-tasks-en#2', 'crud-bookings-en#1', 'crud-bookings-en#2']);
    expect(res.repeat).toBe(2);
  });

  it('attributes the usage ledger delta to each run', async () => {
    const { client } = setup({ files: () => good(['tasks']) });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en', 'crud-bookings-en') });
    expect(res.runs[0].usage?.tokens).toBe(10_000);
    expect(res.aggregate.usage?.tokens).toBe(20_000);
  });

  it('measures wall time with the injected clock', async () => {
    const { client } = setup({ files: () => good(['tasks']) });
    let t = 0;
    const res = await runEval({ client, origin, workspace: 'w', items: pick('crud-tasks-en'), now: () => (t += 1500) });
    expect(res.runs[0].wallMs).toBeGreaterThan(0);
    expect(res.aggregate.wallMs.total).toBe(res.runs[0].wallMs);
  });

  it('publishes a seed for an edit item, names the page in the request, and scores the edited files', async () => {
    const edited = [{ path: 'index.html', content: TASKS_SEED[0].content.replace('placeholder="Owner"', 'placeholder="Owner"><select name="priority"></select><input name="x"') }];
    const { api, client } = setup({ files: () => [], editedFiles: edited });
    const res = await runEval({ client, origin, workspace: 'wsp_1', items: pick('edit-priority-en') });
    const seedCall = api.calls.find((c) => c.path === '/v1/publish');
    expect(seedCall?.body).toMatchObject({ workspace_id: 'wsp_1', visibility: 'private' });
    const chat = api.calls.find((c) => c.path.endsWith('/agent/chat'))!.body as { text: string };
    expect(chat.text).toMatch(/\(Page id: art_seed\d+\)$/);
    expect(res.runs[0].built).toBe(true);
    expect(res.runs[0].checks.find((c) => c.name === 'pattern:priority')?.pass).toBe(true);
    expect(res.created).toHaveLength(1);
  });

  it('fails an edit that left the page unchanged', async () => {
    const { client } = setup({ files: () => [], editedFiles: TASKS_SEED });
    const res = await runEval({ client, origin, workspace: 'w', items: pick('edit-priority-en') });
    expect(res.runs[0].built).toBe(false);
    expect(res.runs[0].error).toMatch(/unchanged/);
  });

  it('deletes every created page with cleanup, and only then', async () => {
    const keep = setup({ files: () => good(['tasks']) });
    const a = await runEval({ client: keep.client, origin, workspace: 'w', items: pick('crud-tasks-en') });
    expect(keep.api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(a.created).toHaveLength(1);

    const clean = setup({ files: () => good(['tasks']) });
    const b = await runEval({ client: clean.client, origin, workspace: 'w', items: pick('crud-tasks-en', 'edit-priority-en'), cleanup: true });
    const deleted = clean.api.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('/').pop());
    expect(deleted.sort()).toEqual([...b.created].sort());
    expect(b.created).toHaveLength(2);
  });
});

describe('deletePages', () => {
  it('keeps going past a failure and reports which ids failed', async () => {
    const client = createClient({ origin, token: SECRET, fetch: async (u) => (u.endsWith('/art_b') ? new Response('{}', { status: 404 }) : new Response('{"success":true}')) });
    const lines: string[] = [];
    expect(await deletePages(client, ['art_a', 'art_b', 'art_c'], (l) => lines.push(l))).toEqual(['art_b']);
    expect(lines.filter((l) => l.startsWith('deleted'))).toHaveLength(2);
    expect(lines.join('\n')).not.toContain(SECRET);
  });
});
