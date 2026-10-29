// The build agent loop against a scripted provider: write → check fails → edit → check passes → publish,
// the give-up path, tool errors fed back, and the limits.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const alertOps = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../../src/support/alert', () => ({ alertOps }));
vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), logError: vi.fn() }));

import { runBuildAgent, trimTranscript, type BuildAgentResult, type TestReport } from '../../../src/build-agent/agent';
import type { NeutralTurn } from '../../../src/crew/provider';
import { GOOD_HTML, deps, lastToolResults, okPublish, scriptedProvider, type Step } from './helpers';

const GOOD_CSS = 'body{margin:0}';
const GOOD_JS = 'document.title = "ok";';
const BAD_JS = 'document.title = ;';

const write = (path: string, content: string): [string, Record<string, unknown>] => ['write_file', { path, content }];
const writeAll: Step = { calls: [write('index.html', GOOD_HTML), write('styles.css', GOOD_CSS), write('app.js', GOOD_JS)] };
const check: Step = { calls: [['check_page', {}]] };
const publish: Step = { calls: [['publish_page', {}]] };

const input = { prompt: 'a landing page' };

beforeEach(() => alertOps.mockClear());

function ok(r: BuildAgentResult) {
  expect(r.ok).toBe(true);
  return r as Extract<BuildAgentResult, { ok: true }>;
}

