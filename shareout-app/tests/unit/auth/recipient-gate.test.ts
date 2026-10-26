import { describe, it, expect } from 'vitest';
import { appLoginPage, loginPage } from '../../../src/auth/pages';

const emoji = /\p{Extended_Pictographic}/u;

describe('private-content gate', () => {
  it('renders Spanish for es', async () => {
    const h = await loginPage('demo', undefined, undefined, undefined, 'Ana', true, undefined, false, 'es').text();
    expect(h).toContain('lang="es"');
    expect(h).toContain('Contenido privado');
    expect(h).toContain('<strong>Ana</strong> compartió esto con vos');
    expect(h).toContain('Entrar con Google');
    expect(h).toContain('Mandame un código por email');
    expect(h).not.toContain('Private content');
    expect(h).not.toContain('Send code');
  });

  it('has no emoji and uses the lock svg', async () => {
    for (const locale of ['en', 'es'] as const) {
      const h = await loginPage('demo', undefined, undefined, undefined, undefined, true, undefined, false, locale).text();
      expect(emoji.test(h.replace(/<script[\s\S]*?<\/script>/g, ''))).toBe(false);
      expect(h).toContain('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"');
    }
  });

  it('reuses the sign-in form: one email field, password, code link, Google', async () => {
    const h = await loginPage('demo').text();
    expect([...h.matchAll(/<input [^>]*type="email"/g)]).toHaveLength(1);
    expect(h).toContain('id="password-login"');
    expect(h).toContain('id="password-code-link"');
    expect(h).toContain('/auth/google?redirect=');
  });

  it('arms turnstile on demand and only shows it for a human check', async () => {
    const h = await loginPage('demo', undefined, undefined, '0xSITE').text();
    expect(h).toContain('data-appearance="interaction-only"');
    expect(h).toContain('data-execution="execute"');
    const app = await appLoginPage({ redirect: '/home', turnstileSiteKey: '0xSITE' }).text();
    expect(app).toContain('data-appearance="interaction-only"');
  });
});

describe('login page polish', () => {
  it('uses the brand mark, not a sparkle, and a short subtitle', async () => {
    const en = await appLoginPage({ redirect: '/home' }).text();
    expect(en).not.toContain('✦');
    expect(en).toContain('class="auth-mark"');
    expect(en).toContain('Welcome back.');
    const es = await appLoginPage({ redirect: '/home', locale: 'es' }).text();
    expect(es).toContain('Bienvenido de nuevo.');
  });

  it('code mode keeps the chosen email visible with a way back, and swaps the subtitle', async () => {
    const h = await appLoginPage({ redirect: '/home', locale: 'es' }).text();
    expect(h).toContain('id="email-code-target"');
    expect(h).toContain('id="email-code-change"');
    expect(h).toContain('>Cambiar</button>');
    expect(h).toContain('data-code="Escribí el código que te mandamos."');
    expect(h).toContain("subtitle.innerHTML = on ? subtitle.getAttribute('data-code') : subtitleHtml");
  });
});
