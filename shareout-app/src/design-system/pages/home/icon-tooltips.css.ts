/**
 * Home page styles — Icon tooltips
 * @module design-system/pages/home/icon-tooltips
 */

/** CSS rules for: Icon tooltips */
export const iconTooltipsStyles = `/* ── Icon tooltips ───────────────────────────────────────────────────────
   One fixed-position bubble, driven by each icon's title/aria-label (see the
   delegated engine in events.ts). Fixed so it never clips inside the card
   hover overlay or the detail drawer. */
.so-tip {
  position: fixed; z-index: 4000; pointer-events: none; left: 0; top: 0;
  padding: 5px 9px; border-radius: 8px;
  background: rgba(28, 25, 23, 0.92); color: var(--color-text-inverse);
  font-size: 0.74rem; font-weight: 600; line-height: 1.3; white-space: nowrap;
  box-shadow: 0 6px 18px -6px rgba(0, 0, 0, 0.45);
  opacity: 0; transform: translateY(3px);
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.so-tip.show { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .so-tip { transition: opacity 0.12s ease; } }

`;