describe('runBuildAgent', () => {
  it('writes files, fails the check, edits, passes the check and publishes', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [write('index.html', GOOD_HTML), write('styles.css', GOOD_CSS), write('app.js', BAD_JS)] },
      check,
      { calls: [['edit_file', { path: 'app.js', old: 'title = ;', new: 'title = "ok";' }]] },
      check,
      publish,
    ]);
    const publishFn = okPublish();
    const labels: string[] = [];
    const r = ok(await runBuildAgent(deps(provider, { publish: publishFn, onProgress: (l) => labels.push(l) }), input));

    expect(r.page.slug).toBe('my-page');
    expect(r.tested).toBe(false);
    expect(publishFn).toHaveBeenCalledTimes(1);
    const published = (publishFn as unknown as { mock: { calls: Array<[Array<{ path: string; content: string }>]> } }).mock.calls[0][0];
    expect(published.map((f) => f.path).sort()).toEqual(['app.js', 'index.html', 'styles.css']);
    expect(published.find((f) => f.path === 'app.js')?.content).toBe('document.title = "ok";');
    // The model was told what was wrong, where, and that the fix is an edit.
    const [firstCheck] = lastToolResults(calls, 1);
    expect(firstCheck).toMatch(/1 error to fix/);
    expect(firstCheck).toContain('JavaScript syntax error');
    expect(firstCheck).toContain('app.js:1');
    expect(lastToolResults(calls, 3)[0]).toBe('No errors.');
    expect(labels).toEqual(expect.arrayContaining(['Planning your page…', 'Writing the page structure…', 'Writing styles…', 'Writing the page logic…', 'Checking the code…', 'Fixing 1 error…', 'Refining app.js…', 'Publishing it…']));
  });

  it('streams progress in Spanish', async () => {
    const { provider } = scriptedProvider([writeAll, publish]);
    const labels: string[] = [];
    ok(await runBuildAgent(deps(provider, { locale: 'es', onProgress: (l) => labels.push(l) }), input));
    expect(labels).toEqual(expect.arrayContaining(['Escribiendo estilos…', 'Publicándola…']));
  });

  it('completes a page bigger than one turn by appending, and the file tools never echo the file back', async () => {
    const big = 'x'.repeat(5000);
    const part1 = GOOD_HTML.replace('</body></html>', `<!-- ${big} `);
    const part2 = ` ${big} --></body></html>`;
    const { provider, calls } = scriptedProvider([
      { calls: [['write_file', { path: 'index.html', content: part1 }]], tokens: 11_900 },
      { calls: [['append_file', { path: 'index.html', content: part2 }]] },
      { calls: [write('styles.css', GOOD_CSS), write('app.js', GOOD_JS)] },
      publish,
    ]);
    const publishFn = okPublish();
    ok(await runBuildAgent(deps(provider, { publish: publishFn }), input));
    const files = (publishFn as unknown as { mock: { calls: Array<[Array<{ path: string; content: string }>]> } }).mock.calls[0][0];
    expect(files.find((f) => f.path === 'index.html')?.content).toBe(part1 + part2);
    for (let i = 0; i < 3; i++) for (const res of lastToolResults(calls, i)) expect(res.length).toBeLessThan(120);
    expect(calls[0].maxTokens).toBeLessThanOrEqual(16_000);
  });

  it('feeds a cut-off tool call back and asks for smaller pieces', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [['write_file', { __invalid_json: '{"path":"index.html","content":"<!DOCTYPE' }]], stop: 'max_tokens' },
      writeAll,
      publish,
    ]);
    ok(await runBuildAgent(deps(provider), input));
    const [msg] = lastToolResults(calls, 0);
    expect(msg).toContain('cut off');
    expect(msg).toContain('append_file');
  });

  it('asks the model to use tools when a reply is cut off with no tool call', async () => {
    const { provider, calls } = scriptedProvider([{ text: '<!DOCTYPE html>…', stop: 'max_tokens' }, writeAll, publish]);
    ok(await runBuildAgent(deps(provider), input));
    const last = calls[1].transcript.at(-1);
    expect(last).toMatchObject({ role: 'user' });
    expect((last as { text: string }).text).toContain('cut off');
  });

  it('feeds tool errors such as EDIT_NO_MATCH and EDIT_AMBIGUOUS back to the model', async () => {
    const { provider, calls } = scriptedProvider([
      writeAll,
      { calls: [['edit_file', { path: 'index.html', old: '<h2>Nope</h2>', new: '<h2>x</h2>' }]] },
      { calls: [['edit_file', { path: 'index.html', old: '<', new: '&lt;' }]] },
      { calls: [['read_file', { path: 'missing.js' }], ['edit_file', { path: 'app.js', old: 'ok', new: 'fine' }]] },
      publish,
    ]);
    ok(await runBuildAgent(deps(provider), input));
    expect(lastToolResults(calls, 1)[0]).toMatch(/^ERROR EDIT_NO_MATCH/);
    expect(lastToolResults(calls, 2)[0]).toMatch(/^ERROR EDIT_AMBIGUOUS/);
    const [readErr, edit] = lastToolResults(calls, 3);
    expect(readErr).toMatch(/FILE_NOT_FOUND/);
    expect(edit).toBe('ok');
  });

  it('reads a numbered slice of a file on request', async () => {
    const { provider, calls } = scriptedProvider([writeAll, { calls: [['read_file', { path: 'app.js' }]] }, publish]);
    ok(await runBuildAgent(deps(provider), input));
    expect(lastToolResults(calls, 1)[0]).toBe(`1\t${GOOD_JS}\n`);
  });

  it('refuses to publish a page with errors and does not call publish', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [write('index.html', GOOD_HTML)] },
      publish, // app.js and styles.css are missing
      writeAll,
      publish,
    ]);
    const publishFn = okPublish();
    ok(await runBuildAgent(deps(provider, { publish: publishFn }), input));
    expect(lastToolResults(calls, 1)[0]).toMatch(/^NOT PUBLISHED: 2 errors/);
    expect(publishFn).toHaveBeenCalledTimes(1);
  });

  it('gives up after bounded fix rounds: nothing published, operator alerted', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [write('index.html', GOOD_HTML), write('styles.css', GOOD_CSS), write('app.js', BAD_JS)] },
      check,
    ]);
    const publishFn = okPublish();
    const r = await runBuildAgent(deps(provider, { publish: publishFn, limits: { checkRounds: 3 } }), input);
    expect(r).toMatchObject({ ok: false, reason: 'check_failed' });
    expect(publishFn).not.toHaveBeenCalled();
    // 1 write turn + 4 failing checks (the 4th exceeds 3 rounds)
    expect(calls).toHaveLength(5);
    expect(alertOps).toHaveBeenCalledTimes(1);
    const [, title, lines] = alertOps.mock.calls[0] as unknown as [unknown, string, string[]];
    expect(title).toContain('check_failed');
    expect(lines.join('\n')).toContain('a landing page');
  });

  it('stops at the model-call cap', async () => {
    const { provider, calls } = scriptedProvider([{ calls: [['list_files', {}]] }]);
    const r = await runBuildAgent(deps(provider, { limits: { maxTurns: 4 } }), input);
    expect(r).toMatchObject({ ok: false, reason: 'turns' });
    expect(calls).toHaveLength(4);
    expect(alertOps).toHaveBeenCalledTimes(1);
  });

  it('stops at the output-token budget', async () => {
    const { provider } = scriptedProvider([{ calls: [['list_files', {}]], tokens: 9_000 }]);
    const r = await runBuildAgent(deps(provider, { limits: { maxOutputTokens: 20_000 } }), input);
    expect(r).toMatchObject({ ok: false, reason: 'tokens' });
  });

  it('stops at the wall-clock limit', async () => {
    const { provider } = scriptedProvider([{ calls: [['list_files', {}]] }]);
    const now = vi.spyOn(Date, 'now');
    let t = 0;
    now.mockImplementation(() => (t += 40_000));
    const r = await runBuildAgent(deps(provider, { limits: { wallMs: 100_000 } }), input);
    now.mockRestore();
    expect(r).toMatchObject({ ok: false, reason: 'time' });
  });

  it('nudges a model that stops without publishing, then gives up', async () => {
    const { provider, calls } = scriptedProvider([{ text: 'All done!' }]);
    const r = await runBuildAgent(deps(provider, { limits: { nudges: 2 } }), input);
    expect(r).toMatchObject({ ok: false, reason: 'no_publish' });
    expect(calls).toHaveLength(3);
    expect((calls[1].transcript.at(-1) as { text: string }).text).toContain('not published');
  });

  it('reports a model error to the operator, but a spent workspace budget is not a failure of ours', async () => {
    const down = scriptedProvider([{ error: { type: 'error', error: 'AI is down', retryable: true } }]);
    expect(await runBuildAgent(deps(down.provider), input)).toMatchObject({ ok: false, reason: 'provider_error' });
    expect(alertOps).toHaveBeenCalledTimes(1);
    alertOps.mockClear();
    const spent = scriptedProvider([{ error: { type: 'error', error: 'Monthly AI budget reached', code: 'workspace_budget' } }]);
    expect(await runBuildAgent(deps(spent.provider), input)).toMatchObject({ ok: false, reason: 'budget', detail: 'Monthly AI budget reached' });
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('returns a publish failure (e.g. storage limit) as is, without alerting', async () => {
    const { provider } = scriptedProvider([writeAll, publish]);
    const publishFn = vi.fn(async () => ({ ok: false as const, error: 'Storage full', code: 'STORAGE_LIMIT_EXCEEDED' }));
    const r = await runBuildAgent(deps(provider, { publish: publishFn }), input);
    expect(r).toMatchObject({ ok: false, reason: 'publish_failed', detail: 'Storage full', code: 'STORAGE_LIMIT_EXCEEDED' });
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('starts from an existing page when one is given', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [['edit_file', { path: 'index.html', old: '<h1>Hi</h1>', new: '<h1>Hello</h1>' }], write('styles.css', GOOD_CSS), write('app.js', GOOD_JS)] },
      publish,
    ]);
    const publishFn = okPublish();
    ok(await runBuildAgent(deps(provider, { publish: publishFn }), { prompt: 'say hello', previousFiles: [{ path: 'index.html', content: GOOD_HTML }] }));
    expect((calls[0].transcript[0] as { text: string }).text).toContain('index.html');
    const files = (publishFn as unknown as { mock: { calls: Array<[Array<{ path: string; content: string }>]> } }).mock.calls[0][0];
    expect(files.find((f) => f.path === 'index.html')?.content).toContain('<h1>Hello</h1>');
  });
});

