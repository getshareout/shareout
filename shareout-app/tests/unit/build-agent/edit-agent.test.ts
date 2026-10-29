// The assistant's page editor against a scripted provider: a big change made in pieces, a check that
// blocks only what the change broke, answers instead of edits, and the give-up paths.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }), logError: vi.fn() }));

import { runEditAgent, type EditAgentDeps, type EditAgentInput, type EditAgentResult } from '../../../src/build-agent/edit-agent';
import { env, lastToolResults, meter, scriptedProvider, type Step } from './helpers';
import type { CrewProvider } from '../../../src/crew/provider';

const SECTIONS = Array.from({ length: 40 }, (_, i) => `<section id="s${i}"><h2>Section ${i}</h2><p>${'Body text. '.repeat(40)}</p></section>`).join('\n');
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body>\n${SECTIONS}\n<img src="logo.png"><script src="app.js"></script></body></html>`;
const CSS = 'body{margin:0}';
const JS = 'document.title = "ok";';

const page = (extra: Partial<EditAgentInput> = {}): EditAgentInput => ({
  instruction: 'retitle every section',
  entrypoint: 'index.html',
  files: [
    { path: 'index.html', content: HTML, mime: 'text/html' },
    { path: 'styles.css', content: CSS, mime: 'text/css' },
    { path: 'app.js', content: JS, mime: 'application/javascript' },
  ],
  readOnly: [{ path: 'logo.png', mime: 'image/png' }],
  ...extra,
});

const deps = (provider: CrewProvider, extra: Partial<EditAgentDeps> = {}): EditAgentDeps => ({
  env, provider, meter: { ...meter, kind: 'artifact_ai_edit' }, locale: 'en', isPublic: false, ...extra,
});

const edit = (path: string, old: string, next: string): [string, Record<string, unknown>] => ['edit_file', { path, old, new: next }];
const propose = (summary = 'Retitled the sections.'): Step => ({ calls: [['propose_edit', { summary }]] });

function ok(r: EditAgentResult) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as Extract<EditAgentResult, { ok: true }>;
}

describe('runEditAgent', () => {
  it('makes a change bigger than one reply in many small edits, checks it, and hands back only the changed files', async () => {
    // 40 retitles, 10 per call: far more than one diff completion would hold, each call small.
    const batches: Step[] = [0, 1, 2, 3].map((b) => ({
      calls: Array.from({ length: 10 }, (_, k) => edit('index.html', `<h2>Section ${b * 10 + k}</h2>`, `<h2>Part ${b * 10 + k + 1}</h2>`)),
    }));
    const { provider, calls } = scriptedProvider([
      { calls: [['list_files', {}], ['read_file', { path: 'index.html', start_line: 1, end_line: 5 }]] },
      ...batches,
      { calls: [['check_page', {}]] },
      propose(),
    ]);
    const labels: string[] = [];
    const r = ok(await runEditAgent(deps(provider, { onProgress: (l) => labels.push(l) }), page()));

    expect(r.summary).toBe('Retitled the sections.');
    expect(r.changed.map((c) => c.path)).toEqual(['index.html']);
    const after = r.changed[0].after;
    expect(after).toContain('<h2>Part 1</h2>');
    expect(after).toContain('<h2>Part 40</h2>');
    expect(after).not.toContain('<h2>Section');
    expect(r.changed[0].before).toBe(HTML);
    expect(r.usage.outputTokens).toBe(50 * calls.length);
    // The listing marks the image read-only; every edit was acknowledged, never echoed back.
    const [listing] = lastToolResults(calls, 0);
    expect(listing).toContain('logo.png  (image/png, read-only)');
    for (let i = 1; i <= 4; i++) for (const res of lastToolResults(calls, i)) expect(res).toBe('ok');
    // The image the page already references does not count as a missing file.
    expect(lastToolResults(calls, 5)[0]).toBe('Your change caused no errors.');
    expect(labels).toEqual(expect.arrayContaining(['Refining index.html…', 'Checking the code…']));
    // Only the edit tools are offered: no publishing, no deleting.
    expect(calls[0].tools.map((t) => t.name)).toEqual(['write_file', 'append_file', 'edit_file', 'read_file', 'list_files', 'check_page', 'propose_edit']);
  });

  it('refuses to propose a change that breaks the page, then accepts it once fixed', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [edit('app.js', '"ok";', '"ok"; if (')] },
      propose(),
      { calls: [edit('app.js', 'if (', '')] },
      propose(),
    ]);
    const r = ok(await runEditAgent(deps(provider), page()));
    expect(lastToolResults(calls, 1)[0]).toMatch(/^NOT PROPOSED: 1 error your change caused[\s\S]*JavaScript syntax error/);
    expect(r.changed.map((c) => c.path)).toEqual(['app.js']);
  });

  it('does not block on problems the page already had', async () => {
    const broken = HTML.replace('<script src="app.js">', '<script src="missing.js"></script><script src="app.js">');
    const { provider, calls } = scriptedProvider([
      { calls: [edit('index.html', '<h2>Section 0</h2>', '<h2>Intro</h2>')] },
      { calls: [['check_page', {}]] },
      propose('Renamed the first section.'),
    ]);
    const r = ok(await runEditAgent(deps(provider), page({ files: [{ path: 'index.html', content: broken, mime: 'text/html' }, { path: 'app.js', content: JS, mime: 'application/javascript' }, { path: 'styles.css', content: CSS, mime: 'text/css' }] })));
    const [checked] = lastToolResults(calls, 1);
    expect(checked).toMatch(/^Your change caused no errors\.\nAlready on the page before your change[\s\S]*missing\.js/);
    expect(r.changed).toHaveLength(1);
  });

  it('checks a page whose main file is not index.html', async () => {
    const { provider, calls } = scriptedProvider([{ calls: [edit('report.html', '<h2>Section 1</h2>', '<h2>One</h2>')] }, { calls: [['check_page', {}]] }, propose()]);
    const r = ok(await runEditAgent(deps(provider), page({
      entrypoint: 'report.html',
      files: [{ path: 'report.html', content: HTML, mime: 'text/html' }, { path: 'styles.css', content: CSS, mime: 'text/css' }, { path: 'app.js', content: JS, mime: 'application/javascript' }],
    })));
    expect(lastToolResults(calls, 1)[0]).toBe('Your change caused no errors.');
    expect(r.changed[0].path).toBe('report.html');
    expect(calls[0].system).toContain('main file is report.html');
  });

  it('keeps to the existing text files: no new files, no binary edits', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [['write_file', { path: 'extra.js', content: 'x()' }], edit('logo.png', 'a', 'b'), ['read_file', { path: 'logo.png' }]] },
      { text: 'Done.' },
    ]);
    const r = ok(await runEditAgent(deps(provider), page()));
    const [created, binary, read] = lastToolResults(calls, 0);
    expect(created).toMatch(/^ERROR NO_NEW_FILES/);
    expect(binary).toMatch(/^ERROR NOT_EDITABLE/);
    expect(read).toMatch(/^ERROR NOT_EDITABLE/);
    // Nothing changed, so the reply is the answer.
    expect(r).toMatchObject({ changed: [], summary: 'Done.' });
  });

  it('answers without editing when the request needs no change', async () => {
    const { provider } = scriptedProvider([{ text: 'Which section do you mean?' }]);
    expect(await runEditAgent(deps(provider), page())).toMatchObject({ ok: true, changed: [], summary: 'Which section do you mean?' });
  });

  it('asks again in smaller pieces when a reply is cut off', async () => {
    const { provider, calls } = scriptedProvider([
      { calls: [['edit_file', { __invalid_json: '{"path":"index.html","old":"<h2>' }]], stop: 'max_tokens' },
      { calls: [edit('index.html', '<h2>Section 3</h2>', '<h2>Three</h2>')] },
      propose(),
    ]);
    ok(await runEditAgent(deps(provider), page()));
    expect(lastToolResults(calls, 0)[0]).toMatch(/cut off[\s\S]*smaller pieces[\s\S]*length limit/);
  });

  describe('gives up, with nothing proposed', () => {
    it('when its change keeps failing the check', async () => {
      const { provider, calls } = scriptedProvider([{ calls: [edit('app.js', '"ok";', '"ok"; if (')] }, propose()]);
      const r = await runEditAgent(deps(provider, { limits: { checkRounds: 2 } }), page());
      expect(r).toMatchObject({ ok: false, reason: 'check_failed' });
      expect(calls).toHaveLength(4); // 1 edit + 3 refused proposals (the 3rd exceeds 2 rounds)
    });

    it('when it stops with changes it never proposes', async () => {
      const { provider, calls } = scriptedProvider([{ calls: [edit('app.js', 'ok', 'fine')] }, { text: 'Changed it.' }]);
      const r = await runEditAgent(deps(provider, { limits: { nudges: 1 } }), page());
      expect(r).toMatchObject({ ok: false, reason: 'no_proposal' });
      expect((calls[2].transcript.at(-1) as { text: string }).text).toContain('did not propose');
    });

    it('at the call cap', async () => {
      const { provider } = scriptedProvider([{ calls: [['list_files', {}]] }]);
      expect(await runEditAgent(deps(provider, { limits: { maxTurns: 3 } }), page())).toMatchObject({ ok: false, reason: 'turns' });
    });

    it('on a model error, telling a spent budget apart', async () => {
      const down = scriptedProvider([{ error: { type: 'error', error: 'AI is down', retryable: true } }]);
      expect(await runEditAgent(deps(down.provider), page())).toMatchObject({ ok: false, reason: 'provider_error' });
      const spent = scriptedProvider([{ error: { type: 'error', error: 'Monthly AI budget reached', code: 'workspace_budget' } }]);
      expect(await runEditAgent(deps(spent.provider), page())).toMatchObject({ ok: false, reason: 'budget', detail: 'Monthly AI budget reached' });
    });
  });
});
