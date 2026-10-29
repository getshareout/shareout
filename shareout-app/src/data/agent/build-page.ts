/**
 * Shared page-build primitives — the build agent's system prompt and HTML
 * post-processing, used by both the /create flow (streaming) and the chat
 * assistant's create_artifact tool (whole-page generate-then-publish).
 */
import { rewriteSkillOrigin } from '../../skill-origin';
import type { AiMeter } from '../ai-usage';
import { BUDGET_CODE, WorkspaceBudgetError } from '../ai-budget';
import type { Env } from '../../types';
import { SDK_REFERENCE } from './sdk-reference.generated';
import { streamChat, getBuildConfig, type AIConfig } from './anthropic';
import type { LocaleCopy } from '../../i18n';
import { createLogger } from '../../logging';
import { alertOps } from '../../support/alert';

/** Output cap per build turn. Typical AI-built pages run 9–12k tokens (2026-10: 2 of 4 prod builds hit the old 12k cap). */
export const BUILD_MAX_TOKENS = 32000;
/** Extra turns a build may take when the model stops at BUILD_MAX_TOKENS mid-page. */
export const BUILD_CONTINUATIONS = 2;
export const BUILD_TRUNCATED_CODE = 'BUILD_TRUNCATED';

export type BuildFailure = 'truncated' | 'snag' | 'empty' | 'publishFailed' | 'generic';

/** What a failed page build tells the person who asked for it. */
export const BUILD_FAILURE_COPY: LocaleCopy<Record<BuildFailure, string>> = {
  en: {
    truncated: 'That page came out too long to finish in one go, so nothing was published. Ask for a simpler version, or build it in parts.',
    snag: 'The builder hit a snag — try again.',
    empty: 'I couldn’t build that — try rephrasing.',
    publishFailed: 'Built it, but publishing failed. Try again.',
    generic: 'Something went wrong — try again.',
  },
  es: {
    truncated: 'La página salió demasiado larga para terminarla, así que no se publicó nada. Pedí una versión más simple o armala por partes.',
    snag: 'Falló el armado de la página. Probá de nuevo.',
    empty: 'No pude armar eso. Probá contándolo de otra forma.',
    publishFailed: 'La armé, pero no se pudo publicar. Probá de nuevo.',
    generic: 'Algo salió mal. Probá de nuevo.',
  },
};

export const BUILD_TRUNCATED_MESSAGE = BUILD_FAILURE_COPY.en.truncated;

const CONTINUE_PROMPT =
  'Your output was cut off at the length limit. Continue exactly where you stopped: output only the rest of the document, starting with the very next character. No repetition, no commentary, no code fences.';

/** The page was still cut off after the last continuation — publishing it would ship broken markup/JS. */
export class BuildTruncatedError extends Error {
  readonly code = BUILD_TRUNCATED_CODE;
  constructor() {
    super(BUILD_TRUNCATED_MESSAGE);
  }
}

export type BuildChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; raw: string }
  | { type: 'error'; error: string; code?: string; resets_at?: string };

type BuildMessage = { role: 'user' | 'assistant'; content: string };

const START_FENCE = /^\s*```[\w-]*[^\S\n]*\n?/;
const END_FENCE = /\n?```\s*$/;
const DOC_START = /^\s*(<!doctype html|<html[\s>])/i;

/**
 * Stream one page build. When the model stops at the output cap, ask it to continue
 * (up to BUILD_CONTINUATIONS more turns) and stitch the parts, so a long page is never
 * published cut off mid-<script> — a page like that is one big SyntaxError with every
 * button dead and no error shown. Yields deltas as they arrive (continuations included),
 * then `done` with the whole raw text, or `error` (BUILD_TRUNCATED_CODE when it is still
 * cut off after the last turn). Every turn goes through streamChat, so each is metered.
 */
