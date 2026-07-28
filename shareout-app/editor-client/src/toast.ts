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

export function showToast(message: string, type: ToastType = 'info'): void {
  const container = getContainer();

  // Dedupe: a retrying save (draft.ts) would otherwise stack identical toasts.
  for (const child of Array.from(container.children)) {
    if ((child as HTMLElement).dataset.toastMessage === message) return;
  }

  const toast = document.createElement('div');
  toast.dataset.toastMessage = message;
  if (type === 'error') toast.setAttribute('role', 'alert'); // assertive for failures
  toast.style.cssText =
    'background:' +
    (TOAST_COLORS[type] ?? TOAST_COLORS.info) +
    ";color:white;padding:14px 20px;border-radius:12px;font-size:15px;font-family:'Source Sans 3','Segoe UI',system-ui,sans-serif;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.15);animation:fadeIn 0.2s;min-height:48px;display:flex;align-items:center;";
  toast.textContent = message;
  container.appendChild(toast);

  // Cap: drop the oldest beyond MAX_TOASTS.
  while (container.children.length > MAX_TOASTS) {
    container.firstElementChild?.remove();
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.15s';
    setTimeout(() => toast.remove(), 150);
  }, TOAST_TTL_MS);
}
