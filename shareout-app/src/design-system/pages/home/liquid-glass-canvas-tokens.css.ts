/**
 * Home page styles — Liquid glass canvas tokens
 * @module design-system/pages/home/liquid-glass-canvas-tokens
 */

/** CSS rules for: Liquid glass canvas tokens */
export const liquidGlassCanvasTokensStyles = `/* ── Liquid glass canvas tokens ─────────────────────── */
:root {
  --glass-bg: rgba(255, 255, 255, 0.46);
  --glass-bg-strong: rgba(255, 255, 255, 0.62);
  --glass-bg-hover: rgba(255, 255, 255, 0.74);
  --glass-border: rgba(255, 255, 255, 0.6);
  --glass-blur: blur(18px) saturate(180%);
  --glass-blur-lg: blur(26px) saturate(185%);
  --glass-shadow:
    0 14px 44px -16px rgba(28, 25, 23, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 1px rgba(255, 255, 255, 0.22);
  --glass-highlight: linear-gradient(120deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.30) 100%);
}

body {
  font-family: var(--font-body);
  color: var(--color-text);
  line-height: 1.5;
  background:
    radial-gradient(1200px 780px at 82% -10%, var(--color-primary-light) 0%, transparent 56%),
    radial-gradient(1000px 720px at 4% 2%, color-mix(in srgb, var(--color-warning-light) 55%, var(--color-bg)) 0%, transparent 54%),
    radial-gradient(900px 900px at 50% 118%, color-mix(in srgb, var(--color-success-light) 40%, var(--color-bg)) 0%, transparent 60%),
    var(--color-bg);
  background-attachment: fixed;
}

`;
