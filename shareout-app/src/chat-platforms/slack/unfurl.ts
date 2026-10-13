// Slack link previews ("unfurls") for ShareOut artifact links, and the same rich
// card reused by "Post to Slack". Security rule: a Slack team only gets an
// artifact's real content (title, TL;DR, owner, image) when it is connected to the
// ShareOut workspace that owns the artifact; anyone else gets at most what the
// public Open Graph tags already expose, and nothing for closed artifacts.
import type { Env } from '../../types';
import { getPlatformHostname } from '../../config/origins';
import { parseSubdomain } from '../../subdomain';
import { parseNamespacedPath } from '../../router/helpers/parse-namespaced-path';
import { normalizeVisibility } from '../../visibility-config';
import { resolveArtifactSocialPreview } from '../../serve/social-meta';
import { presignGet } from '../../data/r2-presign';
import { getUserRole } from '../../artifacts/roles';
import { localeForContent, type Locale } from '../../i18n/locale';
import { getLinkedUserId } from './linking';
import { resolveSlackTokenByTeam, resolveSlackTokenForWorkspaceTeam, slackPost } from './client';

export type ArtifactLink = { deploySlug: string } | { workspaceSlug: string; displaySlug: string };

/** Map a shared URL to an artifact reference: apex /a|p/<slug>, apex /@ws/…/<slug>,
 *  or <ws>.<apex>/<slug>. Anything else (other hosts, app pages) → null. */
export function parseArtifactLink(env: Env, rawUrl: string): ArtifactLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const apex = getPlatformHostname(env);
  const host = url.hostname.toLowerCase();
  const sub = parseSubdomain(host, apex);
  if (!sub.isSubdomain && host !== apex && host !== `www.${apex}`) return null;

  const path = url.pathname;
  const deploy = path.match(/^\/[ap]\/([^/]+)/);
  if (deploy) return { deploySlug: decodeURIComponent(deploy[1]) };
  if (path.startsWith('/@')) {
    const ns = parseNamespacedPath(path);
    return ns ? { workspaceSlug: ns.workspaceSlug, displaySlug: ns.artifactSlug } : null;
  }
  if (sub.isSubdomain && sub.workspaceSlug) {
    const first = path.split('/').filter(Boolean)[0];
    return first ? { workspaceSlug: sub.workspaceSlug, displaySlug: decodeURIComponent(first) } : null;
  }
  return null;
}

export interface PreviewRow {
  id: string;
  name: string;
  description: string | null;
  visibility: string | null;
  paused: number | null;
  workspace_id: string | null;
  owner_id: string | null;
  deploy_slug: string;
  updated_at: string | null;
  owner_name: string | null;
  social_title: string | null;
  social_description: string | null;
  social_image_url: string | null;
  thumbnail_ext: string | null;
  moderation_status: string;
}

async function loadPreviewRow(env: Env, where: string, binds: unknown[]): Promise<PreviewRow | null> {
  return env.DB.prepare(
    `SELECT a.id, a.name, a.description, a.visibility, a.paused, a.workspace_id, a.owner_id,
            d.slug AS deploy_slug, d.updated_at, u.name AS owner_name,
            p.social_title, p.social_description, p.social_image_url, p.thumbnail_ext,
            COALESCE(m.status, 'approved') AS moderation_status
       FROM artifacts a
       JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       LEFT JOIN workspaces w ON w.id = a.workspace_id
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN artifact_presentation p ON p.artifact_id = a.id
       LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      WHERE a.deleted_at IS NULL AND ${where}`
  ).bind(...binds).first<PreviewRow>();
}

export function loadArtifactForLink(env: Env, link: ArtifactLink): Promise<PreviewRow | null> {
  return 'deploySlug' in link
    ? loadPreviewRow(env, 'd.slug = ?', [link.deploySlug])
    : loadPreviewRow(env, 'w.slug = ? AND a.display_slug = ?', [link.workspaceSlug, link.displaySlug]);
}

/** Open to the internet exactly as the serve path treats it (and so has OG tags). */
export function isPubliclyVisible(row: PreviewRow): boolean {
  return normalizeVisibility(row.visibility) === 'public' && !row.paused && row.moderation_status === 'approved';
}

/** 'full' = real content, 'public' = only what public OG tags expose, 'none' = nothing. */
export type UnfurlLevel = 'full' | 'public' | 'none';

