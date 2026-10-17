// Pure pieces of the folder import: Google-native export mapping, throttling backoff,
// signed OAuth state, and the filename folding the blob store needs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { planGoogleFile, GOOGLE_EXPORTS } from '../../../src/file-imports/export-map';
import { fetchWithBackoff, RateLimitedError, retryDelayMs, timing } from '../../../src/file-imports/http';
import { signState, verifyState, configuredProviders, authorizationUrl } from '../../../src/file-imports/oauth';
import { storableFilename, filenameProblem, fileVisibility, pageVisibility } from '../../../src/file-imports/mirror';
import type { Env } from '../../../src/types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Google-native export mapping', () => {
  it('exports Docs/Sheets/Slides to Office and Drawings to PDF', () => {
    expect(planGoogleFile('Plan', 'application/vnd.google-apps.document')).toMatchObject({ kind: 'export', filename: 'Plan.docx', target: { ext: 'docx' } });
    expect(planGoogleFile('Budget', 'application/vnd.google-apps.spreadsheet')).toMatchObject({ kind: 'export', filename: 'Budget.xlsx' });
    expect(planGoogleFile('Deck', 'application/vnd.google-apps.presentation')).toMatchObject({ kind: 'export', filename: 'Deck.pptx' });
    expect(planGoogleFile('Sketch', 'application/vnd.google-apps.drawing')).toMatchObject({ kind: 'export', target: { mime: 'application/pdf' } });
    expect(GOOGLE_EXPORTS['application/vnd.google-apps.document'].mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
  it('does not double the extension', () => {
    expect(planGoogleFile('Plan.docx', 'application/vnd.google-apps.document')).toMatchObject({ filename: 'Plan.docx' });
  });
  it('skips what cannot be exported and downloads everything else', () => {
    expect(planGoogleFile('Survey', 'application/vnd.google-apps.form')).toMatchObject({ kind: 'skip', code: 'NOT_EXPORTABLE' });
    expect(planGoogleFile('Shortcut', 'application/vnd.google-apps.shortcut')).toMatchObject({ kind: 'skip' });
    expect(planGoogleFile('a.pdf', 'application/pdf')).toEqual({ kind: 'download' });
  });
});

describe('rate-limit backoff', () => {
  it('waits out 429s, honouring Retry-After, then returns the answer', async () => {
    const sleep = vi.spyOn(timing, 'sleep').mockResolvedValue();
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), { status: 403 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const res = await fetchWithBackoff('https://api.test/x');
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[0][0]).toBe(3000);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
  });
  it('gives up with RateLimitedError after the retry budget', async () => {
    vi.spyOn(timing, 'sleep').mockResolvedValue();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(fetchWithBackoff('https://api.test/x')).rejects.toBeInstanceOf(RateLimitedError);
  });
  it('does not retry a plain 403 or 404', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', f);
    expect((await fetchWithBackoff('https://api.test/x')).status).toBe(403);
    expect(f).toHaveBeenCalledOnce();
  });
  it('backs off exponentially without Retry-After', () => {
    expect(retryDelayMs(null, 0)).toBeLessThan(2000);
    expect(retryDelayMs(null, 4)).toBeGreaterThanOrEqual(16000);
  });
});

describe('OAuth state and config', () => {
  const env = { CREDENTIALS_KEY: 'k'.repeat(32), SHAREOUT_BASE_URL: 'https://so.test' } as unknown as Env;
  it('round-trips and rejects tampering and expiry', async () => {
    const s = await signState(env, { p: 'google_drive', ws: 'wsp_1', u: 'usr_1' });
    expect(await verifyState(env, s)).toMatchObject({ ws: 'wsp_1', u: 'usr_1', p: 'google_drive' });
    const [body, sig] = s.split('.');
    const forged = btoa(JSON.stringify({ p: 'google_drive', ws: 'wsp_2', u: 'usr_1', n: 'x', exp: Date.now() + 1e6 })).replace(/=+$/, '');
    expect(await verifyState(env, `${forged}.${sig}`)).toBeNull();
    expect(await verifyState(env, `${body}.${sig}x`)).toBeNull();
    expect(await verifyState(env, s, Date.now() + 11 * 60_000)).toBeNull();
  });
  it('hides a provider until its client id and secret are set', async () => {
    expect(configuredProviders(env)).toEqual([]);
    const full = { ...env, GOOGLE_DRIVE_CLIENT_ID: 'gid', GOOGLE_DRIVE_CLIENT_SECRET: 'gs', MICROSOFT_FILES_CLIENT_ID: 'mid', MICROSOFT_FILES_CLIENT_SECRET: 'ms' } as Env;
    expect(configuredProviders(full)).toEqual(['google_drive', 'microsoft']);
    expect(configuredProviders({ ...full, CREDENTIALS_KEY: undefined } as Env)).toEqual([]);
    const g = new URL((await authorizationUrl(full, 'google_drive', 'wsp_1', 'usr_1'))!);
    expect(g.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
    expect(g.searchParams.get('access_type')).toBe('offline');
    expect(g.searchParams.get('code_challenge_method')).toBe('S256');
    expect(g.searchParams.get('redirect_uri')).toBe('https://so.test/v1/file-imports/oauth/google_drive/callback');
    const m = new URL((await authorizationUrl(full, 'microsoft', 'wsp_1', 'usr_1'))!);
    expect(m.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(m.searchParams.get('scope')).toBe('Files.Read.All Sites.Read.All User.Read offline_access');
  });
});

describe('names and visibility', () => {
  it('folds names into what the blob store accepts, keeping the extension', () => {
    expect(storableFilename('Presupuesto año 2026.xlsx')).toBe('Presupuesto ano 2026.xlsx');
    expect(storableFilename('a/b:c?.pdf')).toBe('a-b-c.pdf');
    expect(storableFilename('..')).toBe('file');
    expect(filenameProblem(storableFilename('Presupuesto año.xlsx'))).toBeNull();
    expect(filenameProblem('script.js')?.code).toBe('BLOCKED_TYPE');
  });
  it('maps the target folder audience', () => {
    expect([fileVisibility('private'), fileVisibility('workspace'), fileVisibility('public')]).toEqual(['private', 'team', 'workspace']);
    expect([pageVisibility('private'), pageVisibility('public')]).toEqual(['private', 'workspace']);
  });
});
