/**
 * Shared page-build primitives — the build agent's system prompt and HTML
 * post-processing, used by both the /create flow (streaming) and the chat
 * assistant's create_artifact tool (whole-page generate-then-publish).
 */
import { rewriteSkillOrigin } from '../../skill-origin';
import type { Env } from '../../types';
import { getSkillDocs } from './context';
import { chatComplete, getBuildConfig } from './anthropic';

export const BUILD_MAX_TOKENS = 12000;

const BASE_SYSTEM_PROMPT = `You are ShareOut's build agent. You turn a user's request into ONE complete, self-contained HTML document that gets published live on ShareOut.

Output contract:
- Output ONLY the HTML document. No markdown, no code fences, no commentary.
- Start with <!DOCTYPE html> and include <html>, <head>, and <body>.
- Inline all CSS in a <style> tag and all JS in a <script> tag. Do not reference external files (the SDK below is the one exception).
- You may load assets/libraries from public CDNs via <link>/<script src> when genuinely needed. On PUBLIC/UNLISTED pages, use a reputable allowlisted CDN — jsDelivr, unpkg, cdnjs, esm.sh, Skypack, ajax.googleapis.com, cdn.tailwindcss.com, code.jquery.com, d3js.org, cdn.plot.ly (these cover most libraries). A CDN outside that allowlist is CSP-blocked on open pages and only works on private pages, so prefer an allowlisted host or inline the library.
- Make it polished, modern, and responsive. Use real, sensible placeholder content — never lorem ipsum.
- When the user asks for a change, return the FULL updated document, not a diff.

ShareOut capabilities — what turns a static page into a live app:
Pages you publish run on ShareOut and can use the ShareOut SDK to persist data, store structured records, collaborate in real time, upload files, send email, and run an AI chat — with no backend to set up.

Use the SDK ONLY when the page genuinely benefits from it — anything that should save state, remember entries across visits, sync live between viewers, accept file uploads, or chat. For purely static or presentational pages, skip the SDK entirely and keep the output clean.

When you DO use it:
- Load it before your own script: <script src="https://shareout.site/sdk/v1/shareout.js"></script>
- Initialize once: const shareout = new ShareOut();
- It auto-detects the published artifact, so data persists per page automatically with no config.
- Degrade gracefully: render usable UI before data loads and handle empty states.

`;

// Distilled from the design skills in .agents/skills (frontend-design,
// premium-frontend-ui, designing-beautiful-websites). Baked into every build so the
// agent designs with a strong point of view instead of generic "AI slop".
const DESIGN_SYSTEM_PROMPT = `
Design standards — every page must look intentionally designed, not template-generated:

Commit to a direction. Pick ONE clear aesthetic (e.g. editorial brutalism, organic fluidity, cyber/technical, cinematic, refined minimal, playful) and execute it with precision. Bold maximalism and refined minimalism both work — intentionality matters more than intensity. If the user picked a design direction, honor it fully.

Typography. Choose distinctive, characterful fonts (load from Google Fonts when useful). Pair a display font with a clean body font. Use a real type scale with strong size/weight contrast — hero headlines large (clamp), body crisp at 16-18px, line-height ~1.5-1.7, readable line length.

Color & theme. Commit to a cohesive palette via CSS variables. Dominant colors with sharp, sparing accents beat timid, evenly-spread ones. Vary light/dark across pages — do not default to the same look every time.

Layout & hierarchy. Every screen must answer at a glance: what is this, what's the primary action, what's secondary. Use a spacing scale (4/8/12/16/24/32/48/64/96); more space BETWEEN groups than within them. Consider asymmetry, overlap, and generous negative space — but keep the next action obvious.

Motion & depth. Animate only transform and opacity (never width/height/top/margin). One well-orchestrated page-load with staggered reveals beats scattered micro-interactions. Add atmosphere — gradient meshes, subtle noise/grain, dramatic shadows, frosted glass — over flat solid fills. Wrap heavy motion in @media (prefers-reduced-motion: no-preference) and pointer-dependent effects in @media (hover: hover).

States. Design empty, loading, and error states deliberately — an empty state is a first impression. Maintain ≥4.5:1 text contrast and visible focus styles.

Never ship AI-slop defaults: no Inter/Roboto/Arial/system-font-only type, no purple gradient on white, no cookie-cutter centered-hero-three-cards layout. Make one memorable, context-specific choice per page.
`;

let cachedSystemPrompt: string | null = null;

/** The full build-agent system prompt: contract + design standards + live skill docs. */
export async function buildSystemPrompt(env: Env): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const skillDocs = await getSkillDocs(env);
  // The prompt names the SDK URL literally. Unrewritten, every page this builder
  // produces on a self-hosted instance loads its SDK from the founder's server.
  cachedSystemPrompt = rewriteSkillOrigin(
    `${BASE_SYSTEM_PROMPT}${DESIGN_SYSTEM_PROMPT}\n${skillDocs}`,
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
export async function generateArtifactHtml(env: Env, prompt: string): Promise<string> {
  const system = await buildSystemPrompt(env);
  const full = await chatComplete(
    env,
    [{ role: 'user', content: prompt }],
    system,
    BUILD_MAX_TOKENS,
    getBuildConfig(env)
  );
  return extractHtml(full);
}
