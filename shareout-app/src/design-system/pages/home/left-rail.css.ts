/**
 * Home page styles — Left rail
 * @module design-system/pages/home/left-rail
 */

/** CSS rules for: Left rail */
export const leftRailStyles = `/* ── Left rail ──────────────────────────────────────── */
.rail {
  position: sticky;
  top: var(--space-4);
  align-self: start;
  height: calc(100vh - var(--space-4) * 2);
  margin: var(--space-4) 0 var(--space-4) var(--space-4);
  overflow: hidden;
  padding: var(--space-5) var(--space-5) var(--space-6);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur-lg);
  -webkit-backdrop-filter: var(--glass-blur-lg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  display: flex; flex-direction: column;
  gap: var(--space-5);
}

.rail-brand {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  padding: 0 0.25rem;
  flex-shrink: 0;
}

.rail-toggle {
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  width: 32px; height: 32px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: background var(--duration-normal), color var(--duration-normal);
}
.rail-toggle:hover { background: rgba(255, 255, 255, 0.6); color: var(--color-text); }
.rail-toggle svg { width: 18px; height: 18px; }

/* Mobile menu trigger + scrim (hidden on desktop) */
.rail-burger {
  display: none;
  position: fixed; left: 14px; top: 12px; z-index: 310;
  width: 40px; height: 40px; padding: 0;
  align-items: center; justify-content: center;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow);
  color: var(--color-text); cursor: pointer;
}
.rail-burger svg { width: 20px; height: 20px; }
.rail-scrim {
  display: none;
  position: fixed; inset: 0; z-index: 320;
  background: rgba(28, 25, 23, 0.36);
  opacity: 0; transition: opacity var(--duration-normal);
}

.rail-create {
  display: flex; align-items: center; justify-content: center;
  gap: 0.5rem;
  width: 100%;
  padding: 14px 18px;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  border: none;
  border-radius: var(--radius-lg);
  font-family: var(--font-body);
  font-size: 0.95rem; font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 10px -2px var(--color-primary-glow);
  transition: all var(--duration-normal);
}
.rail-create:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
.rail-create svg { width: 19px; height: 19px; }

.rail-scroll {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  display: flex; flex-direction: column; gap: var(--space-5);
  margin: 0 calc(var(--space-5) * -1); padding: 0 var(--space-5);
}
.rail-nav, .rail-group { display: flex; flex-direction: column; gap: 3px; }

.rail-group-title {
  font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  padding: 0 0.75rem;
  margin-bottom: 0.5rem;
}

.nav-item {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 0.92rem; font-weight: 500;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: background var(--duration-normal), color var(--duration-normal);
}
button.nav-item {
  appearance: none;
  border: none;
  background: transparent;
  width: 100%;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.nav-item svg { width: 18px; height: 18px; flex-shrink: 0; opacity: 0.85; }
.ws-logo-mark { width: 30px; height: 30px; flex-shrink: 0; object-fit: contain; border-radius: 6px; }
.nav-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nav-count {
  font-size: 0.72rem; font-weight: 600;
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.55);
  padding: 1px 7px; border-radius: var(--radius-full);
}
.nav-item:hover { background: rgba(255, 255, 255, 0.6); color: var(--color-text); }
.nav-item.active { background: var(--color-primary-light); color: var(--color-primary); }
.nav-item.active svg { opacity: 1; }
.nav-item.active .nav-count { background: var(--color-bg-elevated); color: var(--color-primary); }
.ws-open {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--color-text-tertiary); opacity: 0; transition: opacity 0.12s ease;
  flex-shrink: 0;
}
.ws-open svg { width: 14px; height: 14px; }
.ws-btn:hover .ws-open { opacity: 0.8; }
.ws-open:hover { color: var(--color-text); }

`;
