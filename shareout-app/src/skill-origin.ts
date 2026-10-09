/**
 * Rewrite founder-host literals in the agent skill to this instance's origin.
 *
 * The skill markdown is written against `https://shareout.site` because that is a
 * real, copy-pasteable instance for the hosted product. Served verbatim from a
 * self-hosted Worker it is actively harmful: an agent that loads the skill from
 * `{ORIGIN}/v1/skill` is told to `POST https://shareout.site/v1/publish`, so the
 * user's content lands on someone else's server.
 *
 * Every skill response goes through here. It also bakes this instance's origin into
 * the `$ORIGIN` / `$ORIGIN_HOST` placeholders the skill tree is written with, so an
 * agent that downloaded the skill from an instance already knows where it lives and
 * never has to ask the user. That part applies on every instance, the founder host
 * included; the founder-literal rewrite below is skipped there.
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

// `$ORIGIN_HOST` first: `$ORIGIN` is its prefix.
const PLACEHOLDER = /\$ORIGIN_HOST\b|\$ORIGIN\b/g;

/**
 * A text transform for skill content. Kept nullable for callers that skip work when
 * nothing needs rewriting, but every instance now has placeholders to fill.
 */
export function skillOriginRewriter(env: Env): ((text: string) => string) | null {
  const origin = getPlatformOrigin(env);
  const host = getPlatformHostname(env);
  const fillPlaceholders = (text: string): string =>
    text.replace(PLACEHOLDER, (m) => (m === '$ORIGIN_HOST' ? host : origin));

  // The app origin is what decides this: if it is the founder host, this *is* the
  // hosted instance and every literal in the skill is already correct. (Its
  // ARTIFACT_ORIGIN is shareoutcdn.site, so the sandbox mentions are right too.)
  if (origin === FOUNDER_ORIGIN && host === FOUNDER_HOST) return fillPlaceholders;

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

  return (text: string): string => fillPlaceholders(text.replace(pattern, (m) => replacements[m]));
}

/** Convenience for a single string. */
export function rewriteSkillOrigin(text: string, env: Env): string {
  const rewrite = skillOriginRewriter(env);
  return rewrite ? rewrite(text) : text;
}
