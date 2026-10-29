// @vitest-environment node
// edit_page with BUILD_AGENT=on, end to end on the real schema: the tool-using editor changes the
// page's files in pieces, the change is staged as a pending edit, the confirm card shows exactly
// what will go live, and confirming publishes a new version with the edited files.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { CrewProvider, ProviderTurnArgs } from '../../../src/crew/provider';
import type { Env } from '../../../src/types';

const h = vi.hoisted(() => ({
  steps: [] as Array<Array<[string, Record<string, unknown>]> | string>,
  calls: [] as Array<{ meter: unknown; tools: string[] }>,
  legacy: 0,
}));

const scripted: CrewProvider = {
  provider: 'vercel-gateway',
  model: 'test-model',
  async *streamTurn(args: ProviderTurnArgs) {
    h.calls.push({ meter: args.meter, tools: args.tools.map((t) => t.name) });
    const step = h.steps.shift() ?? 'done';
    if (typeof step === 'string') yield { type: 'text_delta', text: step };
    else for (const [i, [name, input]] of step.entries()) yield { type: 'tool_use', id: `c${h.calls.length}_${i}`, name, input };
    yield { type: 'message_stop', stopReason: typeof step === 'string' ? 'end_turn' : 'tool_use', usage: { inputTokens: 100, outputTokens: 20 } };
  },
};

vi.mock('../../../src/crew/provider', async (orig) => ({
  ...(await orig<typeof import('../../../src/crew/provider')>()),
  getCrewProvider: () => scripted,
}));
// The one-shot diff editor must not run when the piecewise one applies.
vi.mock('../../../src/data/agent/anthropic', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/anthropic')>()),
  streamChat: async function* () {
    h.legacy++;
    yield { type: 'content', content: 'Updated.\n```diff\n--- index.html\n-<h1>Old headline</h1>\n+<h1>Legacy</h1>\n```' };
    yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
  },
}));
vi.mock('../../../src/data/agent/ai-config', async (orig) => ({
  ...(await orig<typeof import('../../../src/data/agent/ai-config')>()),
  resolveAgentAiConfig: async () => ({ workspaceId: null, aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }, byo: false }),
  recordAgentUsage: async () => {},
}));

import { describeAction, describeActionRich, executeAction, type PendingAction } from '../../../src/chat-agent/actions';
import { editPageTool } from '../../../src/chat-agent/tools/actions';

const USER = 'usr_pieces';
const HTML = '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body>\n<h1>Old headline</h1>\n<p>Welcome</p>\n<img src="logo.png">\n</body></html>\n';
const CSS = 'h1 { color: black; }\n';
const on = { ...e, BUILD_AGENT: 'on' } as Env;

let n = 0;
/** A fresh page (html + css + an image) owned by USER. */
async function seedPage(type = 'html'): Promise<string> {
  const id = `art_pieces_${++n}`;
  const ver = `ver_pieces_${n}`;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, artifact_type) VALUES (?, 'Landing', ?, ?, 'private', ?)").bind(id, id, USER, type),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', '{}')").bind(ver, id),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'x')").bind(`ast_${n}_h`, ver, `${id}/index.html`, HTML.length),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'styles.css', ?, 'text/css', ?, 'x')").bind(`ast_${n}_c`, ver, `${id}/styles.css`, CSS.length),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'logo.png', ?, 'image/png', 4, 'x')").bind(`ast_${n}_p`, ver, `${id}/logo.png`),
  ]);
  await e.ARTIFACTS.put(`${id}/index.html`, HTML);
  await e.ARTIFACTS.put(`${id}/styles.css`, CSS);
  await e.ARTIFACTS.put(`${id}/logo.png`, new Uint8Array([137, 80, 78, 71]));
  return id;
}

const editCall = (path: string, old: string, next: string): [string, Record<string, unknown>] => ['edit_file', { path, old, new: next }];

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(USER, 'pieces@x.test').run();
});

beforeEach(() => {
  h.steps = [];
  h.calls = [];
  h.legacy = 0;
});

