import type { Env } from '../types';
import type { FetchContext } from './context';
import { commandToAgentPrompt } from '../chat-agent/commands';
import { enqueueAgentTurn, enqueueCallback } from '../chat-platforms/dispatch';
import { createSlackReplyPort } from '../chat-platforms/slack/reply-port';
import {
  getLinkedUserId,
  getSelectedSlackWorkspace,
  setSelectedSlackWorkspace,
  unlinkSlackDm,
} from '../chat-platforms/slack/linking';
import { verifySlackRequest, slackEventDedupId } from '../chat-platforms/slack/verify';
import { PERSONAL_SCOPE } from '../chat-platforms/types';
import { listWorkspacesForUser, TELEGRAM_PERSONAL_WORKSPACE } from '../chat-agent/access';
import { listArtifactsForUser } from '../chat-agent/tools/artifacts';
import { sendSnapshotTool, sendPdfTool } from '../chat-agent/tools/media';
import { openTicket } from '../support/intake';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';

const HELP_TEXT = [
  "I'm your ShareOut assistant in Slack. I can find, read, summarize, and update the pages your ShareOut account can see.",
  '',
  'Useful commands:',
  '/shareout artifacts — list pages in the current scope',
  '/shareout search <text> — find a page',
  '/shareout workspaces — show available workspaces',
  '/shareout workspace <name> — switch workspace',
  '/shareout personal — switch to personal pages',
  '/shareout status — show connected account and scope',
  '/shareout settings — open Slack settings',
  '/shareout support <what went wrong> — open a support ticket',
  '/shareout unlink — disconnect this DM',
  '/shareout help — show this message',
  '',
  'You can also message me normally, like "summarize the adoption report".',
].join('\n');

const NOT_LINKED_TEXT =
  'Connect your ShareOut account first: open ShareOut → Settings → Connect Slack, pick your workspace Slack connection, then come back here.';

function ok(): Response {
  return new Response(null, { status: 200 });
}

function slackNativeId(teamId: string, userId: string): string {
  return `${teamId}:${userId}`;
}

function parseCommand(text: string): { name: string; args: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/shareout(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const rest = (match[1] || '').trim();
  if (!rest) return { name: 'help', args: '' };
  const parts = rest.split(/\s+/);
  return { name: parts[0].toLowerCase(), args: parts.slice(1).join(' ') };
}

export async function routeSlack(ctx: FetchContext): Promise<Response | null> {
  const { request, path } = ctx;
  if (!path.startsWith('/slack/')) return null;

  if (path === '/slack/events' && request.method === 'POST') {
    return handleEvents(ctx);
  }
  if (path === '/slack/interactions' && request.method === 'POST') {
    return handleInteractions(ctx);
  }
  if (path === '/slack/commands' && request.method === 'POST') {
    return handleSlashCommand(ctx);
  }
  return null;
}

async function readVerifiedBody(ctx: FetchContext): Promise<string | null> {
  const { request, env } = ctx;
  const raw = await request.text();
  if (!env.SLACK_SIGNING_SECRET) return null;
  const valid = await verifySlackRequest(request, env.SLACK_SIGNING_SECRET, raw);
  return valid ? raw : null;
}

async function handleEvents(ctx: FetchContext): Promise<Response> {
  const raw = await readVerifiedBody(ctx);
  if (!raw) return ok();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return ok();
  }

  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return Response.json({ challenge: body.challenge });
  }

  if (body.type !== 'event_callback') return ok();

  const work = dispatchEventCallback(ctx.env, body);
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(work);
  else await work;
  return ok();
}

async function dispatchEventCallback(env: Env, body: Record<string, unknown>): Promise<void> {
  const event = body.event as Record<string, unknown> | undefined;
  if (!event || event.type !== 'message') return;
  if (event.subtype || event.bot_id) return;
  if (event.channel_type !== 'im') return;

  const teamId = String(body.team_id || event.team || '');
  const userId = String(event.user || '');
  const channelId = String(event.channel || '');
  const text = typeof event.text === 'string' ? event.text.trim() : '';
  if (!teamId || !userId || !text) return;

  const eventId = String(body.event_id || event.event_ts || `${teamId}:${userId}:${text}`);
  await dispatchSlackText(env, { teamId, userId, channelId, text, updateId: slackEventDedupId(eventId) });
}

async function handleSlashCommand(ctx: FetchContext): Promise<Response> {
  const raw = await readVerifiedBody(ctx);
  if (!raw) return ok();

  const params = new URLSearchParams(raw);
  const teamId = params.get('team_id') || '';
  const userId = params.get('user_id') || '';
  const channelId = params.get('channel_id') || '';
  const text = (params.get('text') || '').trim();
  const triggerId = params.get('trigger_id') || teamId;

  if (!teamId || !userId) return ok();

  const work = dispatchSlackText(ctx.env, {
    teamId,
    userId,
    channelId,
    text: text ? `/shareout ${text}` : '/shareout help',
    updateId: slackEventDedupId(`cmd:${triggerId}:${text}`),
  });
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(work);
  else await work;

  return new Response('', { status: 200 });
}

