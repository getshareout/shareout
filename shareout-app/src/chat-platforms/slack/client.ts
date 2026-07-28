import type { Env } from '../../types';
import { decryptCredentials } from '../../data/connections/credentials';

export const SLACK_API = 'https://slack.com/api';

const SLACK_AUTH_ERROR_CODES = [
  'invalid_auth',
  'not_authed',
  'account_inactive',
  'token_revoked',
  'token_expired',
  'no_authed_user',
  'missing_scope',
  'not_allowed_token_type',
  'ekm_access_denied',
  'org_login_required',
  'no_permission',
];

export function isSlackAuthError(slackError: string | null | undefined): boolean {
  return !!slackError && SLACK_AUTH_ERROR_CODES.some((code) => slackError.includes(code));
}

/** Map internal Slack delivery errors to safe API responses (no raw Slack API text). */
export function userFacingSlackDeliveryError(error: string | null | undefined): {
  message: string;
  code: string;
  status: number;
} {
  const msg = error?.trim() || '';
  if (isSlackAuthError(msg)) {
    return {
      message: 'Slack connection needs to be re-authorized. Reconnect from workspace settings.',
      code: 'SLACK_AUTH',
      status: 400,
    };
  }
  const connMatch = msg.match(/^Slack connection '(.+)' not found$/);
  if (connMatch) {
    return { message: msg, code: 'NOT_FOUND', status: 404 };
  }
  if (msg === 'Artifact not found or not published') {
    return { message: msg, code: 'NOT_FOUND', status: 404 };
  }
  if (msg === 'Snapshot render failed' || msg === 'PDF render failed') {
    return { message: msg, code: 'RENDER_ERROR', status: 502 };
  }
  return { message: 'Failed to deliver to Slack', code: 'SLACK_ERROR', status: 502 };
}

export interface ResolvedSlackToken {
  token: string;
  teamId?: string;
}

export async function resolveSlackToken(
  env: Env,
  workspaceId: string,
  connectionName: string
): Promise<ResolvedSlackToken | null> {
  if (!env.CREDENTIALS_KEY) return null;

  const row = await env.DB.prepare(
    `SELECT encrypted_credentials, iv FROM connections
      WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND provider = 'slack'`
  ).bind(workspaceId, connectionName).first<{ encrypted_credentials: string; iv: string }>();
  if (!row) return null;

  const creds = await decryptCredentials(row.encrypted_credentials, row.iv, env.CREDENTIALS_KEY);
  const token = creds.access_token as string | undefined;
  if (!token) return null;

  const extra = creds.extra as { team_id?: string } | undefined;
  return { token, teamId: extra?.team_id };
}

export async function resolveSlackTokenByTeam(
  env: Env,
  teamId: string,
  connectionName?: string
): Promise<(ResolvedSlackToken & { workspaceId: string; connectionName: string }) | null> {
  if (!env.CREDENTIALS_KEY) return null;
  const query = connectionName
    ? `SELECT scope_id AS workspace_id, name, encrypted_credentials, iv FROM connections
        WHERE scope_type = 'workspace' AND provider = 'slack' AND name = ?`
    : `SELECT scope_id AS workspace_id, name, encrypted_credentials, iv FROM connections
        WHERE scope_type = 'workspace' AND provider = 'slack'`;
  const row = await env.DB.prepare(query)
    .bind(...(connectionName ? [connectionName] : []))
    .all<{ workspace_id: string; name: string; encrypted_credentials: string; iv: string }>();

  for (const r of row.results) {
    const creds = await decryptCredentials(r.encrypted_credentials, r.iv, env.CREDENTIALS_KEY);
    const extra = creds.extra as { team_id?: string } | undefined;
    if (extra?.team_id === teamId && creds.access_token) {
      return {
        token: creds.access_token as string,
        teamId,
        workspaceId: r.workspace_id,
        connectionName: r.name,
      };
    }
  }
  return null;
}

export async function slackPost(token: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { ok: boolean; error?: string };
}

export async function openDmChannel(token: string, slackUserId: string): Promise<{ channelId?: string; error?: string }> {
  const res = await slackPost(token, 'conversations.open', { users: slackUserId }) as {
    ok: boolean;
    error?: string;
    channel?: { id: string };
  };
  if (!res.ok || !res.channel?.id) {
    return { error: `conversations.open failed: ${res.error || 'unknown_error'}` };
  }
  return { channelId: res.channel.id };
}

