// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { appLoginPage } from '../../../src/auth/pages';

const page = (locale: 'en' | 'es') => appLoginPage({ redirect: '/home', googleEnabled: false, locale }).text();

describe('sign-in page error codes', () => {
  it('ships Spanish messages by code and a fallback to the server text', async () => {
    const h = await page('es');
    expect(h).toContain('Ya te mandamos uno. Esperá unos segundos antes de pedir otro.');
    expect(h).toContain('Ese código venció. Pedí uno nuevo.');
    expect(h).toContain('Demasiados intentos. Probá de nuevo en unos {n} min.');
    expect(h).toContain('(d && d.error) || fallback');
    expect(h).not.toContain('Just sent one');
  });

  it('ships English messages by code', async () => {
    const h = await page('en');
    expect(h).toContain('Just sent one — give it a few seconds before asking for another.');
    expect(h).toContain('That code expired. Ask for a new one.');
    expect(h).not.toContain('Ya te mandamos uno');
  });

  it('renders every code through errText instead of the raw server string', async () => {
    const h = await page('es');
    expect(h).toContain('throw new Error(errText(data, L.couldNotSend))');
    expect(h).toContain('throw new Error(errText(data, L.badCode))');
  });
});
