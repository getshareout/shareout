/**
 * Rewrite founder-host literals in the agent skill to this instance's origin.
 *
 * The skill markdown is written against `https://shareout.site` because that is a
 * real, copy-pasteable instance for the hosted product. Served verbatim from a
 * self-hosted Worker it is actively harmful: an agent that loads the skill from
 * `{ORIGIN}/v1/skill` is told to `POST https://shareout.site/v1/publish`, so the
 * user's content lands on someone else's server.
 *
 * Every skill response goes through here. When the instance *is* the founder host
 * (or `SHAREOUT_BASE_URL` is unset and falls back to it) the rewrite is a no-op and
 * the bytes are unchanged — the well-known SKILL.md digest stays stable.
 */
import type { Env } from './types';
import { getPlatformHostname, getPlatformOrigin } from './config/origins';

const FOUNDER_ORIGIN = 'https://shareout.site';
const FOUNDER_HOST = 'shareout.site';
const FOUNDER_CDN_HOST = 'shareoutcdn.site';

/** Hostname artifacts are served from — the CDN zone when set, else the app host. */
function artifactHostname(env: Env, platformHost: string): string {
  if (!env.ARTIFACT_ORIGIN) return platformHost;
  try {
    return new URL(env.ARTIFACT_ORIGIN).hostname || platformHost;
  } catch {
    return platformHost;
  }
}

/**
 * A text transform for skill content, or `null` when this instance is the founder
 * host and nothing needs rewriting. Callers use `null` to skip the work entirely —
 * on the hosted instance that keeps `/v1/skill` a straight R2 passthrough.
 */
export function skillOriginRewriter(env: Env): ((text: string) => string) | null {
  const origin = getPlatformOrigin(env);
  const host = getPlatformHostname(env);

  // The app origin is what decides this: if it is the founder host, this *is* the
  // hosted instance and every literal in the skill is already correct. (Its
  // ARTIFACT_ORIGIN is shareoutcdn.site, so the sandbox mentions are right too.)
  if (origin === FOUNDER_ORIGIN && host === FOUNDER_HOST) return null;

  const cdnHost = artifactHostname(env, host);

  // One pass, longest alternative first. Sequential replaces would re-match their
  // own output whenever the replacement contains the next needle — an instance at
  // `https://myshareout.site` would otherwise come out as `https://mymyshareout.site`.
  const pattern = /https:\/\/shareout\.site|shareoutcdn\.site|shareout\.site/g;
  const replacements: Record<string, string> = {
    [FOUNDER_ORIGIN]: origin,
    [FOUNDER_CDN_HOST]: cdnHost,
    // Bare hostname mentions, including subdomain examples
    // (`acme.shareout.site`, `inbox.shareout.site`), follow the instance's domain.
    [FOUNDER_HOST]: host,
  };

  return (text: string): string => text.replace(pattern, (m) => replacements[m]);
}

/** Convenience for a single string; no-ops on the founder host. */
export function rewriteSkillOrigin(text: string, env: Env): string {
  const rewrite = skillOriginRewriter(env);
  return rewrite ? rewrite(text) : text;
}
