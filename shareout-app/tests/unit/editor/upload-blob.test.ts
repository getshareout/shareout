import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handlePublish, handleUpload } from '../../../src/editor/draft';
import { handleServe } from '../../../src/serve';
import { createAccessToken } from '../../../src/token';
import { handleFetch } from '../../../src/router/handle-fetch';
import type { EditorContext } from '../../../src/editor/index';

const OWNER = 'usr_upblob_o';
const ART = 'art_upblob';
const PRIV = 'art_upblob_priv';
const OTHER = 'art_upblob_other';
const BUNDLE = 'art_upblob_bundle';
const BASE = 'https://shareout.example.com';
const exec = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const ctx = (env = e, artifactId = ART): EditorContext => ({ artifactId, userId: OWNER, userName: 'o', role: 'editor', env });
const upload = (size: number, name = 'a.png') => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(size)], name, { type: 'image/png' }));
  return new Request('https://so.test/x', { method: 'POST', body: form });
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(OWNER, 'upblob@x.test'),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'public')").bind(ART, ART, `s-${ART}`, OWNER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'private')").bind(PRIV, PRIV, 'upblob-priv', OWNER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'private')").bind(OTHER, OTHER, 'upblob-other', OWNER),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'private')").bind(BUNDLE, BUNDLE, 'upblob-bundle', OWNER),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES ('ver_upblob_b1', ?, 1, 'index.html')").bind(BUNDLE),
    ...['index.html', 'styles.css', 'pg-01.html', 'img/p01.jpg'].map((p, i) => e.DB.prepare(
      "INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, 'ver_upblob_b1', ?, ?, 'text/plain', 1, 'x')"
    ).bind(`ast_upblob_b${i}`, p, `${BUNDLE}/ver_upblob_b1/${p}`)),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_upblob_b', ?, 'ver_upblob_b1', 'production', 'upblob-bundle')").bind(BUNDLE),
  ]);
});

describe('editor upload goes through the blob tier', () => {
  it('creates a blob row, counts it in storage, and serves the returned URL', async () => {
    const res = await handleUpload(upload(64), ctx());
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string; size: number };

    const row = await e.DB.prepare('SELECT mime_type, size_bytes FROM blobs WHERE artifact_id = ?')
      .bind(ART).first<{ mime_type: string; size_bytes: number }>();
    expect(row).toEqual({ mime_type: 'image/png', size_bytes: 64 });
    const st = await e.DB.prepare('SELECT used_bytes, blob_count FROM artifact_storage WHERE artifact_id = ?')
      .bind(ART).first<{ used_bytes: number; blob_count: number }>();
    expect(st).toEqual({ used_bytes: 64, blob_count: 1 });

    expect(body.url).toContain(`/v1/data/${ART}/blobs/`);
    const served = await handleFetch(new Request(body.url), e, exec);
    expect(served.status).toBe(200);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect((await served.arrayBuffer()).byteLength).toBe(64);
  });

  it('refuses an upload that would exceed the storage quota with 413', async () => {
    const env = { ...e, STORAGE_QUOTA_BYTES: '100' } as typeof e;
    expect((await handleUpload(upload(500), ctx(env))).status).toBe(413);
  });

  describe('publish bundles referenced blobs', () => {
    const publish = (artifactId: string, html: string) =>
      handlePublish(new Request('https://so.test/p', { method: 'POST', body: JSON.stringify({ html }) }), ctx(e, artifactId));

    it('copies the blob into the version as media/ and serves it on a private artifact', async () => {
      const up = await (await handleUpload(upload(32), ctx(e, PRIV))).json() as { url: string };
      const blobId = up.url.split('/blobs/')[1].split('/')[0];

      const other = await (await handleUpload(upload(16), ctx(e, OTHER))).json() as { url: string };
      const rel = `/v1/data/${PRIV}/blobs/${blobId}/content`;
      const html = `<img src="${up.url}"><img src="${rel}"><img src="${other.url}">`;
      const res = await publish(PRIV, html);
      expect(res.status).toBe(200);

      const path = `media/${blobId}.png`;
      const asset = await e.DB.prepare(
        `SELECT a.size_bytes, a.mime FROM assets a JOIN deployments d ON d.version_id = a.version_id
          WHERE d.artifact_id = ? AND d.channel = 'production' AND a.path = ?`
      ).bind(PRIV, path).first<{ size_bytes: number; mime: string }>();
      expect(asset).toEqual({ size_bytes: 32, mime: 'image/png' });

      const idx = await e.DB.prepare(
        `SELECT a.r2_key FROM assets a JOIN deployments d ON d.version_id = a.version_id
          WHERE d.artifact_id = ? AND d.channel = 'production' AND a.path = 'index.html'`
      ).bind(PRIV).first<{ r2_key: string }>();
      const text = await (await e.ARTIFACTS.get(idx!.r2_key))!.text();
      expect(text).toBe(`<img src="${path}"><img src="${path}"><img src="${other.url}">`);

      const env = { ...e, SESSION_SECRET: 'upblob-secret' } as typeof e;
      const ct = await createAccessToken(PRIV, 'content', env, 600);
      const file = await handleServe(new Request(`${BASE}/a/upblob-priv/${path}`), env, 'upblob-priv', path, { contentOrigin: true, ct });
      expect(file.status).toBe(200);
      expect(file.headers.get('Content-Type')).toBe('image/png');
      expect((await file.arrayBuffer()).byteLength).toBe(32);
    });

    it('keeps earlier media on a later publish', async () => {
      const row = await e.DB.prepare(
        `SELECT a.path FROM assets a JOIN deployments d ON d.version_id = a.version_id
          WHERE d.artifact_id = ? AND d.channel = 'production' AND a.path LIKE 'media/%'`
      ).bind(PRIV).first<{ path: string }>();
      expect((await publish(PRIV, `<img src="${row!.path}">`)).status).toBe(200);
      const kept = await e.DB.prepare(
        `SELECT 1 AS ok FROM assets a JOIN deployments d ON d.version_id = a.version_id
          WHERE d.artifact_id = ? AND d.channel = 'production' AND a.path = ?`
      ).bind(PRIV, row!.path).first();
      expect(kept).toBeTruthy();
    });

    it('keeps the rest of a multi-file bundle (styles, pages, images) on publish', async () => {
      expect((await publish(BUNDLE, '<link rel="stylesheet" href="styles.css"><a href="pg-01.html">x</a>')).status).toBe(200);
      const { results } = await e.DB.prepare(
        `SELECT a.path, a.r2_key FROM assets a JOIN deployments d ON d.version_id = a.version_id
          WHERE d.artifact_id = ? AND d.channel = 'production' ORDER BY a.path`
      ).bind(BUNDLE).all<{ path: string; r2_key: string }>();
      expect(results.map((r) => r.path)).toEqual(['img/p01.jpg', 'index.html', 'pg-01.html', 'styles.css']);
      expect(results.find((r) => r.path === 'index.html')!.r2_key).not.toContain('ver_upblob_b1');
    });
  });
});