async function handleInteractions(ctx: FetchContext): Promise<Response> {
  const raw = await readVerifiedBody(ctx);
  if (!raw) return ok();

  const params = new URLSearchParams(raw);
  const payloadRaw = params.get('payload');
  if (!payloadRaw) return ok();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return ok();
  }

  const work = dispatchInteraction(ctx.env, payload);
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(work);
  else await work;

  return ok();
}

interface SlackInbound {
  teamId: string;
  userId: string;
  channelId: string;
  text: string;
  updateId: number;
}

async function dispatchSlackText(env: Env, inbound: SlackInbound): Promise<void> {
  const { teamId, userId, channelId, text, updateId } = inbound;
  const reply = createSlackReplyPort(env, { teamId, slackUserId: userId, channelId });
  const command = parseCommand(text);

  if (command?.name === 'help') {
    await reply.sendText(HELP_TEXT);
    return;
  }
  if (command?.name === 'unlink') {
    await unlinkSlackDm(env, teamId, userId);
    await reply.sendText('Done — this DM is no longer linked to your ShareOut account.');
    return;
  }

  const linkedUserId = await getLinkedUserId(env, teamId, userId);
  if (!linkedUserId) {
    await reply.sendText(NOT_LINKED_TEXT);
    return;
  }

  if (command?.name === 'settings') {
    await reply.sendText(`${getPlatformOrigin(env)}/settings/slack`);
    return;
  }
  if (command?.name === 'personal') {
    await setSelectedSlackWorkspace(env, teamId, userId, PERSONAL_SCOPE);
    await reply.sendText('Done — I’ll focus on your personal pages. Use `/shareout workspace all` to see everything again.');
    return;
  }
  if (command?.name === 'artifacts') {
    await handleListArtifacts(env, reply, linkedUserId, teamId, userId);
    return;
  }
  if (command?.name === 'search') {
    await handleSearch(env, reply, linkedUserId, teamId, userId, command.args);
    return;
  }
  if (command?.name === 'workspaces' || command?.name === 'workspace') {
    await handleWorkspace(env, reply, linkedUserId, teamId, userId, command.args);
    return;
  }
  if (command?.name === 'status') {
    const scope = await getSelectedSlackWorkspace(env, teamId, userId);
    const label = scope === PERSONAL_SCOPE ? 'personal pages' : scope ? `workspace ${scope}` : 'all accessible pages';
    await reply.sendText(`Connected to ShareOut. Current scope: ${label}.`);
    return;
  }
  if (command?.name === 'support' || command?.name === 'bug') {
    const body = command.args.trim();
    if (!body) {
      await reply.sendText('Tell me what went wrong — e.g. `/shareout support Publish button does nothing`.');
      return;
    }
    const subject = body.length > 80 ? body.slice(0, 77) + '…' : body;
    await openTicket(env, {
      requesterUserId: linkedUserId,
      channel: 'slack',
      channelRef: `${teamId}:${channelId}`,
      subject,
      body,
    });
    await reply.sendText('Got it — your support ticket is open. Our team will reply here.');
    return;
  }

  if (command) {
    const prompt = commandToAgentPrompt(command.name, command.args);
    if (prompt) {
      await dispatchAgent(env, {
        teamId,
        slackUserId: userId,
        userId: linkedUserId,
        channelId,
        text: prompt,
        updateId,
      });
      return;
    }
    await reply.sendText(`I don’t know \`/shareout ${command.name}\` yet. Try \`/shareout help\`.`);
    return;
  }

  await dispatchAgent(env, {
    teamId,
    userId: linkedUserId,
    slackUserId: userId,
    channelId,
    text,
    updateId,
  });
}

async function dispatchAgent(
  env: Env,
  opts: {
    teamId: string;
    slackUserId: string;
    userId: string;
    channelId: string;
    text: string;
    updateId: number;
  }
): Promise<void> {
  const nativeId = slackNativeId(opts.teamId, opts.slackUserId);
  const selectedWorkspaceId = await getSelectedSlackWorkspace(env, opts.teamId, opts.slackUserId);
  const reply = createSlackReplyPort(env, {
    teamId: opts.teamId,
    slackUserId: opts.slackUserId,
    channelId: opts.channelId,
  });
  await enqueueAgentTurn(env, {
    platform: 'slack',
    nativeChatId: nativeId,
    userId: opts.userId,
    text: opts.text,
    updateId: opts.updateId,
    selectedWorkspaceId,
    slackChannelId: opts.channelId,
    onUnavailable: async (message) => reply.sendText(message),
  });
}

