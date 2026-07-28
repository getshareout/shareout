// Publish-time safety check (Workstream B). Filter #1 of 4 (see plan D-1): the AI
// classifier reads the static entrypoint HTML + extracted signals and judges
// phishing / malware / scam / illegal content. It is NOT the whole wall — runtime
// mutation, obfuscated payloads, and post-publish data changes evade it; reactive
// takedown (D), anti-Sybil (F), cost ceilings (G) and domain monitoring (H) are
// the co-equal defenses. Fail-safe: when a *configured* classifier errors/times
// out, return 'error' → pending (held private). When no AI provider is configured
// (fresh self-host), approve so first publishes are not stuck on "Being reviewed".

import { getPlatformHostname } from '../config/origins';
import type { Env } from '../types';
import { getAIProviderChain, alertProviderFailure } from '../data/agent/anthropic';
import { fetchWithTimeout } from '../fetch-utils';
import { extractSignals } from './extract';
import {
  ALLOWED_ARTIFACT_SCRIPT_HOSTS,
  findBlockedOpenScriptHosts,
  findBlockedOpenStyleHosts,
} from '../serve/security';
import { invalidateDeploymentCacheById } from '../serve/deployment-cache';
import { notifyModerationResolved } from './notify';
import { setModeration } from '../artifacts/satellites';

export type ModerationVerdict = 'clean' | 'suspicious' | 'malicious' | 'error';
export type ModerationStatus = 'approved' | 'pending' | 'blocked';

export interface SafetyCheckResult {
  verdict: ModerationVerdict;
  status: ModerationStatus;
  reason: string;
  contentHash: string;
}

const CLASSIFIER_TIMEOUT_MS = 5000;
const MAX_HTML_CHARS = 60_000; // keep the prompt bounded + cheap

// Keep head + tail so end-of-file <script> tags stay visible when the page is large.
function sampleHtml(html: string): string {
  if (html.length <= MAX_HTML_CHARS) return html;
  return `${html.slice(0, 45_000)}\n…[truncated ${html.length - MAX_HTML_CHARS} chars]…\n${html.slice(-15_000)}`;
}

export function verdictToStatus(verdict: ModerationVerdict): ModerationStatus {
  switch (verdict) {
    case 'clean':
      return 'approved';
    case 'malicious':
      return 'blocked';
    // suspicious AND error both hold the artifact for human review (fail-safe).
    default:
      return 'pending';
  }
}

/** SHA-256 of the entrypoint HTML — lets the caller skip re-classifying an
 *  unchanged re-publish (stored as moderation_content_hash). */
