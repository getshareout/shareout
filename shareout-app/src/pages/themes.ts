/**
 * Starter packs — visual aesthetic directions offered on the create page before the
 * first build. Each pack carries a `directive` (folded into the build prompt server-side)
 * and `swatch` colors used to render its preview card. Distilled from the design skills
 * in .agents/skills (frontend-design, premium-frontend-ui, designing-beautiful-websites).
 */

export interface StarterPack {
  id: string;
  name: string;
  blurb: string;
  /** [background, foreground/accent, secondary accent] used for the card preview swatch. */
  swatch: [string, string, string];
  /** Precise style instruction injected into the build prompt when chosen. */
  directive: string;
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'editorial-brutalism',
    name: 'Editorial Brutalism',
    blurb: 'Oversized type, raw grid, high contrast.',
    swatch: ['#111111', '#f5f3ee', '#ff4d2e'],
    directive:
      'Editorial Brutalism: high-contrast monochrome palette with one sharp accent, oversized display typography (clamp up to 12vw), exposed grid lines, sharp rectangular edges, generous negative space. Pair a characterful display serif or grotesque with a crisp body. Avoid rounded corners and soft shadows.',
  },
  {
    id: 'organic-fluidity',
    name: 'Organic Fluidity',
    blurb: 'Soft gradients, glass, springy motion.',
    swatch: ['#f3eefc', '#3b2d68', '#a78bfa'],
    directive:
      'Organic Fluidity: soft layered gradients, deeply rounded corners, frosted glassmorphism (backdrop-filter blur with ultra-thin translucent borders), gentle spring-based motion on entrance and hover. Warm, cohesive palette — never a flat purple-on-white gradient. Use a friendly rounded display font.',
  },
  {
    id: 'cyber-technical',
    name: 'Cyber / Technical',
    blurb: 'Dark mode, neon accents, mono type.',
    swatch: ['#0a0e14', '#e6f1ff', '#39ff14'],
    directive:
      'Cyber / Technical: dark-mode dominance, a single glowing neon accent, monospaced or technical typography, fine grid and rule lines, rapid staggered reveal animations, subtle scanline or noise texture. Keep it precise and engineered, not cluttered.',
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Full-bleed imagery, slow fades, depth.',
    swatch: ['#1a1714', '#f7f2ea', '#c9a227'],
    directive:
      'Cinematic: full-viewport (100dvh) hero, slow cross-fades and scroll-driven storytelling, profound negative space, layered depth with parallax, restrained warm palette with a metallic or muted accent. Headlines broken by word/line for cascading entrance reveals.',
  },
  {
    id: 'refined-minimal',
    name: 'Refined Minimal',
    blurb: 'Quiet, precise, beautifully spaced.',
    swatch: ['#ffffff', '#1c1917', '#2563eb'],
    directive:
      'Refined Minimal: restraint and precision over decoration. A disciplined spacing rhythm, a tight type scale with strong weight contrast, one calm accent, near-invisible borders (use spacing and subtle background shifts to group). Elegance from execution, not effects.',
  },
  {
    id: 'playful-toy',
    name: 'Playful / Toy',
    blurb: 'Bold color, chunky shapes, bounce.',
    swatch: ['#fff7d6', '#ff5d8f', '#3ad6c4'],
    directive:
      'Playful / Toy: saturated multi-color palette, chunky rounded shapes, thick outlines, sticker-like depth, bouncy micro-interactions and tactile hover states. Expressive display font. Keep hierarchy clear despite the energy.',
  },
];

/** "No preference" pack — lets the build agent commit to a bold direction itself. */
export const SURPRISE_DIRECTIVE =
  'No fixed theme was chosen. Commit boldly to ONE distinctive aesthetic direction that genuinely fits this content and audience — do not default to a safe, generic look.';

export function getPackDirective(id: string | undefined): string {
  if (!id || id === 'surprise') return SURPRISE_DIRECTIVE;
  return STARTER_PACKS.find((p) => p.id === id)?.directive || SURPRISE_DIRECTIVE;
}
