import { describe, expect, it, vi } from 'vitest';
import { localeFromAcceptLanguage, resolveLocale, t } from '../../src/i18n';
import {
  handleSetMyLocale,
  handleSetWorkspaceLocale,
} from '../../src/router/api/workspace-locale';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const user: AuthUser = { id: 'usr_a', email: 'a@example.com', username: null };

function dbMock(role: string | null, run = vi.fn(async () => ({ success: true, meta: { changes: 1 } }))) {
  return {
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => (sql.includes('SELECT role FROM workspace_members') && role ? { role } : null)),
          run: vi.fn(async () => run(sql, ...args)),
        })),
      })),
    },
    run,
  };
}

function put(body: unknown): Request {
  return new Request('https://example.com/v1/x', { method: 'PUT', body: JSON.stringify(body) });
}

describe('localeFromAcceptLanguage', () => {
  it('picks the highest-weighted supported language', () => {
    expect(localeFromAcceptLanguage('es-AR,es;q=0.9,en;q=0.8')).toBe('es');
    expect(localeFromAcceptLanguage('fr-FR,en;q=0.5,es;q=0.9')).toBe('es');
    expect(localeFromAcceptLanguage('en-US')).toBe('en');
  });
  it('returns null when nothing is supported', () => {
    expect(localeFromAcceptLanguage('fr,de;q=0.5')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
    expect(localeFromAcceptLanguage('es;q=0')).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('person beats workspace beats browser', () => {
    expect(resolveLocale({ user: 'en', workspace: 'es', acceptLanguage: 'es' })).toBe('en');
    expect(resolveLocale({ user: null, workspace: 'es', acceptLanguage: 'en' })).toBe('es');
    expect(resolveLocale({ acceptLanguage: 'es-AR' })).toBe('es');
    expect(resolveLocale({ user: 'xx' })).toBe('en');
  });
  it('t() falls back to English', () => {
    expect(t('es', { en: 'Hi', es: 'Hola' })).toBe('Hola');
    expect(t(null, { en: 'Hi', es: 'Hola' })).toBe('Hi');
  });
});

describe('locale endpoints', () => {
  it('lets an admin set the workspace language', async () => {
    const m = dbMock('admin');
    const res = await handleSetWorkspaceLocale(put({ locale: 'es' }), { DB: m.DB } as unknown as Env, user, 'wsp_1');
    expect(res.status).toBe(200);
    const update = m.run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces SET locale'));
    expect(update?.[1]).toBe('es');
  });

  it('refuses a member', async () => {
    const m = dbMock('member');
    const res = await handleSetWorkspaceLocale(put({ locale: 'es' }), { DB: m.DB } as unknown as Env, user, 'wsp_1');
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported language', async () => {
    const m = dbMock('admin');
    const res = await handleSetWorkspaceLocale(put({ locale: 'fr' }), { DB: m.DB } as unknown as Env, user, 'wsp_1');
    expect(res.status).toBe(400);
  });

  it('stores and clears a person’s own language', async () => {
    const m = dbMock(null);
    expect((await handleSetMyLocale(put({ locale: 'es' }), { DB: m.DB } as unknown as Env, user)).status).toBe(200);
    expect((await handleSetMyLocale(put({ locale: null }), { DB: m.DB } as unknown as Env, user)).status).toBe(200);
    const binds = m.run.mock.calls.filter((c) => String(c[0]).includes('UPDATE users SET locale')).map((c) => c[1]);
    expect(binds).toEqual(['es', null]);
  });
});
