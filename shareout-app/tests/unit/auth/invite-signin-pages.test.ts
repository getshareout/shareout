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

  it('prefers the workspace language over the browser, still under ?lang=', () => {
    expect(pageLocale(req('https://x/a', 'en-US'), 'es')).toBe('es');
    expect(pageLocale(req('https://x/a?lang=en', 'en-US'), 'es')).toBe('en');
    expect(pageLocale(req('https://x/a', 'es-AR'), null)).toBe('es');
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

describe('sign-in page on a workspace subdomain', () => {
  const brand = { name: 'INCRO', logoUrl: '/wl/wsp_1.png', accent: '#0a7f5a' };

  it('shows the workspace logo, name and accent, in Spanish', async () => {
    const h = await appLoginPage({ redirect: '/', locale: 'es', brand, turnstileSiteKey: 'site' }).text();
    expect(h).toContain('<img class="auth-logo" src="/wl/wsp_1.png" alt="INCRO">');
    expect(h).toContain('Iniciá sesión en INCRO');
    expect(h).toContain('--color-primary:#0a7f5a');
    expect(h).toContain('lang="es"');
    expect(h).toContain('Contraseña');
    expect(h).toContain('data-language="es"');
    expect(h).not.toContain('Sign in');
  });

  it('falls back to the generic mark without a logo and escapes the name', async () => {
    const h = await appLoginPage({ redirect: '/', brand: { name: '<b>Acme</b>', logoUrl: null, accent: null } }).text();
    expect(h).toContain('icon-primary');
    expect(h).toContain('Sign in to &lt;b&gt;Acme&lt;/b&gt;');
    expect(h).not.toContain('style="--color-primary');
  });

  it('keeps the plain ShareOut card off a subdomain', async () => {
    const h = await appLoginPage({ redirect: '/home' }).text();
    expect(h).not.toContain('<img class="auth-logo"');
    expect(h).toContain('<h1>Sign in</h1>');
  });
});

describe('forgot password link', () => {
  it('offers it under the password form when email can be delivered, in the page language', async () => {
    const h = await appLoginPage({ redirect: '/home', locale: 'es' }).text();
    expect(h).toContain('id="password-forgot"');
    expect(h).toContain('¿Olvidaste tu contraseña?');
    expect(h).toContain('id="email-code-password"');
  });

  it('ships inline scripts that parse', async () => {
    const h = await appLoginPage({ redirect: '/home', locale: 'es' }).text();
    const scripts = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(1);
    for (const js of scripts) expect(() => new Function(js)).not.toThrow();
  });

  it('hides it when codes cannot be emailed, and on invite sign-in', async () => {
    expect(await appLoginPage({ redirect: '/home', emailConfigured: false }).text()).not.toContain('id="password-forgot"');
    expect(await appLoginPage({ redirect: '/invite/abc' }).text()).not.toContain('id="password-forgot"');
  });
});

describe('sign-in page has one visible email field', () => {
  it('reuses the password form email for the code flow', async () => {
    const h = await appLoginPage({ redirect: '/home', googleEnabled: true }).text();
    const visible = [...h.matchAll(/<input [^>]*type="email"/g)];
    expect(visible).toHaveLength(1);
    expect(h).toContain('id="email-code-email" type="hidden"');
    expect(h).toContain('id="password-code-link"');
    expect(h).toContain('Email me a code instead');
    expect(h).not.toContain('<details');
    expect(h).toContain('so-c-btn so-c-btn--secondary so-c-btn--block');
    expect(h).not.toContain('btn-google');
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
