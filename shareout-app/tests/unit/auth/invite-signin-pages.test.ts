// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { appLoginPage } from '../../../src/auth/pages';
import { deviceDonePage } from '../../../src/auth/device-auth';
import { pageLocale } from '../../../src/i18n/accept-language';

const req = (url: string, lang?: string) =>
  new Request(url, { headers: lang ? { 'Accept-Language': lang } : {} });

describe('pageLocale', () => {
  it('picks es for any Spanish first preference, en otherwise', () => {
    expect(pageLocale(req('https://x/a', 'es-AR,es;q=0.9,en;q=0.8'))).toBe('es');
    expect(pageLocale(req('https://x/a', 'en-US,es;q=0.5'))).toBe('en');
    expect(pageLocale(req('https://x/a'))).toBe('en');
  });

  it('lets ?lang= override the header', () => {
    expect(pageLocale(req('https://x/a?lang=en', 'es-AR'))).toBe('en');
    expect(pageLocale(req('https://x/a?lang=es', 'en-US'))).toBe('es');
  });
});

describe('sign-in page in invite mode', () => {
  const html = () => appLoginPage({
    redirect: '/invite/ABCDE-FGHIJ',
    loginHint: 'ana@example.com',
    googleEnabled: true,
    locale: 'es',
  }).text();

  it('hides the password form and leads with the one-time code to the invited email', async () => {
    const h = await html();
    expect(h).not.toContain('id="password-login"');
    expect(h).toContain('Te invitaron como <strong>ana@example.com</strong>');
    expect(h).toContain('value="ana@example.com"');
    expect(h.indexOf('id="email-code-start"')).toBeLessThan(h.indexOf('href="/auth/google'));
  });

  it('pre-selects the invited Google account', async () => {
    expect(await html()).toContain('login_hint=ana%40example.com');
  });

  it('keeps the password form outside invite mode', async () => {
    const h = await appLoginPage({ redirect: '/home' }).text();
    expect(h).toContain('id="password-login"');
    expect(h).toContain('lang="en"');
  });
});

describe('device login success page', () => {
  it('speaks to chat users in their language and shows the token for copy-paste', async () => {
    const h = await deviceDonePage('ana@example.com', null, 'so_abc123', req('https://x/auth/device', 'es-AR')).text();
    expect(h).toContain('Volvé a Claude, ChatGPT o tu terminal');
    expect(h).toContain('value="so_abc123"');
    expect(h).not.toContain('CLI');
  });
});