describe('edit_page in pieces (BUILD_AGENT=on)', () => {
  it('stages the edited files, shows the real change on the confirm card, and publishes it on confirm', async () => {
    const id = await seedPage();
    h.steps = [
      [editCall('index.html', '<h1>Old headline</h1>', '<h1>New headline</h1>')],
      [editCall('styles.css', 'color: black;', 'color: navy;'), editCall('index.html', '<p>Welcome</p>', '<p>Welcome back</p>')],
      [['check_page', {}]],
      [['propose_edit', { summary: 'New headline, navy title, warmer welcome.' }]],
    ];
    const progress: string[] = [];
    const out = await editPageTool.execute(
      { env: on, userId: USER, reply: { sendToolProgress: async (l: string) => { progress.push(l); } } as never },
      { artifact_id: id, instruction: 'new headline, navy title, warmer welcome' },
    ) as { __propose?: PendingAction; error?: string };

    expect(out.__propose, JSON.stringify(out)).toBeDefined();
    expect(h.legacy).toBe(0);
    expect(h.calls[0].meter).toMatchObject({ kind: 'artifact_ai_edit', source: id, userId: USER });
    expect(h.calls[0].tools).toContain('propose_edit');
    expect(progress).toEqual(expect.arrayContaining(['Refining index.html…', 'Refining styles.css…', 'Checking the code…']));

    const action = out.__propose as Extract<PendingAction, { kind: 'edit_publish' }>;
    expect(action.summary).toBe('New headline, navy title, warmer welcome.');
    expect(action.files.sort()).toEqual(['index.html', 'styles.css']);
    const card = describeActionRich(action).lines!.join('\n');
    expect(card).toContain('+ <h1>New headline</h1>');
    expect(card).toContain('- <h1>Old headline</h1>');
    expect(card).toContain('+ h1 { color: navy; }');
    expect(describeAction(action)).toContain('<p>Welcome back</p>');

    // Nothing is live until the user confirms.
    const before = await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(id).first<{ n: number }>();
    expect(before?.n).toBe(1);

    expect(await executeAction(e, USER, action)).toMatch(/Published/);
    const v2 = await e.DB.prepare('SELECT id FROM versions WHERE artifact_id = ? AND version_no = 2').bind(id).first<{ id: string }>();
    const assets = await e.DB.prepare('SELECT path, r2_key FROM assets WHERE version_id = ? ORDER BY path').bind(v2!.id).all<{ path: string; r2_key: string }>();
    expect(assets.results.map((a) => a.path)).toEqual(['index.html', 'logo.png', 'styles.css']);
    const text = async (path: string) => (await e.ARTIFACTS.get(assets.results.find((a) => a.path === path)!.r2_key))!.text();
    expect(await text('index.html')).toBe(HTML.replace('Old headline', 'New headline').replace('<p>Welcome</p>', '<p>Welcome back</p>'));
    expect(await text('styles.css')).toBe('h1 { color: navy; }\n');
  });

  it('the confirmation stays bound to what was staged', async () => {
    const id = await seedPage();
    h.steps = [[editCall('index.html', '<p>Welcome</p>', '<p>Hi</p>')], [['propose_edit', { summary: 'Shorter welcome.' }]]];
    const out = await editPageTool.execute({ env: on, userId: USER }, { artifact_id: id, instruction: 'shorter welcome' }) as { __propose: PendingAction };
    const conv = (out.__propose as { conversationId: string }).conversationId;
    await e.DB.prepare("UPDATE artifact_pending_edits SET new_content = '<script src=\"https://evil.test/x.js\"></script>' WHERE thread_id = ?").bind(conv).run();
    expect(await executeAction(e, USER, out.__propose)).toMatch(/changed/i);
    const versions = await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(id).first<{ n: number }>();
    expect(versions?.n).toBe(1);
  });

  it('relays an answer instead of proposing when the editor changed nothing', async () => {
    const id = await seedPage();
    h.steps = ['Which headline do you mean, the hero or the footer?'];
    const out = await editPageTool.execute({ env: on, userId: USER }, { artifact_id: id, instruction: 'change the headline' });
    expect(out).toEqual({ note: 'Which headline do you mean, the hero or the footer?' });
  });

  it('gives up without staging anything when its change keeps breaking the page', async () => {
    const id = await seedPage();
    h.steps = [[editCall('index.html', '<img src="logo.png">', '<img src="logo.png"><script src="gone.js"></script>')], ...Array.from({ length: 6 }, () => [['propose_edit', { summary: 'x' }]] as Array<[string, Record<string, unknown>]>)];
    const out = await editPageTool.execute({ env: on, userId: USER }, { artifact_id: id, instruction: 'add a script' }) as { error?: string };
    expect(out.error).toMatch(/without breaking the page/);
    const staged = await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_pending_edits WHERE artifact_id = ?').bind(id).first<{ n: number }>();
    expect(staged?.n).toBe(0);
  });

  it('keeps the one-shot editor with the flag off, and for pages it does not cover', async () => {
    const id = await seedPage();
    const off = await editPageTool.execute({ env: e, userId: USER }, { artifact_id: id, instruction: 'x' }) as { __propose?: PendingAction };
    expect(off.__propose).toBeDefined();
    expect(h.legacy).toBe(1);
    expect(h.calls).toHaveLength(0);

    const md = await seedPage('markdown');
    await editPageTool.execute({ env: on, userId: USER }, { artifact_id: md, instruction: 'x' });
    expect(h.legacy).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
