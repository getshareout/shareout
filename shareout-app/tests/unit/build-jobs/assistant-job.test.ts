// The assistant's confirmed build with BUILD_JOBS bound: confirmAgentAction starts a job keyed by
// the confirmation token. Real route code, BuildJobs object, KV pending record, D1 threads and
// notifications; only the build itself (executeBuildArtifact) is a stub.
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';
import type { BuildEvent } from '../../../src/build-jobs/types';

const h = vi.hoisted(() => ({ exec: vi.fn(), gate: { open: true } }));
vi.mock('../../../src/chat-agent/actions', async (orig) => ({
  ...(await orig<object>()),
  executeBuildArtifact: h.exec,
}));

import { confirmAgentAction } from '../../../src/router/api/web-agent-shared';
import { D1ConversationStore } from '../../../src/chat-agent/store/d1-store';
import { WebThreadStore } from '../../../src/chat-agent/store/d1-threads';
import { applyMigrations } from '../helpers/migrated-db';
import * as runners from '../../../src/build-jobs/runners';
import { useBuildRunners } from '../../../src/build-jobs/do';

// Loaded here: a Durable Object in the test pool cannot load modules itself.
useBuildRunners(runners);

const testEnv = env as unknown as Env;
const SCOPE = 'personal';
const parse = (text: string): BuildEvent[] => text.split('\n\n').filter(Boolean).map((r) => JSON.parse(r.replace(/^data: /, '')) as BuildEvent);

async function firstEventThenClose(res: Response): Promise<BuildEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (!buf.includes('\n\n')) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return parse(buf.slice(0, buf.indexOf('\n\n') + 2))[0];
}

/** A thread with a pending build_artifact confirmation in it, as the assistant leaves it. */
async function proposeBuild(userId: string, name: string): Promise<{ token: string; threadId: string }> {
  const { id: threadId } = await new WebThreadStore(testEnv, SCOPE, userId).create('build me a roster page');
  const token = `appr_${userId}_${name.length}`;
  await new D1ConversationStore(testEnv, SCOPE, userId, threadId).putPending(token, { action: { kind: 'build_artifact', name, prompt: 'a roster page' } });
  return { token, threadId };
}
const lastAssistantMessage = async (threadId: string) =>
  (await testEnv.DB.prepare("SELECT content FROM agent_messages WHERE thread_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1").bind(threadId).first<{ content: string }>())?.content;

const user = (id: string) => ({ id, email: `${id}@studio.test`, username: null }) as AuthUser;

beforeAll(async () => {
  await applyMigrations();
  await testEnv.DB.batch(['usr_aj_watch', 'usr_aj_gone', 'usr_aj_busy'].map((id) =>
    testEnv.DB.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)').bind(id, `${id}@studio.test`, id)));
});

beforeEach(() => {
  h.gate = { open: true };
  h.exec.mockReset().mockImplementation(async (_env: Env, _userId: string, a: { name: string }, onProgress?: (l: string) => void) => {
    onProgress?.('Designing the page…');
    while (!h.gate.open) await new Promise((r) => setTimeout(r, 5));
    onProgress?.('Publishing…');
    return { ok: true, text: 'Published: https://shareout.test/a/roster/', url: 'https://shareout.test/a/roster/', slug: 'roster', artifactId: 'art_aj', name: a.name };
  });
});

describe('assistant build confirm as a durable job', () => {
  it('streams job → build_step → build_done → done, and appends the result to the thread', async () => {
    const { token, threadId } = await proposeBuild('usr_aj_watch', 'Roster');
    const res = await confirmAgentAction(testEnv, SCOPE, user('usr_aj_watch'), token);
    const reading = res.text();
    await runDurableObjectAlarm(testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName('usr_aj_watch')));
    const evs = parse(await reading);
    expect(evs.map((e) => e.type)).toEqual(['job', 'build_step', 'build_step', 'build_done', 'done']);
    expect(evs[3]).toMatchObject({ ok: true, slug: 'roster', artifactId: 'art_aj', name: 'Roster' });
    expect(await lastAssistantMessage(threadId)).toBe('Published: https://shareout.test/a/roster/\nhttps://shareout.test/a/roster/');
    expect(h.exec).toHaveBeenCalledTimes(1);
  });

  it('a second click on the same confirmation rejoins the build; closing both still finishes it and lands it in the thread', async () => {
    h.gate = { open: false };
    const open = () => { h.gate.open = true; };
    const { token, threadId } = await proposeBuild('usr_aj_gone', 'Roster ES');
    const a = await firstEventThenClose(await confirmAgentAction(testEnv, SCOPE, user('usr_aj_gone'), token));
    // The pending record is gone after the first click: the token now names the job.
    const b = await firstEventThenClose(await confirmAgentAction(testEnv, SCOPE, user('usr_aj_gone'), token));
    expect(b).toMatchObject({ type: 'job', id: a.id });

    const stub = testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName('usr_aj_gone'));
    const alarm = runDurableObjectAlarm(stub);
    open();
    await alarm;
    for (let i = 0; i < 200 && !(await lastAssistantMessage(threadId)); i++) await new Promise((r) => setTimeout(r, 5));
    expect(await lastAssistantMessage(threadId)).toContain('https://shareout.test/a/roster/');
    expect(h.exec).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 200; i++) {
      if (await testEnv.DB.prepare("SELECT 1 FROM notifications WHERE recipient_id = 'usr_aj_gone' AND kind = 'page_build'").first()) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const row = await testEnv.DB.prepare("SELECT payload FROM notifications WHERE recipient_id = 'usr_aj_gone' AND kind = 'page_build'").first<{ payload: string }>();
    expect(JSON.parse(row!.payload)).toMatchObject({ ok: true, artifact_name: 'Roster ES', slug: 'roster' });
  });

  it('a different build while one runs is answered in the card, not started', async () => {
    h.gate = { open: false };
    const open = () => { h.gate.open = true; };
    const first = await proposeBuild('usr_aj_busy', 'First');
    const second = await proposeBuild('usr_aj_busy', 'Second one');
    const a = await firstEventThenClose(await confirmAgentAction(testEnv, SCOPE, user('usr_aj_busy'), first.token));
    const evs = parse(await (await confirmAgentAction(testEnv, SCOPE, user('usr_aj_busy'), second.token)).text());
    expect(evs).toEqual([
      { type: 'build_done', ok: false, text: expect.stringMatching(/^You already have a page building/), name: 'Second one' },
      { type: 'done' },
    ]);
    expect(a.type).toBe('job');
    open();
    // The first build ends inside this case, not as a stray alarm in the next file.
    const stub = testEnv.BUILD_JOBS!.get(testEnv.BUILD_JOBS!.idFromName('usr_aj_busy'));
    await runDurableObjectAlarm(stub);
    for (let i = 0; i < 400; i++) {
      const v = await (await stub.fetch(`https://build-jobs/job?id=${a.id}`)).json<{ status: string }>();
      if (v.status !== 'queued' && v.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
  });
});