describe('testing the published page', () => {
  const report = (status: TestReport['status'], errors = 0, text = 'the page'): TestReport => ({ status, errors, text });

  it('publishes a private draft, tests it, fixes what failed, republishes, then makes it live', async () => {
    const { provider, calls } = scriptedProvider([
      writeAll,
      publish,
      { calls: [['edit_file', { path: 'app.js', old: 'ok', new: 'fine' }]] },
      publish,
    ]);
    const publishFn = okPublish();
    const verify = vi.fn()
      .mockResolvedValueOnce(report('fail', 2, 'Errors:\n1. ReferenceError: foo is not defined'))
      .mockResolvedValueOnce(report('pass'));
    const labels: string[] = [];
    const r = ok(await runBuildAgent(deps(provider, { publish: publishFn, verify, locale: 'es', onProgress: (l) => labels.push(l) }), input));

    expect(r.tested).toBe(true);
    const opts = (publishFn as unknown as { mock: { calls: Array<[unknown, { draft: boolean; slug?: string }]> } }).mock.calls.map((c) => c[1]);
    expect(opts).toEqual([
      { draft: true, slug: undefined },
      { draft: true, slug: 'my-page' },
      { draft: false, slug: 'my-page' },
    ]);
    expect(lastToolResults(calls, 1)[0]).toMatch(/PRIVATE DRAFT.*2 errors[\s\S]*ReferenceError/);
    expect(labels).toEqual(expect.arrayContaining(['Probando la página…', 'Corrigiendo 2 problemas que aparecieron al probar…', 'Dejándola en vivo…']));
  });

  it('gives up after 2 failed fix rounds: the draft stays private, the operator is told', async () => {
    const { provider } = scriptedProvider([writeAll, publish, { calls: [['edit_file', { path: 'app.js', old: 'ok', new: 'fine' }]] }, publish, { calls: [['edit_file', { path: 'app.js', old: 'fine', new: 'ok' }]] }, publish]);
    const publishFn = okPublish();
    const verify = vi.fn(async () => report('fail', 1, 'still broken'));
    const r = await runBuildAgent(deps(provider, { publish: publishFn, verify }), input);
    expect(r).toMatchObject({ ok: false, reason: 'verify_failed', draft: { slug: 'my-page' } });
    expect(verify).toHaveBeenCalledTimes(3);
    // Never published for real.
    for (const c of (publishFn as unknown as { mock: { calls: Array<[unknown, { draft: boolean }]> } }).mock.calls) expect(c[1].draft).toBe(true);
    expect(alertOps).toHaveBeenCalledTimes(1);
  });

  it('warnings pass; an unusable test result (no browser, rate limit) does not block', async () => {
    for (const result of [report('warn', 0), null, report('partial')]) {
      const { provider } = scriptedProvider([writeAll, publish]);
      const r = ok(await runBuildAgent(deps(provider, { verify: vi.fn(async () => result) }), input));
      expect(r.tested).toBe(result?.status === 'warn');
    }
  });

  it('does not test at all without a verify (no browser binding)', async () => {
    const { provider } = scriptedProvider([writeAll, publish]);
    const publishFn = okPublish();
    ok(await runBuildAgent(deps(provider, { publish: publishFn }), input));
    expect((publishFn as unknown as { mock: { calls: Array<[unknown, { draft: boolean }]> } }).mock.calls[0][1].draft).toBe(false);
  });
});