async function handleListArtifacts(
  env: Env,
  reply: ReturnType<typeof createSlackReplyPort>,
  userId: string,
  teamId: string,
  slackUserId: string
): Promise<void> {
  const scope = await getSelectedSlackWorkspace(env, teamId, slackUserId);
  const items = await listArtifactsForUser(env, userId, { limit: 10, workspaceId: scope });
  if (!items.length) {
    await reply.sendText(
      `No pages found in this scope. Try \`/shareout workspace all\` or create one at ${getPlatformHostname(env)}.`,
    );
    return;
  }
  await reply.sendArtifactCards(items);
}

async function handleSearch(
  env: Env,
  reply: ReturnType<typeof createSlackReplyPort>,
  userId: string,
  teamId: string,
  slackUserId: string,
  query: string
): Promise<void> {
  if (!query) {
    await reply.sendText('Try `/shareout search sales` or `/shareout search adoption`.');
    return;
  }
  const scope = await getSelectedSlackWorkspace(env, teamId, slackUserId);
  const items = await listArtifactsForUser(env, userId, { search: query, limit: 10, workspaceId: scope });
  if (!items.length) {
    await reply.sendText(`No pages matched “${query}”. Try \`/shareout workspace all\` to search everywhere.`);
    return;
  }
  await reply.sendArtifactCards(items);
}

async function handleWorkspace(
  env: Env,
  reply: ReturnType<typeof createSlackReplyPort>,
  userId: string,
  teamId: string,
  slackUserId: string,
  rawArg: string
): Promise<void> {
  const arg = rawArg.trim().toLowerCase();
  if (!arg) {
    const workspaces = await listWorkspacesForUser(env, userId);
    const lines = workspaces.map((w) => `• ${w.name} (${w.slug}) — ${w.artifactCount} pages`);
    await reply.sendText([
      'Workspaces:',
      lines.length ? lines.join('\n') : 'No team workspaces yet.',
      '',
      'Use `/shareout workspace <slug>` or `/shareout workspace all`.',
    ].join('\n'));
    return;
  }
  if (arg === 'all' || arg === 'everything') {
    await setSelectedSlackWorkspace(env, teamId, slackUserId, null);
    await reply.sendText('Done — I’ll search across every page your linked accounts can access.');
    return;
  }
  if (arg === 'personal' || arg === 'private') {
    await setSelectedSlackWorkspace(env, teamId, slackUserId, TELEGRAM_PERSONAL_WORKSPACE);
    await reply.sendText('Done — I’ll focus on your personal pages.');
    return;
  }
  const workspaces = await listWorkspacesForUser(env, userId);
  const match = workspaces.find((w) => w.slug === arg || w.name.toLowerCase() === arg);
  if (!match) {
    await reply.sendText(`Workspace “${rawArg}” not found. Try \`/shareout workspaces\`.`);
    return;
  }
  await setSelectedSlackWorkspace(env, teamId, slackUserId, match.id);
  await reply.sendText(`Done — I’ll focus on ${match.name}. Try \`/shareout artifacts\`.`);
}

async function dispatchInteraction(env: Env, payload: Record<string, unknown>): Promise<void> {
  if (payload.type !== 'block_actions') return;
  const team = payload.team as { id?: string } | undefined;
  const user = payload.user as { id?: string } | undefined;
  const channel = payload.channel as { id?: string } | undefined;
  const message = payload.message as { ts?: string } | undefined;
  const actions = payload.actions as Array<{ value?: string }> | undefined;
  const teamId = team?.id || '';
  const userId = user?.id || '';
  const channelId = channel?.id || '';
  const value = actions?.[0]?.value || '';
  if (!teamId || !userId || !value) return;

  const linkedUserId = await getLinkedUserId(env, teamId, userId);
  if (!linkedUserId) return;

  const [kind, id] = value.split(':');
  const updateId = slackEventDedupId(`ia:${teamId}:${userId}:${value}:${message?.ts || ''}`);
  const nativeId = slackNativeId(teamId, userId);
  const reply = createSlackReplyPort(env, { teamId, slackUserId: userId, channelId });

  if (kind === 'ok' || kind === 'no') {
    await enqueueCallback(env, {
      platform: 'slack',
      nativeChatId: nativeId,
      userId: linkedUserId,
      data: value,
      callbackId: String(payload.trigger_id || ''),
      messageId: message?.ts || '',
      updateId,
      slackChannelId: channelId,
      onUnavailable: async (msg) => reply.sendText(msg),
    });
    return;
  }

  if (kind === 'snap' || kind === 'pdf') {
    const tool = kind === 'snap' ? sendSnapshotTool : sendPdfTool;
    const result = await tool.execute({ env, userId: linkedUserId, platform: 'slack', reply }, { artifact_id: id }) as { error?: string };
    await reply.sendText(result?.error || (kind === 'snap' ? 'Sent snapshot.' : 'Sent PDF.'));
    return;
  }

  if (kind === 'ask') {
    await dispatchAgent(env, {
      teamId,
      slackUserId: userId,
      userId: linkedUserId,
      channelId,
      text: `The user tapped Ask AI for artifact_id ${id}. Ask what they want to know about this page.`,
      updateId,
    });
  }
}
