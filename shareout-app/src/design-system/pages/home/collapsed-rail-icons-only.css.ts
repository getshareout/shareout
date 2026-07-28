/**
 * Home page styles — Collapsed rail (icons only)
 * @module design-system/pages/home/collapsed-rail-icons-only
 */

/** CSS rules for: Collapsed rail (icons only) */
export const collapsedRailIconsOnlyStyles = `/* ── Collapsed rail (icons only) ────────────────────── */
@media (min-width: 961px) {
  html.rail-collapsed .shell { grid-template-columns: 76px 1fr; }
  html.rail-collapsed .rail {
    padding-left: var(--space-3); padding-right: var(--space-3);
    align-items: center;
  }
  html.rail-collapsed .rail-brand { justify-content: center; }
  html.rail-collapsed .rail-brand .brand,
  html.rail-collapsed .rail-create-label,
  html.rail-collapsed .nav-label,
  html.rail-collapsed .nav-count,
  html.rail-collapsed .rail-group-title { display: none; }
  html.rail-collapsed .rail-create {
    width: 44px; height: 44px; padding: 0; align-self: center;
  }
  html.rail-collapsed .nav-item { justify-content: center; padding: 10px; }
  html.rail-collapsed .ws-expand, html.rail-collapsed .ws-folders { display: none; }
  html.rail-collapsed .rail-toggle svg { transform: scaleX(-1); }
}

`;
