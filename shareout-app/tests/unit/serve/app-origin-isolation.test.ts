// Artifact bytes served from an app origin run in an opaque origin (CSP sandbox), and
// closed artifacts are never marked cacheable by browsers or shared caches.
import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import { ARTIFACT_ID, SLUG, createServeEnv, defaultDeployment, serveRequest } from './helpers/env';
import { setupServeTestHooks } from './helpers/hooks';
import { handleServe, handleServeText } from '../../../src/serve';
import { serveTypeViewer } from '../../../src/serve/type-viewer';
import * as auth from '../../../src/auth';
import * as viewers from '../../../src/viewers';
import type { ArtifactInfo } from '../../../src/serve/types';

setupServeTestHooks();

const extraAssets = {
  'index.html': { r2_key: 'artifacts/demo/index.html', mime: 'text/html', size_bytes: 512 },
  'pic.svg': { r2_key: 'artifacts/demo/pic.svg', mime: 'image/svg+xml', size_bytes: 64 },
  'doc.pdf': { r2_key: 'artifacts/demo/doc.pdf', mime: 'application/pdf', size_bytes: 64 },
};
const extraR2 = {
  'artifacts/demo/index.html': { body: '<html><body><h1>Hello</h1></body></html>' },
  'artifacts/demo/pic.svg': { body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  'artifacts/demo/doc.pdf': { body: '%PDF-1.4' },
};

function sandboxDirective(csp: string): string | undefined {
  return csp.split(';').map((d) => d.trim()).find((d) => d === 'sandbox' || d.startsWith('sandbox '));
}

describe('artifact bytes on an app origin', () => {
  it('raw HTML carries a CSP sandbox without same-origin', async () => {
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const res = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html');
    expect(res.status).toBe(200);
    const sandbox = sandboxDirective(res.headers.get('Content-Security-Policy') ?? '');
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('raw HTML on the content domain keeps its CSP without the sandbox directive', async () => {
    const { env, slugsStore } = createServeEnv();
    slugsStore.set(`cmtcfg:${ARTIFACT_ID}`, '0');
    const res = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html', { contentOrigin: true });
    expect(res.status).toBe(200);
    expect(sandboxDirective(res.headers.get('Content-Security-Policy') ?? '')).toBeUndefined();
  });

  it('SVG gets a script-free sandbox; PDF does not', async () => {
    const { env } = createServeEnv({ assets: extraAssets, r2: extraR2 });
    const svg = await handleServe(serveRequest('pic.svg'), env, SLUG, 'pic.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('Content-Security-Policy')).toBe('sandbox');
    const pdf = await handleServe(serveRequest('doc.pdf'), env, SLUG, 'doc.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('Content-Security-Policy')).toBeNull();
  });
});

describe('closed artifacts on an app origin', () => {
  it('private raw HTML is private, no-store for its owner', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({ deployment: { ...defaultDeployment, visibility: 'private' }, ownerMatch: true });
    const res = await handleServe(serveRequest('index.html?_raw'), env, SLUG, 'index.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('private sub-asset is private, no-store for its owner', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({ deployment: { ...defaultDeployment, visibility: 'private' }, ownerMatch: true });
    const res = await handleServe(serveRequest('logo.png'), env, SLUG, 'logo.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('public sub-asset keeps its public cache policy', async () => {
    const { env } = createServeEnv();
    const res = await handleServe(serveRequest('logo.png'), env, SLUG, 'logo.png');
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it('text extract of a private artifact is private, no-store', async () => {
    vi.mocked(auth.getSessionUser).mockResolvedValue({ id: 'usr_1', email: 'owner@example.com' });
    const { env } = createServeEnv({ deployment: { ...defaultDeployment, visibility: 'private' }, ownerMatch: true });
    const res = await handleServeText(serveRequest('_text'), env, SLUG);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('text extract of a public artifact stays publicly cacheable', async () => {
    const { env } = createServeEnv();
    const res = await handleServeText(serveRequest('_text'), env, SLUG);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('typed-viewer fallback of a private artifact is private, no-store with nosniff', async () => {
    const spy = vi.spyOn(viewers, 'renderViewer').mockReturnValue(null as unknown as string);
    const { env } = createServeEnv({ r2: { 'artifacts/demo/data.csv': { body: 'a,b\n1,2' } } });
    const artifact = { ...defaultDeployment, visibility: 'private', artifact_type: 'csv', type_metadata: null, entrypoint: 'data.csv' } as unknown as ArtifactInfo;
    const asset = { r2_key: 'artifacts/demo/data.csv', mime: 'text/csv', size_bytes: 7 };
    const res = await serveTypeViewer(serveRequest(''), env, artifact, asset, SLUG, undefined as never);
    spy.mockRestore();
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
