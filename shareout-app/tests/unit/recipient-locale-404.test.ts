import { describe, expect, it } from 'vitest';
import { localeForViewer } from '../../src/i18n/locale';
import { renderNotFoundPage } from '../../src/pages/not-found';

const req = (headers: Record<string, string> = {}) => new Request('https://x.shareout.site/a/', { headers });
const envWith = (locale: string | null) => ({
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ locale }) }) }) },
}) as never;

describe('localeForViewer', () => {
  it('visitor browser language beats the workspace language', async () => {
    expect(await localeForViewer(envWith('en'), { workspaceId: 'w', request: req({ 'Accept-Language': 'es-AR,es;q=0.9' }) })).toBe('es');
  });
  it("a signed-in person's own choice wins", async () => {
    expect(await localeForViewer(envWith('es'), { workspaceId: 'w', user: 'en', request: req({ 'Accept-Language': 'es-AR' }) })).toBe('en');
  });
  it('falls back to the workspace language, then English', async () => {
    expect(await localeForViewer(envWith('es'), { workspaceId: 'w', request: req() })).toBe('es');
    expect(await localeForViewer(envWith(null), { workspaceId: 'w', request: req() })).toBe('en');
  });
});

describe('404 actions', () => {
  const html = async (headers: Record<string, string>) => (await renderNotFoundPage(req({ Accept: 'text/html', ...headers })).text());
  it('signed-in keeps my artifacts + create', async () => {
    const b = await html({ Cookie: 'shareout_session=abc', 'Accept-Language': 'es-AR' });
    expect(b).toContain('href="/home"');
    expect(b).toContain('href="/create"');
    expect(b).toContain('Ir a mis artefactos');
  });
  it('signed-out gets the landing + sign in, in the visitor language', async () => {
    const b = await html({ 'Accept-Language': 'es-AR' });
    expect(b).not.toContain('href="/create"');
    expect(b).toContain('Ir a ShareOut');
    expect(b).toContain('Iniciar sesión');
    const en = await html({});
    expect(en).toContain('Go to ShareOut');
    expect(en).toContain('Sign in');
  });
});
