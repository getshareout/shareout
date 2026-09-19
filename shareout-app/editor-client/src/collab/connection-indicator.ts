export type CollabConnectionState = 'connected' | 'reconnecting' | 'offline';

export interface CollabConnectionStatus {
  state: CollabConnectionState;
  attempt?: number;
  delayMs?: number;
}

export interface CollabConnectionIndicator {
  setStatus: (status: CollabConnectionStatus) => void;
  element: HTMLElement | null;
}

function ensureIndicatorElement(): HTMLElement | null {
  const existing = document.getElementById('collab-connection-status') as HTMLElement | null;
  if (existing) return existing;

  const topbarRight = document.querySelector('.topbar-right');
  const collaborators = document.getElementById('collaborators');
  if (!topbarRight || !collaborators) return null;

  const indicator = document.createElement('span');
  indicator.id = 'collab-connection-status';
  indicator.className = 'collab-connection-status';
  indicator.hidden = true;
  indicator.setAttribute('aria-live', 'polite');
  topbarRight.insertBefore(indicator, collaborators);
  return indicator;
}

export function createCollabConnectionIndicator(): CollabConnectionIndicator {
  const element = ensureIndicatorElement();
  let lastState: CollabConnectionState = 'connected';

  const setStatus = (status: CollabConnectionStatus): void => {
    if (!element) return;

    if (status.state === 'connected') {
      lastState = 'connected';
      element.hidden = true;
      element.textContent = '';
      element.removeAttribute('title');
      element.dataset.state = 'connected';
      return;
    }

    lastState = status.state;
    element.hidden = false;
    element.dataset.state = status.state;

    if (status.state === 'reconnecting') {
      const attempt = status.attempt ?? 1;
      const seconds = Math.max(1, Math.round((status.delayMs ?? 1000) / 1000));
      element.textContent = 'Reconnecting...';
      element.title = `Retry ${attempt} in ~${seconds}s`;
      return;
    }

    element.textContent = 'Offline - edits saved locally';
    const attempt = status.attempt ?? 1;
    const seconds = Math.max(1, Math.round((status.delayMs ?? 1000) / 1000));
    element.title = `Still retrying (${attempt}), next retry in ~${seconds}s`;
  };

  // Ensure clean state on first mount if this was created after a reconnect event.
  if (lastState === 'connected' && element) {
    element.hidden = true;
    element.dataset.state = 'connected';
  }

  return { setStatus, element };
}