export async function contentHash(html: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The classifier needs to know which domains are *this* instance's, so links to them
 * read as platform behaviour rather than impersonation.
 *
 * It used to name shareout.site unconditionally, which got it backwards on every
 * other instance: a self-hoster's own artifacts linking to their own domain looked
 * like impersonation, while links to a domain they do not own were vouched for.
 */
function systemPrompt(env: Env): string {
  const host = getPlatformHostname(env);
  let contentHost = host;
  if (env.ARTIFACT_ORIGIN) {
    try {
      contentHost = new URL(env.ARTIFACT_ORIGIN).hostname || host;
    } catch {
      // keep the platform host
    }
  }
  const ownDomains = contentHost === host
    ? `${host} and *.${host}`
    : `${host}, *.${host}, ${contentHost} and *.${contentHost}`;

  return `You are a content-safety classifier for the ShareOut website hosting platform.
Classify the page as one of: "clean", "suspicious", "malicious".

Platform context: the page is hosted on ShareOut. ${ownDomains} are this instance's
own domains — links or scripts pointing to them are
normal platform behavior, NOT impersonation. Allowlisted public CDNs (jsdelivr, unpkg,
cdnjs, plotly, tailwind, esm.sh, googleapis) are routine and not suspicious on their own.

malicious = clear phishing (credential/payment theft impersonating a real brand),
  malware/drive-by, illegal content, or a scam intended to defraud.
suspicious = deceptive or evasive signals you cannot confirm are benign
  (impersonation hints, payload-decoding JS with eval/atob, redirect-to-unknown).
clean = ordinary legitimate content.

Do NOT flag content merely for:
- login/password fields, financial dashboards, or security-research demos
- large inline JSON/CSV data or minified application JS (data apps do this)
- scripts/styles from known package CDNs listed as "Allowlisted CDNs" below
  (jsdelivr, unpkg, cdnjs, plotly, chart hosts, etc.)
Judge intent to harm, not topic or payload size. When genuinely unsure between
clean and suspicious, choose suspicious.

Respond with ONLY compact JSON: {"verdict":"clean|suspicious|malicious","reason":"<short>"}`;
}

const ALLOWED_SCRIPT_HOST_SET = new Set<string>(ALLOWED_ARTIFACT_SCRIPT_HOSTS);

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function parseVerdict(content: string): { verdict: ModerationVerdict; reason: string } | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { verdict?: string; reason?: string };
    if (obj.verdict === 'clean' || obj.verdict === 'suspicious' || obj.verdict === 'malicious') {
      return { verdict: obj.verdict, reason: (obj.reason || '').slice(0, 300) };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Run the synchronous publish-time safety check on the entrypoint HTML. */
export async function runPublishSafetyCheck(env: Env, html: string): Promise<SafetyCheckResult> {
  const hash = await contentHash(html);
  const signals = extractSignals(html);

  const chain = getAIProviderChain(env);
  if (chain.length === 0) {
    // Self-host without an AI key: do not hold every public publish behind
    // "Being reviewed". Heuristic script/host checks below still run when we add
    // them; the LLM classifier is the only thing missing here.
    return {
      verdict: 'clean',
      status: 'approved',
      reason: 'classifier not configured (self-host)',
      contentHash: hash,
    };
  }

  const allowlistedScripts = signals.externalScripts.filter((h) => ALLOWED_SCRIPT_HOST_SET.has(h));
  const unknownScripts = signals.externalScripts.filter((h) => !ALLOWED_SCRIPT_HOST_SET.has(h));
  const userContent =
    `Outbound hosts: ${signals.urls.join(', ') || 'none'}\n` +
    `Allowlisted CDNs (benign): ${allowlistedScripts.join(', ') || 'none'}\n` +
    `Unknown external scripts: ${unknownScripts.join(', ') || 'none'}\n` +
    `Iframes: ${signals.iframes.join(', ') || 'none'}\n` +
    `Inline-JS obfuscation score: ${signals.obfuscationScore.toFixed(2)} (0 = no eval/atob-style tokens)\n` +
    `Inline script chars: ${signals.inlineScriptChars}\n\n` +
    `HTML:\n${sampleHtml(html)}`;

  let verdict: ModerationVerdict = 'error';
  let reason = '';
  let lastFailure = 'classifier error';
  let classified = false;

  // Try each configured provider in order; on a provider-level failure (non-ok or throw)
  // fail over to the next before giving up. Preserves the fail-safe: exhausting the chain
  // returns 'error' → pending, with the last failure named.
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const res = await fetchWithTimeout(
        `${provider.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: provider.model,
            temperature: 0,
            max_tokens: 200,
            messages: [
              { role: 'system', content: systemPrompt(env) },
              { role: 'user', content: userContent },
            ],
          }),
        },
        CLASSIFIER_TIMEOUT_MS
      );
      if (!res.ok) {
        lastFailure = `classifier http ${res.status}`;
        alertProviderFailure(env, provider, lastFailure, !isLast);
        continue;
      }
      const data = (await res.json()) as OpenAIChatResponse;
      const parsed = parseVerdict(data.choices?.[0]?.message?.content ?? '');
      if (!parsed) {
        // A well-formed response we can't parse won't parse from another provider either.
        return { verdict: 'error', status: 'pending', reason: 'unparseable classifier output', contentHash: hash };
      }
      verdict = parsed.verdict;
      reason = parsed.reason;
      classified = true;
      break;
    } catch {
      lastFailure = 'classifier timeout/error';
      alertProviderFailure(env, provider, lastFailure, !isLast);
    }
  }

  if (!classified) {
    return { verdict: 'error', status: 'pending', reason: `${lastFailure} (all providers)`, contentHash: hash };
  }

  // Obfuscated inline JS the classifier rated clean is escalated to suspicious:
  // the static read can't see what the payload decodes to at runtime.
  if (verdict === 'clean' && signals.obfuscationScore >= 0.5) {
    verdict = 'suspicious';
    reason = reason ? `${reason}; obfuscated inline JS` : 'obfuscated inline JS';
  }

  return { verdict, status: verdictToStatus(verdict), reason, contentHash: hash };
}

/**
 * Load an artifact's current production entrypoint HTML from R2, classify it, and
 * persist the moderation columns. Returns the resulting status (or 'approved' when
 * there is nothing classifiable, e.g. a non-HTML artifact). Reused by the PATCH
 * visibility→public path (crud) and the re-scan cron (Workstream D3).
 */
export async function classifyAndPersist(env: Env, artifactId: string): Promise<ModerationStatus> {
  const row = await env.DB.prepare(`
    SELECT ast.r2_key, ast.mime
    FROM deployments d
    JOIN versions v ON v.id = d.version_id
    JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
    WHERE d.artifact_id = ? AND d.channel = 'production'
    LIMIT 1
  `).bind(artifactId).first<{ r2_key: string; mime: string }>();

  if (!row?.r2_key || row.mime !== 'text/html') return 'approved';

  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return 'approved';
  const html = await obj.text();

  // Skip when the content is unchanged AND already approved — so a human approval
  // (or a prior clean pass) sticks and we don't re-bill the classifier or risk a
  // flaky re-flag of identical content.
  const prior = await env.DB.prepare(
    `SELECT COALESCE(status, 'approved') AS moderation_status, content_hash AS moderation_content_hash
       FROM artifact_moderation WHERE artifact_id = ?`
  ).bind(artifactId).first<{ moderation_status: string; moderation_content_hash: string | null }>();
  const hash = await contentHash(html);
  if (prior?.moderation_status === 'approved' && prior.moderation_content_hash === hash) {
    return 'approved';
  }

  const check = await runPublishSafetyCheck(env, html);
  await setModeration(env, artifactId, {
    status: check.status,
    reason: check.reason,
    checked_at: new Date().toISOString(),
    content_hash: check.contentHash,
  });
  if (check.status === 'approved') await restoreHeldVisibility(env, artifactId);
  return check.status;
}

/**
 * Restore the visibility a publish asked for when a moderation hold forced the
 * artifact private (see migration 0132). No-op unless the row is now approved and
 * still carries a held visibility, so it is safe to call after any approve path.
 */
export async function restoreHeldVisibility(env: Env, artifactId: string): Promise<void> {
  // Read the held value before clearing it — the UPDATE below cannot carry it across.
  const row = await env.DB.prepare(
    `SELECT held_visibility FROM artifact_moderation
      WHERE artifact_id = ? AND status = 'approved' AND held_visibility IS NOT NULL`
  ).bind(artifactId).first<{ held_visibility: string | null }>();
  const held = row?.held_visibility ?? null;

  // The held visibility lives in artifact_moderation and the live one on artifacts, so
  // this is two statements. The first is the guard: it only matches a real held→restored
  // transition, and its row count is what decides whether the owner gets notified.
  const res = await env.DB.prepare(
    `UPDATE artifact_moderation SET held_visibility = NULL
       WHERE artifact_id = ? AND status = 'approved' AND held_visibility IS NOT NULL`
  ).bind(artifactId).run();
  if ((res.meta?.changes ?? 0) > 0) {
    await env.DB.prepare(
      `UPDATE artifacts SET visibility = COALESCE(?, visibility) WHERE id = ?`
    ).bind(held, artifactId).run();
  }
  // meta.changes>0 means a real held→restored transition just happened (the WHERE
  // clause is a no-op on re-calls once held_visibility is NULL — natural idempotency),
  // so the owner is notified exactly once. Best-effort; never blocks the restore.
  if ((res.meta?.changes ?? 0) > 0) {
    // Bust the cached deployment (it carries visibility + moderation state) so anon
    // visitors see the restored page now, not after the cache TTL.
    await invalidateDeploymentCacheById(env, artifactId);
    await notifyModerationResolved(env, artifactId, 'approved').catch(() => {});
  }
}

/**
 * Drop a stale hold when the owner explicitly chooses a NON-public visibility for a
 * held-from-public artifact: without this, a later re-classify would "restore" the
 * page to public against the owner's choice, and anon visitors would keep seeing the
 * under-review page. Guarded to 'pending' so a blocked takedown can never be cleared
 * by toggling visibility. Call only when the newly requested visibility is non-public.
 */
export async function clearModerationHold(env: Env, artifactId: string): Promise<void> {
  // moderation_content_hash is nulled too: the content never earned a clean verdict,
  // so a later switch back to public must re-classify instead of hash-skipping past
  // the check on the strength of this administrative 'approved'.
  const res = await env.DB.prepare(
    `UPDATE artifact_moderation SET held_visibility = NULL, status = 'approved', content_hash = NULL
       WHERE artifact_id = ? AND held_visibility IS NOT NULL AND status = 'pending'`
  ).bind(artifactId).run();
  if ((res.meta?.changes ?? 0) > 0) {
    await invalidateDeploymentCacheById(env, artifactId);
  }
}

/**
 * External CDN hosts in the production entrypoint (script <script src> and stylesheet
 * <link href>) that would be CSP-blocked on a public page. Empty when the
 * artifact has no such resources or isn't HTML. Used to reject an open-visibility
 * transition with a clear message instead of silently serving a broken page.
 */
export async function findBlockedCdnHosts(env: Env, artifactId: string): Promise<string[]> {
  const row = await env.DB.prepare(`
    SELECT ast.r2_key, ast.mime
    FROM deployments d
    JOIN versions v ON v.id = d.version_id
    JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
    WHERE d.artifact_id = ? AND d.channel = 'production'
    LIMIT 1
  `).bind(artifactId).first<{ r2_key: string; mime: string }>();

  if (!row?.r2_key || row.mime !== 'text/html') return [];
  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return [];
  const signals = extractSignals(await obj.text());
  return [
    ...new Set([
      ...findBlockedOpenScriptHosts(signals.externalScripts, env),
      ...findBlockedOpenStyleHosts(signals.externalStyles, env),
    ]),
  ];
}
