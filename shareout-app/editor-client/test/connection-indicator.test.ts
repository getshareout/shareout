// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createCollabConnectionIndicator } from '../src/collab/connection-indicator';

function mountTopbar(): void {
  document.body.innerHTML = `
    <header class="editor-topbar">
      <div class="topbar-right">
        <div class="collaborators" id="collaborators"></div>
      </div>
    </header>
  `;
}

describe('createCollabConnectionIndicator', () => {
  it('renders reconnecting and offline states, then hides on connected', () => {
    mountTopbar();
    const indicator = createCollabConnectionIndicator();
    expect(indicator.element).toBeTruthy();

    indicator.setStatus({ state: 'reconnecting', attempt: 2, delayMs: 2000 });
    expect(indicator.element?.hidden).toBe(false);
    expect(indicator.element?.textContent).toBe('Reconnecting...');
    expect(indicator.element?.dataset.state).toBe('reconnecting');

    indicator.setStatus({ state: 'offline', attempt: 4, delayMs: 8000 });
    expect(indicator.element?.textContent).toBe('Offline - edits saved locally');
    expect(indicator.element?.dataset.state).toBe('offline');

    indicator.setStatus({ state: 'connected' });
    expect(indicator.element?.hidden).toBe(true);
    expect(indicator.element?.textContent).toBe('');
  });
});