export async function* streamBuild(
  env: Env,
  meter: AiMeter,
  messages: BuildMessage[],
  systemPrompt: string,
  config: AIConfig | null,
): AsyncGenerator<BuildChunk> {
  let raw = '';
  for (let turn = 0; turn <= BUILD_CONTINUATIONS; turn++) {
    const convo = turn === 0 ? messages : [...messages, { role: 'assistant' as const, content: raw }, { role: 'user' as const, content: CONTINUE_PROMPT }];
    let part = '';
    // Continuations hold back their head until we know whether they append or restart.
    let decided = turn === 0;
    let restart = false;
    let truncated = false;
    for await (const chunk of streamChat(env, meter, convo, systemPrompt, '', BUILD_MAX_TOKENS, config)) {
      if (chunk.type === 'error') {
        // A workspace over its AI budget is the workspace's limit, not a broken build.
        if (chunk.code !== BUDGET_CODE) await reportBuildFailure(env, meter, 'snag', messages, chunk.error);
        yield { type: 'error', error: chunk.error || 'AI stream error', code: chunk.code, resets_at: chunk.resets_at };
        return;
      }
      if (chunk.type === 'done') { truncated = !!chunk.truncated; continue; }
      if (!chunk.content) continue;
      part += chunk.content;
      if (!decided) {
        const head = part.replace(START_FENCE, '');
        if (head.trim().length < 16) continue;
        decided = true;
        restart = DOC_START.test(head);
        if (!restart) yield { type: 'delta', text: head };
        continue;
      }
      if (!restart) yield { type: 'delta', text: chunk.content };
    }
    if (turn === 0) raw = part;
    else {
      let cont = part.replace(START_FENCE, '');
      // A fenced first turn keeps its closing fence for extractHtml; otherwise drop a stray one.
      if (!raw.trimStart().startsWith('```')) cont = cont.replace(END_FENCE, '');
      if (!decided && cont) yield { type: 'delta', text: cont };
      raw = restart ? cont : raw + cont;
    }
    if (!truncated) {
      yield { type: 'done', raw };
      return;
    }
  }
  await reportBuildFailure(env, meter, 'truncated', messages, `still cut off after ${BUILD_CONTINUATIONS} continuations (${raw.length} chars)`);
  yield { type: 'error', error: BUILD_TRUNCATED_MESSAGE, code: BUILD_TRUNCATED_CODE };
}

/**
 * A build that failed for the builder's own reasons (cut off, model error) is ours to fix,
 * not only the user's: log it and ping the operator. Never throws.
 */
async function reportBuildFailure(
  env: Env,
  meter: AiMeter,
  failure: 'truncated' | 'snag',
  messages: BuildMessage[],
  detail?: string,
): Promise<void> {
  const prompt = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  createLogger(env, { scope: 'page_build', event: `build.${failure}` }).warn('page build failed', {
    workspaceId: meter.workspaceId, userId: meter.userId, source: meter.source, detail,
  });
  await alertOps(env, `⚠️ Page build failed: ${failure === 'truncated' ? 'cut off at the output cap' : 'model error'}`, [
    `From: ${meter.userId ?? 'anonymous'} · workspace ${meter.workspaceId ?? '—'} · via ${meter.source ?? 'build'}`,
    detail ? `Detail: ${detail}` : '',
    `Asked for: ${prompt.slice(0, 200)}${prompt.length > 200 ? '…' : ''}`,
  ]);
}

const BASE_SYSTEM_PROMPT = `You are ShareOut's build agent. You turn a user's request into ONE complete, self-contained HTML document that gets published live on ShareOut.

Output contract:
- Output ONLY the HTML document. No markdown, no code fences, no commentary.
- Start with <!DOCTYPE html> and include <html>, <head>, and <body>.
- Inline your own CSS in a <style> tag and JS in a <script> tag. External files are limited to the ShareOut /sdk files and /vendor libraries below (plus Google Fonts stylesheets).
- Third-party libraries load root-relative from this instance, never a public CDN: /vendor/<npm package>@<version>/<file in the package> (jsDelivr's layout without the host and /npm), e.g. <script src="/vendor/d3@7/dist/d3.min.js"></script>. This works on private, workspace and public pages alike.
- Make it polished, modern, and responsive. Use real, sensible placeholder content — never lorem ipsum.
- When the user asks for a change, return the FULL updated document, not a diff.

ShareOut capabilities — what turns a static page into a live app:
Pages you publish run on ShareOut and can use the ShareOut SDK to persist data, store structured records, collaborate in real time, upload files, send email, and run an AI chat — with no backend to set up.

Use the SDK ONLY when the page genuinely benefits from it — anything that should save state, remember entries across visits, sync live between viewers, accept file uploads, or chat. For purely static or presentational pages, skip the SDK entirely and keep the output clean.

When you DO use it:
- Load it root-relative before your own script: <script src="/sdk/shareout.js"></script>
- Initialize once, inside an async function: const sdk = await ShareOut.create();
- It auto-detects the published artifact, so data persists per page automatically with no config.
- Call only methods listed in the SDK reference below.
- Degrade gracefully: render usable UI before data loads and handle empty states.

`;

