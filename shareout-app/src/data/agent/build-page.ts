/**
 * Shared page-build primitives — the build agent's system prompt and HTML
 * post-processing, used by both the /create flow (streaming) and the chat
 * assistant's create_artifact tool (whole-page generate-then-publish).
 */
import { rewriteSkillOrigin } from '../../skill-origin';
import type { AiMeter } from '../ai-usage';
import type { Env } from '../../types';
import { SDK_REFERENCE } from './sdk-reference.generated';
import { chatComplete, getBuildConfig } from './anthropic';

export const BUILD_MAX_TOKENS = 12000;

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
  const full = await chatComplete(
    env,
    meter,
    [{ role: 'user', content: prompt }],
    system,
    BUILD_MAX_TOKENS,
    getBuildConfig(env)
  );
  return extractHtml(full);
}
