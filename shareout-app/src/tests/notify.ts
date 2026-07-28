// Artifact Tests — owner alert on a failing/errored run. Best-effort Telegram DM to
// the artifact owner (if they've linked a chat). Never throws into the runner; the
// persisted run + home badge are the durable signal, this is the nudge.

import type { Env } from '../types';
import { getLinkedChatId } from '../telegram/linking';
import { sendMessage } from '../telegram/client';
import type { TestRun } from './types';
import { getPlatformOrigin } from '../config/origins';

export async function alertOwnerOnFailure(env: Env, artifactId: string, run: TestRun): Promise<void> {
  try {
    if (run.status === 'passed' || run.status === 'running') return;
    const row = await env.DB.prepare(
      'SELECT owner_id, name FROM artifacts WHERE id = ?',
    ).bind(artifactId).first<{ owner_id: string | null; name: string | null }>();
    if (!row?.owner_id) return;
    const chatId = await getLinkedChatId(env, row.owner_id);
    if (chatId === null) return;

    const bad = run.results.filter((r) => r.status !== 'passed');
    const lines = [
      `${run.status === 'errored' ? '⚠️ Tests could not run' : '🔴 Tests failed'} · ${row.name || 'artifact'}`,
      ...bad.slice(0, 5).map((r) => `• ${r.name}: ${r.message || r.status}`),
      `${getPlatformOrigin(env)}/app`,
    ];
    await sendMessage(env, chatId, lines.join('\n'));
  } catch {
    // alerting must never throw into the caller
  }
}
