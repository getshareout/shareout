/**
 * Shared web-chat plumbing for the home + workspace assistants. Both surfaces
 * differ only in scope key, snapshot, and extra tools — everything else (SSE
 * turn, dual-mode confirm with streaming builds, thread CRUD) lives here so the
 * two routers stay thin and identical in behavior.
 */
import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import type { WorkspaceSelection } from '../../chat-platforms/types';
import type { AccountTool } from '../../chat-agent/tools/index';
import { runAgentTurn } from '../../chat-agent/agent-loop';
import { executeAction, executeBuildArtifact, describeAction, describeActionRich } from '../../chat-agent/actions';
import { D1ConversationStore } from '../../chat-agent/store/d1-store';
import { WebThreadStore } from '../../chat-agent/store/d1-threads';
import { createWebReplyPort, agentMediaKey, type WebAgentEvent } from '../../chat-platforms/web/reply-port';
import { generateId } from '../../crypto-utils';
import { jsonWithApiErrors } from '../../http/api-error';
import { localeForRecipient, type Locale } from '../../i18n/locale';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';

const HISTORY_LIMIT = 20;
const THREAD_PAGE = 50;

type ControlEvent = WebAgentEvent | { type: 'done' } | { type: 'error'; message: string };

export function jsonResp(body: unknown, status = 200): Response {
  return jsonWithApiErrors(body, status);
}

function sseResp(start: (send: (ev: ControlEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: ControlEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        await start(send);
      } catch {
        send({ type: 'error', message: 'Something went wrong. Try again?' });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

export interface ChatTurnConfig {
  scopeKey: string;
  user: AuthUser;
  selectedWorkspaceId: WorkspaceSelection;
  text: string;
  threadId?: string;
  buildSnapshot: () => Promise<string>;
  extraTools?: AccountTool[];
}

/** One streamed chat turn. Creates a thread if none was supplied, then runs the
 *  shared agent loop and persists both messages under that thread. */
export function streamAgentChat(env: Env, cfg: ChatTurnConfig): Response {
  return sseResp(async (send) => {
    const threads = new WebThreadStore(env, cfg.scopeKey, cfg.user.id);
    let threadId = cfg.threadId;
    if (!threadId) {
      const t = await threads.create(cfg.text);
      threadId = t.id;
      send({ type: 'thread', id: t.id, title: t.title });
    }

    const store = new D1ConversationStore(env, cfg.scopeKey, cfg.user.id, threadId);
    const reply = createWebReplyPort(env, cfg.user.id, send);
    const [history, snapshot] = await Promise.all([store.loadHistory(HISTORY_LIMIT), cfg.buildSnapshot()]);
    // A retry resends the message a failed turn already saved: keep one copy, and send
    // it to the model once (as this turn's text, not also as history).
    const last = history[history.length - 1];
    if (last?.role === 'user' && last.content === cfg.text) history.pop();
    else await store.appendMessage('user', cfg.text);

    const ws = typeof cfg.selectedWorkspaceId === 'string' && cfg.selectedWorkspaceId !== PERSONAL_SCOPE ? cfg.selectedWorkspaceId : null;
    const locale = await localeForRecipient(env, { userId: cfg.user.id, workspaceId: ws }).catch((): Locale => 'en');
    const result = await runAgentTurn(env, {
      locale,
      platform: 'web',
      userId: cfg.user.id,
      selectedWorkspaceId: cfg.selectedWorkspaceId,
      userText: cfg.text,
      history,
      reply,
      workspaceContext: snapshot,
      extraTools: cfg.extraTools,
    });

    const summary = result.proposal ? describeAction(result.proposal, locale) : '';
    if (result.toolNotes) await store.appendNotes(result.toolNotes);
    await store.appendMessage('assistant', [result.reply, summary].filter(Boolean).join('\n\n'));
    send({ type: 'text', text: result.reply });

    if (result.proposal && env.RATE_LIMIT_KV) {
      const token = generateId('appr');
      await store.putPending(token, { action: result.proposal });
      send({ type: 'confirm', prompt: summary, token, card: describeActionRich(result.proposal, locale) });
    }
    send({ type: 'done' });
  });
}

/** Confirm a pending action. Builds stream their progress (SSE); everything else
 *  returns a one-shot JSON result. */
export async function confirmAgentAction(env: Env, scopeKey: string, user: AuthUser, token: string): Promise<Response> {
  if (!env.RATE_LIMIT_KV) return jsonResp({ error: 'Confirmations are unavailable.' }, 503);
  if (!token) return jsonResp({ error: 'Missing token' }, 400);

  // Confirmation only touches the KV-backed pending record, never a thread's messages.
  const store = new D1ConversationStore(env, scopeKey, user.id, '');
  const rec = await store.takePending(token);
  if (!rec) return jsonResp({ error: 'That confirmation expired. Ask again?' }, 410);
  const remember = (text: string) => rec.threadId
    ? new D1ConversationStore(env, scopeKey, user.id, rec.threadId).appendMessage('assistant', text)
    : Promise.resolve();

  if (rec.action.kind === 'build_artifact') {
    const action = rec.action;
    return sseResp(async (send) => {
      const r = await executeBuildArtifact(env, user.id, action, (label) => send({ type: 'build_step', label }));
      await remember(r.url ? `${r.text}\n${r.url}` : r.text);
      send({ type: 'build_done', text: r.text, url: r.url, slug: r.slug, artifactId: r.artifactId, name: r.name });
      send({ type: 'done' });
    });
  }

  const resultText = await executeAction(env, user.id, rec.action);
  await remember(resultText);
  return jsonResp({ ok: true, text: resultText });
}

export async function listAgentThreads(env: Env, scopeKey: string, userId: string): Promise<Response> {
  const threads = await new WebThreadStore(env, scopeKey, userId).list();
  return jsonResp({ threads });
}

export async function getAgentThreadMessages(env: Env, scopeKey: string, userId: string, id: string, before?: string): Promise<Response> {
  const messages = await new WebThreadStore(env, scopeKey, userId).messages(id, THREAD_PAGE, before);
  if (messages === null) return jsonResp({ error: 'Not found' }, 404);
  return jsonResp({ messages });
}

export async function renameAgentThread(env: Env, scopeKey: string, userId: string, id: string, title: string): Promise<Response> {
  if (!title.trim()) return jsonResp({ error: 'Empty title' }, 400);
  const ok = await new WebThreadStore(env, scopeKey, userId).rename(id, title);
  return ok ? jsonResp({ ok: true }) : jsonResp({ error: 'Not found' }, 404);
}

export async function deleteAgentThread(env: Env, scopeKey: string, userId: string, id: string): Promise<Response> {
  const ok = await new WebThreadStore(env, scopeKey, userId).remove(id);
  return ok ? jsonResp({ ok: true }) : jsonResp({ error: 'Not found' }, 404);
}

export async function serveAgentMedia(env: Env, userId: string, token: string): Promise<Response> {
  const obj = await env.ARTIFACTS.get(agentMediaKey(userId, token));
  if (!obj) return jsonResp({ error: 'Not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=900',
    },
  });
}
