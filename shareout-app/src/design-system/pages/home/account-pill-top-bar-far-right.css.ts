/**
 * Home page styles — Account pill (top bar, far right)
 * @module design-system/pages/home/account-pill-top-bar-far-right
 */

/** CSS rules for: Account pill (top bar, far right) */
export const accountPillTopBarFarRightStyles = `/* ── Account pill (top bar, far right) ──────────────── */
.account {
  position: relative; z-index: 300;
  margin-left: auto; flex-shrink: 0;
  display: flex; align-items: center; gap: 0.625rem;
  padding: 7px 10px 7px 8px;
  border-radius: var(--radius-full);
}
.user-avatar {
  position: relative; z-index: 1;
  width: 32px; height: 32px;
  border-radius: 50%;
  border: none; padding: 0; cursor: pointer;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 0.8rem;
  overflow: hidden; flex-shrink: 0;
}
.user-avatar:hover { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7); }
.user-avatar img { width: 100%; height: 100%; object-fit: cover; }
.user-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }
.account-signout {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border-radius: 50%;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: background var(--duration-normal), color var(--duration-normal);
}
.account-signout svg { width: 16px; height: 16px; }
.account-signout:hover { background: rgba(255, 255, 255, 0.7); color: var(--color-text); }

.notif { position: relative; display: flex; align-items: center; }
.notif-btn {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0; cursor: pointer;
  border: none; background: transparent; border-radius: 50%;
  color: var(--color-text-secondary);
  transition: background var(--duration-normal), color var(--duration-normal);
}
.notif-btn:hover { background: rgba(255, 255, 255, 0.7); color: var(--color-text); }
.notif-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.notif-btn svg { width: 18px; height: 18px; }
.notif-badge {
  position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px;
  padding: 0 4px; border-radius: var(--radius-full);
  background: var(--color-error); color: var(--color-text-inverse);
  font-size: 0.68rem; font-weight: 700; line-height: 16px; text-align: center;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--color-bg-elevated);
}
.notif-badge[hidden] { display: none; }
.notif-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 1400;
  width: 340px; max-width: calc(100vw - 24px);
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  padding: 1rem 1.1rem 1.1rem; animation: menu-pop 0.13s ease;
}
.notif-menu[hidden] { display: none; }
.notif-head { display: flex; align-items: center; justify-content: space-between; }
.notif-title { margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--color-text); }
.notif-sub { margin: 0.25rem 0 0.75rem; font-size: 0.8rem; color: var(--color-text-tertiary); }
.notif-menu .ws-jobs-list { max-height: min(60vh, 440px); overflow-y: auto; }

/* Brand lockup (sidebar) */
.brand {
  display: inline-flex; align-items: center; gap: 10px;
  text-decoration: none; color: inherit;
}
.brand-mark { display: block; width: 28px; height: 28px; flex-shrink: 0; }
.brand-name {
  font: 700 1.05rem var(--font-display);
  letter-spacing: -0.02em;
  color: var(--color-primary);
  line-height: 1;
}
.brand-ws-logo { display: block; height: 44px; max-width: 200px; width: auto; object-fit: contain; }

/* Stat strip */
.stat-strip { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.stat-pill {
  display: flex; align-items: baseline; gap: 0.4rem;
  padding: 7px 14px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-full);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
}
.stat-pill-value { font-weight: 700; font-size: 0.95rem; color: var(--color-text); letter-spacing: -0.01em; }
.stat-pill-label { font-size: 0.78rem; color: var(--color-text-tertiary); }

`;
