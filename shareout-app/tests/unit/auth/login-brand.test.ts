import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { loadLoginBrand } from '../../../src/workspaces/branding';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, slug TEXT, name TEXT, branding TEXT, locale TEXT)`);
  await e.DB.prepare(`INSERT INTO workspaces (id, slug, name, branding, locale) VALUES
    ('wsp_incro', 'incro', 'INCRO', '{"logo_ext":"png","accent_color":"#0a7f5a"}', 'es'),
    ('wsp_plain', 'plain', 'Plain', NULL, 'en'),
    ('wsp_bad', 'bad', 'Bad', '{"accent_color":"red;}"}', 'xx')`).run();
});

describe('loadLoginBrand (workspace subdomain sign-in)', () => {
  it('returns name, public logo URL, accent and the workspace language', async () => {
    expect(await loadLoginBrand(e, 'incro')).toEqual({
      brand: { name: 'INCRO', logoUrl: '/wl/wsp_incro.png', accent: '#0a7f5a' },
      locale: 'es',
    });
  });

  it('has no logo or accent when none are stored', async () => {
    expect(await loadLoginBrand(e, 'plain')).toEqual({
      brand: { name: 'Plain', logoUrl: null, accent: null },
      locale: 'en',
    });
  });

  it('drops an invalid accent and unknown locale', async () => {
    const b = await loadLoginBrand(e, 'bad');
    expect(b?.brand.accent).toBeNull();
    expect(b?.locale).toBeNull();
  });

  it('is null for an unknown subdomain', async () => {
    expect(await loadLoginBrand(e, 'nope')).toBeNull();
  });
});
