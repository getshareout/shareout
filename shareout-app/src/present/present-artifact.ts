// "Present this" — turn a published artifact into a sibling slides deck, generated
// by AI. Loads the source page's production HTML (same JOIN as auto-summary), asks
// the LLM for a strict-JSON outline, renders it into a reveal.js deck (deck-template),
// and publishes it as a NEW private HTML artifact in the source's workspace via the
// normal publish path — so slugs/versions/R2/auto-summary all behave as usual.
import type { Env } from '../types';
import { getPlatformHostname } from '../config/origins';
import type { AuthUser } from '../api-auth';
import { checkPresentLimit, incrementPresentLimit } from '../api-auth';
import { getArtifactRef, resolveAlertRole } from '../metric-alerts/access';
import { chatComplete, getAIProvider } from '../data/agent/anthropic';
import { recordAiUsage } from '../data/ai-usage';
import { publishArtifact } from '../publish/publish-artifact';
import { generateSlug } from '../validation';
import { renderDeckHtml, type Deck, type DeckSlide } from './deck-template';

const MAX_HTML_CHARS = 20_000; // keep the prompt bounded + cheap (matches auto-summary)
const MODEL_LABEL = 'present-this';
const MAX_SLIDES = 9;

const SYSTEM = `You turn a published web page (a dashboard, report, or app) into a slide deck outline.
Given the page's HTML, respond with STRICT JSON only:
{"title": string, "slides": [{"heading": string, "bullets": string[], "note": string}]}
- title: a short deck title for the whole presentation.
- slides: 5 to 9 slides. Each slide: a punchy heading, 2-5 short bullet points (plain text, no markdown), and an optional 1-2 sentence speaker "note".
- Summarize what the page shows and why it matters. Lead with the headline finding. Use concrete numbers from the page when present.
No prose outside the JSON.`;

export interface PresentResult {
  ok: boolean;
  artifact_id?: string;
  url?: string;
  error?: string;
  status?: number;
}

interface SourceRow {
  name: string;
  description: string | null;
  workspace_id: string | null;
  r2_key: string;
}

/** Strict-JSON → Deck. Returns null on anything unusable so the caller fails cleanly. */
export function parseDeck(out: string): Deck | null {
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj: { title?: unknown; slides?: unknown };
  try {
    obj = JSON.parse(out.slice(start, end + 1));
  } catch {
    return null;
  }
  const title = typeof obj.title === 'string' ? obj.title.slice(0, 200).trim() : '';
  if (!title || !Array.isArray(obj.slides)) return null;
  const slides: DeckSlide[] = [];
  for (const raw of obj.slides) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { heading?: unknown; bullets?: unknown; note?: unknown };
    const heading = typeof r.heading === 'string' ? r.heading.slice(0, 200).trim() : '';
    if (!heading) continue;
    const bullets = Array.isArray(r.bullets)
      ? r.bullets.filter((b): b is string => typeof b === 'string').map((b) => b.slice(0, 300).trim()).filter(Boolean).slice(0, 6)
      : [];
    const note = typeof r.note === 'string' ? r.note.slice(0, 600).trim() : undefined;
    slides.push({ heading, bullets, note: note || undefined });
    if (slides.length >= MAX_SLIDES) break;
  }
  if (!slides.length) return null;
  return { title, slides };
}

async function loadUser(env: Env, userId: string): Promise<AuthUser> {
  const row = await env.DB.prepare('SELECT email, username FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null; username: string | null }>();
  return { id: userId, email: row?.email ?? null, username: row?.username ?? null };
}

export async function presentArtifact(
  env: Env,
  userId: string,
  artifactId: string,
  executionCtx?: ExecutionContext,
): Promise<PresentResult> {
  // Access re-check: only someone who can already see the source artifact may deck it.
  const ref = await getArtifactRef(env, artifactId);
  if (!ref) return { ok: false, error: 'Artifact not found', status: 404 };
  if (!(await resolveAlertRole(env, ref, userId))) {
    return { ok: false, error: 'Permission denied: no access to this artifact', status: 403 };
  }

  // Consume quota only on accepted attempts (past auth + access), before the LLM
  // call — caps LLM spend and artifact creation per work/abuse gap tracked post-#857.
  const user = await loadUser(env, userId);
  const limit = await checkPresentLimit(env, userId, user.email);
  if (!limit.allowed) {
    return { ok: false, error: 'Deck limit reached — try again in an hour.', status: 429 };
  }
  await incrementPresentLimit(env, userId, user.email);

  if (!getAIProvider(env)) {
    return { ok: false, error: 'AI is not configured, so decks cannot be generated.', status: 502 };
  }

  // Source page HTML + metadata (same production-entrypoint JOIN as auto-summary).
  // ponytail: HTML text only — the same signal auto-summary already trusts. Table
  // aggregates skipped; add via evaluateMetric (metric-alerts/sources) if decks need live figures.
  const src = await env.DB.prepare(`
    SELECT a.name, a.description, a.workspace_id, ast.r2_key
      FROM artifacts a
      JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      JOIN versions v ON v.id = d.version_id
      JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
     WHERE a.id = ? AND ast.mime = 'text/html'
  `).bind(artifactId).first<SourceRow>();
  if (!src) return { ok: false, error: 'This artifact has no page to present.', status: 400 };

  const obj = await env.ARTIFACTS.get(src.r2_key);
  if (!obj) return { ok: false, error: 'This artifact has no page to present.', status: 400 };
  const html = (await obj.text()).slice(0, MAX_HTML_CHARS);

  const userMsg = [
    `Source page title: ${src.name}`,
    src.description ? `Description: ${src.description}` : '',
    '',
    'HTML:',
    html,
  ].filter(Boolean).join('\n');

  let out: string;
  try {
    out = await chatComplete(env, [{ role: 'user', content: userMsg }], SYSTEM, 1500);
  } catch {
    return { ok: false, error: 'Could not generate the deck (AI request failed). No deck was created.', status: 502 };
  }

  const deck = parseDeck(out);
  if (!deck) {
    return { ok: false, error: 'Could not generate the deck (unusable AI output). No deck was created.', status: 502 };
  }

  await recordAiUsage(env, {
    workspaceId: src.workspace_id, userId,
    kind: 'present_this', model: MODEL_LABEL,
    units: Math.ceil((userMsg.length + out.length) / 4), unitKind: 'tokens',
    baseCostMicroUsd: Math.round((userMsg.length / 4) * 0.0025 + (out.length / 4) * 0.01),
    source: artifactId,
  }).catch(() => {});

  const title = `${src.name} — deck`;
  const res = await publishArtifact(env, user, {
    name: title,
    slug: generateSlug(title),
    entrypoint: 'index.html',
    files: [{ path: 'index.html', content: renderDeckHtml(deck, getPlatformHostname(env)), mime: 'text/html' }],
    visibility: 'private',
    authMethod: 'google',
    shareWith: [],
    credentials: [],
    workspaceId: src.workspace_id ?? null,
    folderId: null,
    artifactType: 'html',
  }, executionCtx);

  return {
    ok: true,
    artifact_id: res.artifact.id,
    url: res.deployment.subdomain_url || res.deployment.url,
  };
}
