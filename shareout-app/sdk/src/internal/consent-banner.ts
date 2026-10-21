import { ConsentRequiredError } from '../shareout-error';

const shown = new Set<string>();

export function _resetConsentBanners(): void {
  shown.clear();
}

function showConsentBanner(connection: string, consentUrl: string): void {
  if (typeof document === 'undefined' || !document.body || shown.has(connection)) return;
  shown.add(connection);
  const bar = document.createElement('div');
  bar.setAttribute('data-shareout-consent', connection);
  bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:480px;margin:0 auto;padding:10px 14px;border-radius:10px;background:#1a1a1a;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;justify-content:space-between';
  const text = document.createElement('span');
  text.textContent = `This page wants to use your ${connection} connection.`;
  const link = document.createElement('a');
  link.href = consentUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Allow';
  link.style.cssText = 'color:#fff;font-weight:600;text-decoration:underline;white-space:nowrap';
  bar.append(text, link);
  document.body.appendChild(bar);
}

export async function withConsentBanner<T>(connection: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConsentRequiredError) showConsentBanner(connection, err.consentUrl);
    throw err;
  }
}
