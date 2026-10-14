export type ToastType = 'info' | 'warning' | 'error' | 'success';

// ShareOut Design System Colors
const TOAST_COLORS: Record<ToastType, string> = {
  info: '#2563eb', // Primary blue
  warning: '#ca8a04', // Warning amber
  error: '#dc2626', // Error red
  success: '#16a34a', // Success green
};

// EDIT-09 F9: cap visible toasts so a retry storm doesn't stack N of them.
const MAX_TOASTS = 3;
const TOAST_TTL_MS = 3000;

function getContainer(): HTMLElement {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    // Persistent live region so screen readers announce toasts (F9). Polite by default;
    // error toasts mark themselves role="alert" (assertive) below.
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    container.style.cssText =
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:12px;';
    document.body.appendChild(container);
  }
  return container;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastOptions {
  /** One inline button (Undo / Retry); clicking it closes the toast and runs the callback. */
  action?: ToastAction | null;
  /** Auto-dismiss override in ms. */
  duration?: number;
}

export interface ToastHandle {
  close: () => void;
}

const NOOP_HANDLE: ToastHandle = { close: () => {} };

export function showToast(message: string, type: ToastType = 'info', opts: ToastOptions = {}): ToastHandle {
  const container = getContainer();

  // Dedupe: a retrying save (draft.ts) would otherwise stack identical toasts.
  // Actionable toasts (Undo/Retry) are never deduped — each one controls its own action.
  if (!opts.action) {
    for (const child of Array.from(container.children)) {
      if ((child as HTMLElement).dataset.toastMessage === message) return NOOP_HANDLE;
    }
  }

  const toast = document.createElement('div');
  toast.dataset.toastMessage = message;
  if (type === 'error') toast.setAttribute('role', 'alert'); // assertive for failures
  toast.style.cssText =
    'background:' +
    (TOAST_COLORS[type] ?? TOAST_COLORS.info) +
    ";color:white;padding:14px 20px;border-radius:12px;font-size:15px;font-family:'Source Sans 3','Segoe UI',system-ui,sans-serif;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.15);animation:fadeIn 0.2s;min-height:48px;display:flex;align-items:center;";
  toast.textContent = message;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    toast.remove();
  };
  const action = opts.action;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.style.cssText =
      'margin-left:12px;padding:2px 4px;border:none;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px;cursor:pointer;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      action.run();
    });
    toast.appendChild(btn);
  }
  container.appendChild(toast);

  // Cap: drop the oldest beyond MAX_TOASTS.
  while (container.children.length > MAX_TOASTS) {
    container.firstElementChild?.remove();
  }

  timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.15s';
    timer = setTimeout(close, 150);
  }, Math.max(0, (opts.duration ?? (action ? 5000 : TOAST_TTL_MS + 150)) - 150));
  return { close };
}
