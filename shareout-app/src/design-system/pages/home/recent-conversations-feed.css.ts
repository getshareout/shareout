/**
 * Home page styles — Recent conversations feed
 * @module design-system/pages/home/recent-conversations-feed
 */

/** CSS rules for: Recent conversations feed */
export const recentConversationsFeedStyles = `/* ── Recent conversations feed ──────────────────────── */
.conv-feed { display: flex; flex-direction: column; }
.conv-item { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.6rem 0; border-bottom: 1px solid var(--glass-border); text-decoration: none; color: inherit; }
.conv-item:last-child { border-bottom: none; }
.conv-item:hover { background: rgba(255, 255, 255, 0.45); }
.conv-dot { width: 7px; height: 7px; margin-top: 0.4rem; border-radius: 50%; background: var(--color-primary); flex-shrink: 0; }
.conv-dot.resolved { background: var(--color-success); }
.conv-body { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; flex: 1; }
.conv-line { font-size: 0.82rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-line strong { font-weight: 600; color: var(--color-text); }
.conv-snippet { font-size: 0.82rem; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-time { font-size: 0.78rem; color: var(--color-text-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 0; }

`;
