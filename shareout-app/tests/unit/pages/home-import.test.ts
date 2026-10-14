// POST /v1/home/import — one-step drop/paste import on the Studio Home.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const hostWorkspaceId = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const publishArtifact = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());

vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/publish/publish-artifact', () => ({ publishArtifact }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));

import { handleHomeImportApi } from '../../../src/pages/home/import';
import { importArtifactType, isShareLink } from '../../../src/pages/home/import-rules';
import { DOCX_MARKDOWN, docxFixture, toBase64, xlsxFixture } from '../helpers/office-fixtures';

let folderRow: unknown = { id: 'fld_1' };
const folderBinds: unknown[][] = [];
const env = {
  DB: { prepare: () => ({ bind: (...a: unknown[]) => { folderBinds.push(a); return { first: async () => folderRow }; } }) },
} as unknown as Env;
const user = { id: 'usr_1', email: 'ana@example.com' };
const post = (body: unknown, qs = '') =>
  handleHomeImportApi(new Request(`https://shareout.site/v1/home/import${qs}`, { method: 'POST', body: JSON.stringify(body) }), env, user);
const params = () => publishArtifact.mock.calls[0][2];

beforeEach(() => {
  folderRow = { id: 'fld_1' }; folderBinds.length = 0;
  hostWorkspaceId.mockReset().mockResolvedValue(null);
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
  publishArtifact.mockReset().mockResolvedValue({ artifact: { id: 'art_1' }, deployment: { slug: 'ventas-abc123' } });
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('import routing by file type', () => {
  it('publishes viewer types as artifacts and leaves everything else to Assets', () => {
    expect(importArtifactType('page.HTML')).toBe('html');
    expect(importArtifactType('ventas.csv')).toBe('csv');
    expect(importArtifactType('notes.md')).toBe('markdown');
    expect(importArtifactType('data.json')).toBe('json');
    expect(importArtifactType('readme.txt')).toBe('txt');
    expect(importArtifactType('deck.pdf')).toBe('pdf');
    expect(importArtifactType('photo.png')).toBeNull();
    expect(importArtifactType('clip.mp4')).toBeNull();
    expect(importArtifactType('book.xlsx')).toBe('csv');
    expect(importArtifactType('plan.docx')).toBe('markdown');
    expect(importArtifactType('slides.pptx')).toBeNull();
  });

  it.each([
    ['ventas.csv', 'a,b\n1,2', undefined, 'csv', 'text/csv'],
    ['notes.md', '# Hi', undefined, 'markdown', 'text/markdown'],
    ['deck.pdf', 'JVBERi0x', 'base64', 'pdf', 'application/pdf'],
    ['page.html', '<html><title>Q3</title></html>', undefined, 'html', 'text/html'],
  ])('%s → %s artifact, private, in the current workspace and folder', async (name, content, encoding, type, mime) => {
    const res = await post({ name, content, encoding, folder: 'fld_1' }, '?workspace=wsp_1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, artifactId: 'art_1', slug: 'ventas-abc123', type });
    expect(params()).toMatchObject({ artifactType: type, visibility: 'private', workspaceId: 'wsp_1', folderId: 'fld_1' });
    expect(params().files[0]).toMatchObject({ content, mime, ...(encoding ? { encoding } : {}) });
    expect(params().entrypoint).toBe(params().files[0].path);
    expect(folderBinds[0]).toEqual(['fld_1', 'wsp_1']);
    expect(incrementRateLimit).toHaveBeenCalledOnce();
  });

  it('refuses a type that belongs in Assets (415) without publishing', async () => {
    const res = await post({ name: 'photo.png', content: 'x' });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('UNSUPPORTED_TYPE');
    expect(publishArtifact).not.toHaveBeenCalled();
  });
});

describe('paste', () => {
  it('publishes pasted HTML named after its <title>', async () => {
    await post({ html: '<!doctype html><html><head><title>Plan de ventas</title></head><body>x</body></html>' });
    expect(params()).toMatchObject({ name: 'Plan de ventas', artifactType: 'html', entrypoint: 'index.html' });
    expect(params().slug).toMatch(/^plan-de-ventas-[0-9a-f]{6}$/);
  });

  it('names untitled pasted HTML in the shell language', async () => {
    await post({ html: '<div>hola</div>', lang: 'es' });
    expect(params().name).toBe('Página pegada');
  });

  it('only accepts share links from the known chat apps', async () => {
    expect(isShareLink('https://claude.ai/public/artifacts/abc')).toBe(true);
    expect(isShareLink('https://chatgpt.com/share/abc')).toBe(true);
    expect(isShareLink('https://gemini.google.com/share/abc')).toBe(true);
    expect(isShareLink('http://claude.ai/x')).toBe(false);
    expect(isShareLink('https://evil-claude.ai/x')).toBe(false);
    const res = await post({ url: 'https://example.com/page' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('URL_NOT_SUPPORTED');
  });

  it('publishes a fetchable share link', async () => {
    const page = `<html><head><title>Roadmap</title></head><body><p>${'Real content. '.repeat(30)}</p></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
    const res = await post({ url: 'https://claude.ai/public/artifacts/abc' });
    expect(res.status).toBe(200);
    expect(params()).toMatchObject({ name: 'Roadmap', artifactType: 'html' });
  });

  it('asks for the HTML when the share link is a JS shell or a login wall', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><body><div id="root"></div><script>boot()</script></body></html>', { headers: { 'content-type': 'text/html' } })));
    const res = await post({ url: 'https://chatgpt.com/share/abc' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('URL_NOT_FETCHABLE');
    expect(publishArtifact).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });
});

describe('limits', () => {
  it('refuses at the daily publish limit (429) without publishing', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Math.floor(Date.now() / 1000) + 3600 });
    const res = await post({ name: 'a.csv', content: 'a' });
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('RATE_LIMIT_EXCEEDED');
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('refuses over the storage quota (413)', async () => {
    checkStorageQuota.mockResolvedValue({ allowed: false, used: 9e6, incoming: 2e6, max: 1e7 });
    const res = await post({ name: 'a.csv', content: 'a' });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('STORAGE_LIMIT_EXCEEDED');
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('refuses a file over the import size cap (413)', async () => {
    const res = await post({ name: 'big.txt', content: 'x'.repeat(25 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('FILE_TOO_LARGE');
  });

  it('passes a moderation hold through to the client', async () => {
    publishArtifact.mockResolvedValue({ artifact: { id: 'art_1' }, deployment: { slug: 's' }, moderation: { status: 'pending', message: 'under review' } });
    const j = await (await post({ name: 'a.html', content: '<p>x</p>' })).json();
    expect(j.moderation).toMatchObject({ status: 'pending' });
  });

  it('403s outside an internal workspace membership', async () => {
    getInternalWorkspaceRole.mockResolvedValue(null);
    expect((await post({ name: 'a.csv', content: 'a' }, '?workspace=wsp_x')).status).toBe(403);
  });

  it('404s a folder outside the target workspace', async () => {
    folderRow = null;
    expect((await post({ name: 'a.csv', content: 'a', folder: 'fld_other' }, '?workspace=wsp_1')).status).toBe(404);
    expect(publishArtifact).not.toHaveBeenCalled();
  });
});

describe('Word and spreadsheet import', () => {
  it('a .docx becomes a Markdown artifact that keeps its images and the original', async () => {
    const res = await post({ name: 'Plan Q3.docx', content: toBase64(docxFixture()), encoding: 'base64' }, '?workspace=wsp_1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, type: 'markdown', name: 'Plan Q3' });
    expect(params()).toMatchObject({ artifactType: 'markdown', entrypoint: 'Plan Q3.md', source: { original: 'original/Plan Q3.docx' } });
    expect(params().files.map((f: { path: string }) => f.path)).toEqual(['Plan Q3.md', 'media/image1.png', 'original/Plan Q3.docx']);
    expect(params().files[0].content).toBe(DOCX_MARKDOWN);
    expect(checkStorageQuota.mock.calls[0][2]).toHaveLength(3);
  });

  it('a 2-sheet .xlsx becomes a CSV artifact with both sheets and the original', async () => {
    const book = xlsxFixture({ Sales: [['Region', 'Total'], ['North', 120]], Team: [['Name'], ['Ana']] });
    const res = await post({ name: 'book.xlsx', content: toBase64(book), encoding: 'base64' });
    expect(res.status).toBe(200);
    expect(params()).toMatchObject({
      artifactType: 'csv',
      entrypoint: 'sheets/01-Sales.csv',
      source: { original: 'original/book.xlsx', sheets: [{ name: 'Sales', path: 'sheets/01-Sales.csv' }, { name: 'Team', path: 'sheets/02-Team.csv' }] },
    });
    expect(params().files.slice(0, 2).map((f: { content: string }) => f.content)).toEqual(['Region,Total\nNorth,120', 'Name\nAna']);
  });

  it('an oversized workbook gets a clear 413 and nothing is published', async () => {
    const res = await post({ name: 'huge.xlsx', content: toBase64(new Uint8Array(8_000_001)), encoding: 'base64' });
    expect(res.status).toBe(413);
    const j = await res.json();
    expect(j.code).toBe('SPREADSHEET_TOO_LARGE');
    expect(j.error).toMatch(/Recursos/);
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('a damaged Word file gets a 422, and Office files must be base64', async () => {
    const bad = await post({ name: 'x.docx', content: toBase64(new Uint8Array([1, 2, 3])), encoding: 'base64' });
    expect(bad.status).toBe(422);
    expect((await bad.json()).code).toBe('CONVERT_FAILED');
    expect((await post({ name: 'x.docx', content: 'plain text' })).status).toBe(400);
    expect(publishArtifact).not.toHaveBeenCalled();
  });
});
