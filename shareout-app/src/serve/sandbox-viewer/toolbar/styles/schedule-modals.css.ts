/**
 * Viewer toolbar styles — Viewer schedule and alert modal forms
 * @module serve/sandbox-viewer/toolbar/styles/schedule-modals
 */

/** CSS rules for: Viewer schedule and alert modal forms */
export const scheduleModalsStyles = `    /* Viewer schedule / alert modals */
    .so-theme-viewer .so-c-modal__title {
      font-family: var(--font-display);
      font-size: 1.125rem;
      font-weight: 700;
      line-height: 1.25;
      color: var(--color-text);
    }
    .so-sched-lead {
      margin: 4px 0 0;
      font-size: 0.8125rem;
      line-height: 1.45;
      color: var(--color-text-secondary);
      font-weight: 400;
    }
    .so-sched-section { margin-bottom: 18px; }
    .so-sched-section:last-child { margin-bottom: 0; }
    .so-sched-section-label {
      display: block;
      margin: 0 0 8px;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-text);
    }
    .so-sched-dest-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .so-sched-dest-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border: 1.5px solid var(--glass-border, rgba(231, 229, 228, 0.65));
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.55);
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: var(--color-text);
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    .so-sched-dest-card:hover {
      border-color: rgba(37, 99, 235, 0.35);
      background: rgba(255, 255, 255, 0.82);
    }
    .so-sched-dest-card.is-active {
      border-color: var(--color-primary);
      background: var(--color-primary-light);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
    }
    .so-sched-dest-icon {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    .so-sched-dest-icon svg { display: block; }
    .so-sched-dest-icon--logo {
      background: transparent;
      box-shadow: none;
      padding: 0;
      overflow: hidden;
    }
    .so-sched-dest-logo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .so-sched-dest-copy { min-width: 0; }
    .so-sched-dest-name {
      display: block;
      font-size: 0.875rem;
      font-weight: 600;
      line-height: 1.2;
    }
    .so-sched-dest-hint {
      display: block;
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--color-text-tertiary);
      line-height: 1.3;
    }
    .so-sched-slack-panel {
      padding: 14px;
      border-radius: 14px;
      border: 1px solid rgba(231, 229, 228, 0.8);
      background: rgba(250, 250, 249, 0.85);
    }
    .so-sched-slack-panel[hidden] { display: none !important; }
    .so-sched-slack-panel .so-c-field { margin-bottom: 10px; }
    .so-sched-slack-panel .so-c-field:last-child { margin-bottom: 0; }
    .so-sched-seg {
      display: flex;
      gap: 6px;
      padding: 4px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.6);
      border: 1px solid rgba(231, 229, 228, 0.8);
      margin-bottom: 10px;
    }
    .so-sched-seg-btn {
      flex: 1;
      padding: 8px 10px;
      border: none;
      border-radius: 9px;
      background: transparent;
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
    }
    .so-sched-seg-btn.is-active {
      background: var(--color-bg-elevated);
      color: var(--color-text);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
    }
    .so-sched-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .so-sched-row .so-c-field { margin: 0; }
    .so-sched-row .so-c-label { margin-top: 0; }
    .so-sched-check {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-top: 4px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(231, 229, 228, 0.8);
      background: rgba(255, 255, 255, 0.5);
      font-size: 0.8125rem;
      line-height: 1.4;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
    .so-sched-check input { margin-top: 2px; flex-shrink: 0; accent-color: var(--color-primary); }

`;
