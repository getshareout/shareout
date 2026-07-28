/**
 * Viewer toolbar styles — Stats and skills slide-up overlays
 * @module serve/sandbox-viewer/toolbar/styles/stats-skills-overlay
 */

/** CSS rules for: Stats and skills slide-up overlays */
export const statsSkillsOverlayStyles = `    #so-stats-overlay {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: none;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 20px;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
    }
    #so-stats-overlay.open { display: flex; }
    #so-stats-overlay .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(28, 25, 23, 0.2);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #so-stats-panel {
      position: relative;
      width: 380px;
      max-height: calc(100vh - 40px);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08);
      border: 1px solid rgba(231, 229, 228, 0.5);
      overflow: hidden;
      animation: slideUp 0.25s ease-out;
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .so-skills-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: rgba(0,0,0,0.08);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
    }
    #so-skills-overlay {
      position: fixed;
      inset: 0;
      z-index: 10001;
      display: none;
      align-items: flex-end;
      justify-content: flex-end;
      padding: 20px;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
    }
    #so-skills-overlay.so-open { display: flex; }
    #so-skills-overlay .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(28, 25, 23, 0.2);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #so-skills-panel {
      position: relative;
      width: 340px;
      max-height: calc(100vh - 40px);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08);
      border: 1px solid rgba(231, 229, 228, 0.5);
      overflow: hidden;
      animation: slideUp 0.25s ease-out;
    }
    .so-skills-body { padding: 16px 24px 20px; overflow-y: auto; }
    .so-skills-intro {
      margin: 0 0 14px;
      font-size: 13px;
      line-height: 1.45;
      color: var(--color-text-secondary);
    }
    .so-skills-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .so-skill-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 12px;
      border-radius: 999px;
      background: rgba(250, 250, 249, 0.8);
      border: 1px solid var(--color-border);
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text);
      text-decoration: none;
    }
    .so-skill-chip:hover { border-color: var(--color-text); }
    .so-skill-chip svg { color: var(--color-text-secondary); flex-shrink: 0; }
    .so-stats-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid var(--color-border);
      background: rgba(250, 250, 249, 0.5);
    }
    .so-stats-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text);
      margin: 0;
    }
    .so-stats-close {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-secondary);
      transition: all 0.15s;
    }
    .so-stats-close:hover {
      background: var(--color-surface);
      color: var(--color-text);
    }
    .so-stats-content {
      padding: 24px;
      overflow-y: auto;
      max-height: calc(100vh - 140px);
    }
    .so-stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .so-stat-card {
      background: var(--color-bg);
      border-radius: 12px;
      padding: 16px;
      border: 1px solid var(--color-border);
    }
    .so-stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--color-text);
      line-height: 1;
      margin-bottom: 4px;
    }
    .so-stat-label {
      font-size: 13px;
      color: var(--color-text-secondary);
      font-weight: 500;
    }
    .so-stat-card.highlight {
      background: linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-bg) 100%);
      border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-bg-elevated));
    }
    .so-stat-card.highlight .so-stat-value { color: var(--color-primary); }
    .so-stats-section {
      margin-bottom: 20px;
    }
    .so-stats-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .so-recent-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .so-recent-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: var(--color-bg);
      border-radius: 10px;
      border: 1px solid var(--color-border);
    }
    .so-recent-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--color-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-secondary);
    }
    .so-recent-info { flex: 1; min-width: 0; }
    .so-recent-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .so-recent-time {
      font-size: 12px;
      color: var(--color-text-tertiary);
    }
    .so-viewers-more {
      margin-top: var(--space-2);
      background: none;
      border: 0;
      padding: 0;
      color: var(--color-primary);
      font-size: 12px;
      cursor: pointer;
    }
    .so-stats-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: var(--color-text-secondary);
    }
    .so-stats-empty {
      text-align: center;
      padding: 32px;
      color: var(--color-text-secondary);
    }
    .so-admin-link {
      display: block;
      text-align: center;
      padding: 12px;
      color: var(--color-primary);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      border-top: 1px solid var(--color-border);
      transition: background 0.15s;
    }
    .so-admin-link:hover {
      background: var(--color-bg);
    }
`;