// Distilled from the design skills in .agents/skills (frontend-design,
// premium-frontend-ui, designing-beautiful-websites). Baked into every build so the
// agent designs with a strong point of view instead of generic "AI slop".
const DESIGN_SYSTEM_PROMPT = `
Design standards — every page must look intentionally designed, not template-generated:

Commit to a direction. Pick ONE clear aesthetic (e.g. editorial brutalism, organic fluidity, cyber/technical, cinematic, refined minimal, playful) and execute it with precision. Bold maximalism and refined minimalism both work — intentionality matters more than intensity. If the user picked a design direction, honor it fully.

Typography. Choose distinctive, characterful fonts (load from Google Fonts when useful). Pair a display font with a clean body font. Use a real type scale with strong size/weight contrast — hero headlines large (clamp), body crisp at 16-18px, line-height ~1.5-1.7, readable line length.

Color & theme. Link <link rel="stylesheet" href="/sdk/shareout.css"> and build on its design-token CSS variables so the page follows the workspace's design. Dominant colors with sharp, sparing accents beat timid, evenly-spread ones.

Layout & hierarchy. Every screen must answer at a glance: what is this, what's the primary action, what's secondary. Use a spacing scale (4/8/12/16/24/32/48/64/96); more space BETWEEN groups than within them. Consider asymmetry, overlap, and generous negative space — but keep the next action obvious.

Motion & depth. Animate only transform and opacity (never width/height/top/margin). One well-orchestrated page-load with staggered reveals beats scattered micro-interactions. Add atmosphere — gradient meshes, subtle noise/grain, dramatic shadows, frosted glass — over flat solid fills. Wrap heavy motion in @media (prefers-reduced-motion: no-preference) and pointer-dependent effects in @media (hover: hover).

States. Design empty, loading, and error states deliberately — an empty state is a first impression. Maintain ≥4.5:1 text contrast and visible focus styles.

Never ship AI-slop defaults: no Inter/Roboto/Arial/system-font-only type, no purple gradient on white, no cookie-cutter centered-hero-three-cards layout. Make one memorable, context-specific choice per page.
`;

let cachedSystemPrompt: string | null = null;

/** The full build-agent system prompt: contract + design standards + generated SDK reference. */
export async function buildSystemPrompt(env: Env): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  // Every URL in the prompt is root-relative; the rewrite keeps any founder-host
  // literal from pointing a self-hosted instance's pages at someone else's server.
  cachedSystemPrompt = rewriteSkillOrigin(
    `${BASE_SYSTEM_PROMPT}${DESIGN_SYSTEM_PROMPT}\n${SDK_REFERENCE}`,
    env,
  );
  return cachedSystemPrompt;
}

/** Normalize model output into a full HTML document, stripping any stray code fence. */
export function extractHtml(raw: string): string {
  let s = (raw || '').trim();
  const fence = s.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  if (/<!doctype html>|<html[\s>]/i.test(s)) return s;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${s}</body></html>`;
}

/** A short page name derived from the build prompt. */
export function deriveName(prompt: string): string {
  const words = prompt.replace(/[\n\r]+/g, ' ').trim().split(/\s+/).slice(0, 6).join(' ');
  const name = words.slice(0, 60).trim();
  return name || 'My Project';
}

/**
 * Generate one self-contained HTML document for a build prompt and return it.
 * Whole-page (non-streaming) — used where there's no live stream to the client
 * (the chat assistant's create_artifact confirm step).
 */
export async function generateArtifactHtml(env: Env, prompt: string, meter: AiMeter): Promise<string> {
  const system = await buildSystemPrompt(env);
  for await (const chunk of streamBuild(env, meter, [{ role: 'user', content: prompt }], system, getBuildConfig(env))) {
    if (chunk.type === 'done') return extractHtml(chunk.raw);
    if (chunk.type === 'error') {
      if (chunk.code === BUDGET_CODE) throw new WorkspaceBudgetError(chunk.resets_at ?? '');
      if (chunk.code === BUILD_TRUNCATED_CODE) throw new BuildTruncatedError();
      throw new Error(chunk.error);
    }
  }
  throw new Error('AI stream ended without a page');
}