describe('transcript trimming (routes without server-side context editing)', () => {
  const turns = (n: number): NeutralTurn[] => {
    const out: NeutralTurn[] = [{ role: 'user', text: 'build it' }];
    for (let i = 0; i < n; i++) {
      out.push({ role: 'assistant', text: '', toolCalls: [{ id: `c${i}`, name: 'write_file', input: { path: `f${i}.js`, content: 'y'.repeat(20_000) } }] });
      out.push({ role: 'tool', results: [{ id: `c${i}`, content: `created f${i}.js (20000 bytes) ${'.'.repeat(300)}` }] });
    }
    return out;
  };

  it('leaves a small transcript alone', () => {
    const small = turns(2).map((t) => (t.role === 'assistant' ? { ...t, toolCalls: [{ ...t.toolCalls[0], input: { path: 'a', content: 'z' } }] } : t));
    expect(trimTranscript(small)).toBe(small);
  });

  it('stubs old file contents and results, keeps the first message and the newest turns', () => {
    const t = turns(12);
    const out = trimTranscript(t);
    expect(out[0]).toEqual(t[0]);
    const first = out[1] as Extract<NeutralTurn, { role: 'assistant' }>;
    expect(first.toolCalls[0].input.content).toMatch(/^\[20000 chars written/);
    expect((out[2] as Extract<NeutralTurn, { role: 'tool' }>).results[0].content).toMatch(/\[trimmed\]$/);
    expect(out.at(-2)).toEqual(t.at(-2));
    expect(out.at(-1)).toEqual(t.at(-1));
  });
});
