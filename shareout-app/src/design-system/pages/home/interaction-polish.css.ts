/**
 * Home page styles — Interaction polish
 * @module design-system/pages/home/interaction-polish
 */

/** CSS rules for: Interaction polish */
export const interactionPolishStyles = `/* ── Interaction polish ──────────────────────────────────────────────────
   Unifies transitions and adds subtle lift-on-hover / press-on-active across
   the home's buttons, tabs, nav items and cards (Design: lift 1-2px, press
   ~0.97, reveal not bounce). Appended last so it layers over the base rules. */
.nav-item, .admin-tab, .member-act, .cmdbar-btn, .view-btn, .sort-trigger,
.search-clear, .card-action-btn, .rail-toggle, .account-signout, .wsc-act,
.ws-job-art, .detail-icon, .so-c-btn {
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease,
              border-color var(--duration-fast) ease, transform var(--duration-fast) ease,
              box-shadow var(--duration-fast) ease, filter var(--duration-fast) ease;
}
/* Rail nav + filters: firmer hover wash, a gentle slide, and a clear press. */
.nav-item:hover { background: var(--glass-bg-hover); transform: translateX(2px); }
.nav-item:hover svg { opacity: 1; }
.nav-item:active { transform: translateX(2px) scale(0.985); }
.nav-item.active:hover { background: var(--color-primary-light); }
/* Admin tabs: a soft pill on hover above the active underline. */
.admin-tab { border-top-left-radius: var(--radius-sm); border-top-right-radius: var(--radius-sm); }
.admin-tab:hover { background: var(--glass-bg); }
/* Toolbar controls: lift + soft shadow on hover. */
.sort-trigger:hover { transform: translateY(-1px); box-shadow: var(--shadow-sm); }
.view-btn:hover { background: var(--glass-bg); color: var(--color-text); }
/* Action chips/buttons: lift on hover, press in on click. */
.member-act:hover, .cmdbar-btn:hover, .wsc-act:hover { transform: translateY(-1px); }
.member-act:active, .cmdbar-btn:active, .wsc-act:active { transform: translateY(0) scale(0.96); }
/* Card quick-actions: a touch springier. */
.card-action-btn:hover { transform: scale(1.08); }
.card-action-btn:active { transform: scale(0.9); }
/* Primary / CTA buttons: press feedback; secondary buttons lift slightly. */
.rail-create:active, .empty-cta:active,
.so-c-btn--primary:active, .so-c-btn--secondary:active, .so-c-btn--danger:active { transform: translateY(0) scale(0.97); }
.so-c-btn--secondary:not(:disabled):hover { transform: translateY(-1px); }
@media (prefers-reduced-motion: reduce) {
  .nav-item:hover, .nav-item:active, .sort-trigger:hover, .member-act:hover,
  .member-act:active, .cmdbar-btn:hover, .cmdbar-btn:active, .wsc-act:hover,
  .wsc-act:active, .card-action-btn:hover, .card-action-btn:active,
  .rail-create:active, .empty-cta:active,
  .so-c-btn--primary:active, .so-c-btn--secondary:active, .so-c-btn--danger:active,
  .so-c-btn--secondary:not(:disabled):hover { transform: none; }
}

`;
