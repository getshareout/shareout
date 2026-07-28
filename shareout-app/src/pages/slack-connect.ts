import type { Env } from '../types';
import { brandLockupHtml } from '../brand';
import { renderHtmlPage } from '../design-system/shell';
import { escapeHtml } from '../html/utils';
import {
  countSlackLinks,
  linkSlackDm,
  listSlackConnectionsForUser,
} from '../chat-platforms/slack/linking';
import { resolveSlackMemberId, resolveSlackToken } from '../chat-platforms/slack/client';

interface SlackConnectUser {
  id: string;
  email: string | null;
}

const slackConnectStyles = `
body {
  min-height: 100vh;
  background:
    radial-gradient(920px 620px at 80% -12%, #e4ecff 0%, transparent 58%),
    radial-gradient(760px 560px at 8% 6%, #fdede2 0%, transparent 54%),
    var(--color-bg);
}
.slk-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
}
.slk-card {
  width: min(100%, 560px);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--space-8);
}
.slk-brand { margin-bottom: var(--space-8); }
.slk-kicker {
  margin: 0 0 var(--space-3);
  color: var(--color-text-tertiary);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.slk-title {
  margin: 0;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: clamp(2rem, 6vw, 3rem);
  letter-spacing: -0.04em;
  line-height: 0.95;
}
.slk-copy {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
  font-size: 1rem;
  line-height: 1.65;
}
.slk-form { margin-top: var(--space-7); display: grid; gap: var(--space-4); }
.slk-label { font-weight: 600; color: var(--color-text); }
.slk-select, .slk-button {
  min-height: 48px;
  border-radius: var(--radius-lg);
  font-weight: 700;
}
.slk-select {
  width: 100%;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
}
.slk-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-5);
  border: none;
  cursor: pointer;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  box-shadow: 0 2px 12px -3px var(--color-primary-glow);
  text-decoration: none;
}
.slk-button-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--color-border-strong);
  box-shadow: none;
}
.slk-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-5); }
.slk-status {
  margin-top: var(--space-6);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text-secondary);
}
.slk-status strong { color: var(--color-text); }
.slk-error { color: var(--color-danger, #b42318); }
.slk-help {
  margin-top: var(--space-6);
  color: var(--color-text-tertiary);
  font-size: 0.9rem;
}
`;

function connectionValue(workspaceId: string, connectionName: string): string {
  return `${workspaceId}::${connectionName}`;
}

function parseConnectionValue(raw: string): { workspaceId: string; connectionName: string } | null {
  const idx = raw.indexOf('::');
  if (idx <= 0) return null;
  return { workspaceId: raw.slice(0, idx), connectionName: raw.slice(idx + 2) };
}

export async function linkSlackAccount(
  env: Env,
  user: SlackConnectUser,
  connectionValueRaw: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = parseConnectionValue(connectionValueRaw);
  if (!parsed) return { ok: false, error: 'Pick a Slack connection.' };
  if (!user.email) return { ok: false, error: 'Your ShareOut account needs an email to match your Slack profile.' };

  const token = await resolveSlackToken(env, parsed.workspaceId, parsed.connectionName);
  if (!token?.teamId) {
    return { ok: false, error: 'Slack connection not found or missing team id. Re-authorize the connection in workspace settings.' };
  }

  const member = await resolveSlackMemberId(token.token, user.email);
  if (!member.userId) {
    return { ok: false, error: member.error || 'Could not find your Slack user by email. Check users:read.email scope.' };
  }

  await linkSlackDm(env, {
    userId: user.id,
    teamId: token.teamId,
    slackUserId: member.userId,
    connectionName: parsed.connectionName,
    workspaceId: parsed.workspaceId,
  });
  return { ok: true };
}

export async function renderSlackConnectPage(
  env: Env,
  user: SlackConnectUser,
  flash?: { type: 'ok' | 'error'; message: string }
): Promise<Response> {
  const [linkedCount, connections] = await Promise.all([
    countSlackLinks(env, user.id),
    listSlackConnectionsForUser(env, user.id),
  ]);

  const options = connections.map((c) => {
    const label = `${c.workspaceName} — ${c.connectionName}`;
    return `<option value="${escapeHtml(connectionValue(c.workspaceId, c.connectionName))}">${escapeHtml(label)}</option>`;
  }).join('');

  const form = connections.length
    ? `<form class="slk-form" method="post" action="/settings/slack">
        <label class="slk-label" for="connection">Workspace Slack connection</label>
        <select class="slk-select" id="connection" name="connection" required>
          <option value="">Select…</option>
          ${options}
        </select>
        <button class="slk-button" type="submit">Link Slack DM</button>
      </form>`
    : `<div class="slk-status">No Slack connections yet. Add one in a workspace’s <strong>Connections</strong> settings, then return here.</div>`;

  const connected = linkedCount > 0
    ? `<div class="slk-status"><strong>Connected.</strong> Open a DM with the ShareOut app in Slack, then try <code>/shareout help</code>. To disconnect, send <code>/shareout unlink</code>.</div>`
    : '';

  const flashHtml = flash
    ? `<div class="slk-status${flash.type === 'error' ? ' slk-error' : ''}">${escapeHtml(flash.message)}</div>`
    : '';

  const email = user.email ? ` for ${escapeHtml(user.email)}` : '';
  const body = `<main class="slk-page">
  <section class="slk-card">
    <div class="slk-brand">${brandLockupHtml({ href: '/home' })}</div>
    <p class="slk-kicker">Slack</p>
    <h1 class="slk-title">Chat in Slack DMs.</h1>
    <p class="slk-copy">
      Link Slack${email} to your ShareOut account. We match your login email to your Slack profile
      using the workspace bot token you choose below.
    </p>
    ${flashHtml}
    ${form}
    <div class="slk-actions">
      <a class="slk-button slk-button-secondary" href="/home">Back to ShareOut</a>
    </div>
    ${connected}
    <p class="slk-help">Requires the ShareOut Slack app installed on the workspace and <code>users:read.email</code> on the bot token.</p>
  </section>
</main>`;

  return renderHtmlPage({
    title: 'Connect Slack · ShareOut',
    description: 'Connect Slack DMs to your ShareOut account.',
    pageStyles: slackConnectStyles,
    body,
    cacheControl: 'private, no-cache',
  });
}

export async function handleSlackConnectPost(
  env: Env,
  user: SlackConnectUser,
  connectionRaw: string
): Promise<Response> {
  const result = await linkSlackAccount(env, user, connectionRaw);
  if (!result.ok) {
    return renderSlackConnectPage(env, user, { type: 'error', message: result.error });
  }
  return renderSlackConnectPage(env, user, { type: 'ok', message: 'Slack linked. Open a DM with ShareOut and try /shareout help.' });
}