export function unfurlLevel(
  row: PreviewRow,
  opts: { teamConnected: boolean; extShared: boolean; sharerCanView: boolean },
): UnfurlLevel {
  const open = isPubliclyVisible(row);
  // Slack Connect channels include people outside the connected team.
  if (opts.teamConnected && !opts.extShared) {
    if (normalizeVisibility(row.visibility) !== 'private' || opts.sharerCanView) return 'full';
  }
  return open ? 'public' : 'none';
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const COPY: Record<Locale, { by: string; updated: string }> = {
  en: { by: 'By', updated: 'Updated' },
  es: { by: 'De', updated: 'Actualizado' },
};

const IMAGE_TTL_SECONDS = 7 * 24 * 3600; // SigV4 maximum

async function previewImageUrl(env: Env, row: PreviewRow, level: UnfurlLevel): Promise<string | null> {
  if (!row.social_image_url && !row.thumbnail_ext) return null; // no brand-icon filler
  if (isPubliclyVisible(row)) {
    return resolveArtifactSocialPreview(
      { artifact_id: row.id, artifact_name: row.name, ...row },
      env.SHAREOUT_BASE_URL,
      row.deploy_slug,
    ).imageUrl;
  }
  if (level !== 'full') return null;
  if (row.social_image_url && /^https:\/\//i.test(row.social_image_url)) return row.social_image_url;
  // Closed artifact: /t/ needs a session Slack doesn't have, so hand Slack a
  // short-lived presigned URL to the cached thumbnail (no render on this path).
  if (!row.thumbnail_ext) return null;
  return presignGet(env, `thumbnails/${row.id}.${row.thumbnail_ext}`, IMAGE_TTL_SECONDS);
}

/** Body blocks (no title) for an artifact preview at `level`. */
export async function previewBodyBlocks(env: Env, row: PreviewRow, level: UnfurlLevel): Promise<unknown[]> {
  if (level === 'none') return [];
  const blocks: unknown[] = [];
  const summary = (level === 'public' ? row.social_description || row.description : row.description)?.trim();
  if (summary) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: esc(summary) } });
  const image = await previewImageUrl(env, row, level);
  if (image) blocks.push({ type: 'image', image_url: image, alt_text: row.social_title || row.name });
  if (level === 'full') {
    const c = COPY[await localeForContent(env, row.workspace_id, row.owner_id).catch((): Locale => 'en')];
    const meta: string[] = [];
    if (row.owner_name) meta.push(`${c.by} ${esc(row.owner_name)}`);
    if (row.updated_at) {
      const epoch = Math.floor(Date.parse(row.updated_at) / 1000);
      if (Number.isFinite(epoch)) meta.push(`${c.updated} <!date^${epoch}^{date_short_pretty}|${row.updated_at.slice(0, 10)}>`);
    }
    meta.push('ShareOut');
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: meta.join(' · ') }] });
  }
  return blocks;
}

/** The rich card "Post to Slack" sends: the artifact's own workspace Slack, so full. */
export async function artifactPreviewBlocksById(env: Env, artifactId: string): Promise<unknown[] | null> {
  const row = await loadPreviewRow(env, 'a.id = ?', [artifactId]);
  return row ? previewBodyBlocks(env, row, 'full') : null;
}

const MAX_LINKS = 5;

/** Handle a `link_shared` event_callback: reply with chat.unfurl for artifact links. */
export async function handleLinkShared(env: Env, body: Record<string, unknown>): Promise<void> {
  const event = body.event as Record<string, unknown>;
  const teamId = String(body.team_id || '');
  const links = Array.isArray(event.links) ? (event.links as Array<{ url?: string }>) : [];
  if (!teamId || !links.length) return;
  const extShared = body.is_ext_shared_channel === true;
  const slackUserId = String(event.user || '');

  const unfurls: Record<string, { blocks: unknown[] }> = {};
  let token: string | null = null;

  for (const { url } of links.slice(0, MAX_LINKS)) {
    if (!url) continue;
    const link = parseArtifactLink(env, url);
    const row = link ? await loadArtifactForLink(env, link) : null;
    if (!row) continue;

    const wsToken = row.workspace_id ? await resolveSlackTokenForWorkspaceTeam(env, row.workspace_id, teamId) : null;
    let sharerCanView = false;
    if (wsToken && normalizeVisibility(row.visibility) === 'private' && slackUserId) {
      const linked = await getLinkedUserId(env, teamId, slackUserId);
      sharerCanView = !!linked && !!(await getUserRole(env, row.id, linked));
    }
    const level = unfurlLevel(row, { teamConnected: !!wsToken, extShared, sharerCanView });
    if (level === 'none') continue;

    const title = level === 'public' ? row.social_title || row.name : row.name;
    unfurls[url] = {
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*<${url}|${esc(title)}>*` } },
        ...(await previewBodyBlocks(env, row, level)),
      ],
    };
    token = token || wsToken;
  }

  if (!Object.keys(unfurls).length) return;
  token = token || (await resolveSlackTokenByTeam(env, teamId))?.token || null;
  if (!token) return;

  const target = event.unfurl_id && event.source
    ? { unfurl_id: event.unfurl_id, source: event.source }
    : { channel: event.channel, ts: event.message_ts };
  await slackPost(token, 'chat.unfurl', { ...target, unfurls });
}