export async function resolveSlackMemberId(
  token: string,
  hint: string
): Promise<{ userId?: string; error?: string }> {
  const trimmed = hint.trim();
  if (/^U[A-Z0-9]{8,}$/i.test(trimmed)) return { userId: trimmed };

  if (trimmed.includes('@')) {
    const params = new URLSearchParams({ email: trimmed });
    const response = await fetch(`${SLACK_API}/users.lookupByEmail?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as { ok: boolean; error?: string; user?: { id: string } };
    if (!data.ok || !data.user?.id) {
      return { error: `users.lookupByEmail failed: ${data.error || 'unknown_error'}` };
    }
    return { userId: data.user.id };
  }

  const needle = trimmed.toLowerCase();
  let cursor = '';
  do {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${SLACK_API}/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      members?: Array<{
        id: string;
        deleted?: boolean;
        real_name?: string;
        profile?: { real_name?: string; display_name?: string };
      }>;
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) return { error: `users.list failed: ${data.error || 'unknown_error'}` };
    for (const member of data.members || []) {
      if (member.deleted) continue;
      const names = [member.real_name, member.profile?.real_name, member.profile?.display_name]
        .filter(Boolean)
        .map((name) => name!.toLowerCase());
      if (names.some((name) => name === needle || name.includes(needle))) {
        return { userId: member.id };
      }
    }
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  return { error: `Slack member not found: ${trimmed}` };
}

export interface SlackChannel {
  id: string;
  name: string;
}

export async function listSlackChannels(token: string): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor = '';
  do {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(`${SLACK_API}/conversations.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels?: { id: string; name: string }[];
      response_metadata?: { next_cursor?: string };
    };
    if (!data.ok) throw new Error(`conversations.list failed: ${data.error || 'unknown_error'}`);
    for (const c of data.channels || []) channels.push({ id: c.id, name: c.name });
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  return channels;
}

export interface ArtifactUrlRow {
  slug: string;
  display_slug: string | null;
  workspace_slug: string | null;
  subdomain_enabled: number | null;
}

/**
 * Whether `{workspace}.{apex}` can actually resolve.
 *
 * This used to be `apex.endsWith('shareout.site')`, which conflated two things: the
 * real constraint (a host that can carry wildcard DNS) and one particular domain.
 * Local dev must keep falling back — `acme.localhost:55162` resolves nowhere —
 * but so must a self-hosted workspace that has deliberately enabled subdomains stop
 * being forced onto apex links.
 */
function supportsSubdomains(apex: string): boolean {
  const host = apex.split('/')[0];
  if (host.includes(':')) return false;            // dev server with an explicit port
  if (!host.includes('.')) return false;           // bare hostname, e.g. localhost
  if (/^\d+(\.\d+)+$/.test(host)) return false;    // raw IPv4
  return !host.endsWith('.localhost');
}

export function buildArtifactUrl(base: string, row: ArtifactUrlRow): string {
  const trimmed = base.replace(/\/$/, '');
  const apex = trimmed.replace(/^https?:\/\/(www\.)?/, '');
  if (row.subdomain_enabled === 1 && row.workspace_slug && supportsSubdomains(apex)) {
    return `https://${row.workspace_slug}.${apex}/${row.display_slug || row.slug}/`;
  }
  return `${trimmed}/a/${row.slug}/`;
}

export async function postSlackMessage(
  token: string,
  channelId: string,
  text: string,
  blocks?: unknown[]
): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const result = await slackPost(token, 'chat.postMessage', {
    channel: channelId,
    text,
    ...(blocks ? { blocks } : {}),
  }) as { ok: boolean; error?: string; ts?: string };
  return result;
}

export async function uploadFileToSlack(
  token: string,
  channelId: string,
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
  title: string,
  initialComment?: string
): Promise<{ ok: boolean; error?: string }> {
  const getUrl = new URLSearchParams({ filename, length: String(bytes.byteLength) });
  const reserveRes = await fetch(`${SLACK_API}/files.getUploadURLExternal?${getUrl}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const reserve = (await reserveRes.json()) as { ok: boolean; error?: string; upload_url?: string; file_id?: string };
  if (!reserve.ok || !reserve.upload_url || !reserve.file_id) {
    return { ok: false, error: `files.getUploadURLExternal failed: ${reserve.error || 'unknown_error'}` };
  }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  const uploadRes = await fetch(reserve.upload_url, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    return { ok: false, error: `File upload returned ${uploadRes.status}` };
  }

  const complete = await slackPost(token, 'files.completeUploadExternal', {
    files: [{ id: reserve.file_id, title }],
    channel_id: channelId,
    ...(initialComment ? { initial_comment: initialComment } : {}),
  });
  return { ok: complete.ok, error: complete.error };
}
