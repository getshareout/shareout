import { unzipSync, zipSync } from 'fflate';
import type { Env } from './types';
import { rewriteSkillOrigin, skillOriginRewriter } from './skill-origin';

const R2_PREFIX = 'skill';
export const SKILL_BUNDLE_KEY = `${R2_PREFIX}/_bundle.zip`;
const CACHE_TTL = 3600;

// Fallback copy staged at build time (scripts/stage-skill-bundle.mjs). The founder
// instance syncs the skill to R2 so it can ship skill edits without a redeploy; a
// self-hosted instance has no such sync, and without this asset `/v1/skill` would
// 404 — the one endpoint the deploy docs promise works on a fresh instance.
const SKILL_ZIP_ASSET = '/_bundles/skill.zip';
const SKILL_META_ASSET = '/_bundles/skill-meta.json';

interface SkillMeta {
  name: string;
  version: string;
  updated_at: string;
  description: string;
  /** sha256 of skill.zip, written by stage-skill-bundle.mjs (asset copy only). */
  sha256?: string;
}

/** Base URL for ASSETS.fetch — the binding only cares about the path. */
function assetUrl(path: string): string {
  return new URL(path, 'https://assets.local').toString();
}

/**
 * One copy of the skill: the R2 sync (live edits without a redeploy) or the asset
 * staged with this Worker version. Meta, bundle and files always come from the same copy.
 */
interface SkillSource {
  kind: 'r2' | 'asset';
  meta: SkillMeta;
  bundle(): Promise<ArrayBuffer | null>;
  /** sha256 hex of the zip, when known without reading it. */
  sha256?: string;
  /** R2 object identity, to memoize the hash of an unchanged bundle. */
  etag?: string;
  /** When this copy was produced: R2 upload time, or this Worker version's creation. */
  time?: number;
}

/** Major.minor.patch compare; non-numeric parts count as 0. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * The newer copy wins: higher frontmatter version, then later `updated_at`, then the
 * later of R2 upload vs. this Worker version's deploy. Unknown on both → R2, as before.
 */
function pickNewer(r2: SkillSource, asset: SkillSource): SkillSource {
  const bySemver = compareSemver(r2.meta.version, asset.meta.version);
  if (bySemver !== 0) return bySemver > 0 ? r2 : asset;
  const ru = Date.parse(r2.meta.updated_at || '');
  const au = Date.parse(asset.meta.updated_at || '');
  if (Number.isFinite(ru) && Number.isFinite(au) && ru !== au) return ru > au ? r2 : asset;
  if (r2.time !== undefined && asset.time !== undefined && asset.time > r2.time) return asset;
  return r2;
}

async function r2Source(env: Env): Promise<SkillSource | null> {
  const metaObj = await env.ARTIFACTS.get(`${R2_PREFIX}/_meta.json`);
  if (!metaObj) return null;
  const meta = (await metaObj.json()) as SkillMeta;
  const head = typeof env.ARTIFACTS.head === 'function'
    ? await env.ARTIFACTS.head(SKILL_BUNDLE_KEY)
    : await env.ARTIFACTS.get(SKILL_BUNDLE_KEY);
  const uploaded = head?.uploaded instanceof Date ? head.uploaded.getTime() : undefined;
  return {
    kind: 'r2',
    // R2 meta is only re-uploaded when SKILL.md changes; the hash comes from the bytes.
    meta: { ...meta, sha256: undefined },
    etag: head?.etag,
    time: uploaded,
    bundle: async () => {
      if (!head) return null;
      const obj = await env.ARTIFACTS.get(SKILL_BUNDLE_KEY);
      return obj ? obj.arrayBuffer() : null;
    },
  };
}

async function assetSource(env: Env): Promise<SkillSource | null> {
  // Optional access: a Worker deployed without the [assets] binding should 404,
  // not throw a TypeError that surfaces as an opaque 500.
  const res = await env.ASSETS?.fetch(assetUrl(SKILL_META_ASSET));
  if (!res?.ok) return null;
  const meta = (await res.json()) as SkillMeta;
  const deployed = Date.parse(env.CF_VERSION_METADATA?.timestamp || '');
  return {
    kind: 'asset',
    meta,
    sha256: meta.sha256 && /^[0-9a-f]{64}$/.test(meta.sha256) ? meta.sha256 : undefined,
    time: Number.isFinite(deployed) ? deployed : undefined,
    bundle: async () => {
      const zip = await env.ASSETS?.fetch(assetUrl(SKILL_ZIP_ASSET));
      return zip?.ok ? zip.arrayBuffer() : null;
    },
  };
}

async function getSkillSource(env: Env): Promise<SkillSource | null> {
  const [r2, asset] = await Promise.all([r2Source(env), assetSource(env)]);
  if (r2 && asset) return pickNewer(r2, asset);
  return r2 ?? asset;
}

// Hash of an R2 bundle by etag, so an unchanged copy is read and hashed once per isolate.
const r2HashMemo = new Map<string, string>();

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sourceSha256(src: SkillSource, bundle?: ArrayBuffer | null): Promise<string | null> {
  if (src.sha256) return src.sha256;
  const memoKey = src.etag ? `${src.kind}:${src.etag}` : '';
  const memo = memoKey ? r2HashMemo.get(memoKey) : undefined;
  if (memo) return memo;
  const bytes = bundle ?? (await src.bundle());
  if (!bytes) return null;
  const hex = await sha256Hex(bytes);
  if (memoKey) r2HashMemo.set(memoKey, hex);
  return hex;
}

/**
 * The served version: `<frontmatter version>+<sha8 of skill.zip>`. The frontmatter
 * version is bumped by hand and rarely; the hash moves with every content change, so
 * an agent comparing versions (or holding the ETag) refreshes when the skill changes.
 * Semver ignores `+build` metadata, so a semver compare still sees the frontmatter version.
 */
async function servedVersion(src: SkillSource, bundle?: ArrayBuffer | null): Promise<string> {
  const sha = await sourceSha256(src, bundle);
  return sha ? `${src.meta.version}+${sha.slice(0, 8)}` : src.meta.version;
}

/** One file from the skill tree, by path relative to the skill root. */
async function getSkillFileText(env: Env, src: SkillSource, relPath: string): Promise<string | null> {
  if (src.kind === 'r2') {
    const obj = await env.ARTIFACTS.get(`${R2_PREFIX}/${relPath}`);
    if (obj) return obj.text();
  }

  const bundle = await src.bundle();
  if (!bundle) return null;
  // Filter so one file request does not inflate all 140-odd entries.
  const entry = unzipSync(new Uint8Array(bundle), { filter: (f) => f.name === relPath })[relPath];
  return entry ? new TextDecoder().decode(entry) : null;
}

// Cheap, stable string hash for ETag variance when workspace context is appended.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function getSkillHeaders(
  contentType: string,
  meta: SkillMeta | null,
  version: string,
  extra: Record<string, string> = {},
  privateCache = false,
): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Skill-Version': version,
    'X-Skill-Updated-At': meta?.updated_at || '',
    'ETag': `"${version}"`,
    'Cache-Control': `${privateCache ? 'private' : 'public'}, max-age=${CACHE_TTL}`,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-Skill-Version, X-Skill-Updated-At, ETag, Content-Disposition',
    ...extra,
  };
}

function bundleFilename(meta: SkillMeta | null): string {
  const version = meta?.version || 'unknown';
  return `shareout-skill-${version}.zip`;
}

// Text entries get the founder-host rewrite; binary ones (images, archives) are
// copied through untouched. One unzip/rezip pass covers both this and the optional
// workspace-context injection.
const TEXT_ENTRY = /\.(md|markdown|json|txt|ya?ml|html|css|js|ts)$/i;

function rebuildBundle(
  zipBytes: ArrayBuffer,
  workspaceContext: string,
  rewrite: ((text: string) => string) | null,
): Uint8Array {
  const entries = unzipSync(new Uint8Array(zipBytes));

  if (rewrite) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    for (const [name, bytes] of Object.entries(entries)) {
      if (!TEXT_ENTRY.test(name)) continue;
      entries[name] = new Uint8Array(encoder.encode(rewrite(decoder.decode(bytes))));
    }
  }

  if (workspaceContext) {
    entries['workspace-context.md'] = new Uint8Array(new TextEncoder().encode(workspaceContext));
  }

  return new Uint8Array(zipSync(entries));
}

export async function handleGetSkill(
  request: Request,
  env: Env,
  workspaceContext = '',
): Promise<Response> {
  const src = await getSkillSource(env);
  const meta = src?.meta ?? null;
  // Semver build metadata is dot-separated: 2.60.0+1a2b3c4d.ws.<hash>.
  const suffix = workspaceContext ? `.ws.${shortHash(workspaceContext)}` : '';
  const ct = 'application/zip';
  const disposition = `attachment; filename="${bundleFilename(meta)}"`;

  // HEAD and a conditional GET need the version, not the bytes (the asset copy carries
  // its hash; an R2 copy is hashed once per isolate).
  const bundle = src && !src.sha256 && request.method !== 'HEAD' ? await src.bundle() : null;
  const version = src ? (await servedVersion(src, bundle)) + suffix : 'unknown';
  const headers = getSkillHeaders(ct, meta, version, { 'Content-Disposition': disposition }, Boolean(suffix));

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  if (meta && request.headers.get('If-None-Match') === `"${version}"`) {
    return new Response(null, { status: 304, headers });
  }

  const zip = bundle ?? (src ? await src.bundle() : null);
  if (!zip) {
    return new Response('Skill bundle not found', { status: 404 });
  }

  const rewrite = skillOriginRewriter(env);
  const body =
    workspaceContext || rewrite
      ? rebuildBundle(zip, workspaceContext, rewrite)
      : new Uint8Array(zip);

  return new Response(body, { status: 200, headers });
}

export async function handleGetSkillVersion(env: Env): Promise<Response> {
  const src = await getSkillSource(env);
  if (!src) {
    return new Response(JSON.stringify({ error: 'Skill metadata not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const version = await servedVersion(src);
  return new Response(JSON.stringify({
    version,
    // The SKILL.md frontmatter version alone, for clients that compare semver.
    semver: src.meta.version,
    updated_at: src.meta.updated_at,
  }), {
    status: 200,
    headers: getSkillHeaders('application/json', src.meta, version),
  });
}

export async function handleGetSkillMeta(env: Env): Promise<Response> {
  const src = await getSkillSource(env);
  if (!src) {
    return new Response(JSON.stringify({ error: 'Skill metadata not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const meta = src.meta;
  const version = await servedVersion(src);

  const index = await getSkillFileText(env, src, 'INDEX.md');
  const sections = index ? extractSections(index) : [];

  return new Response(JSON.stringify({
    name: meta.name,
    version,
    semver: meta.version,
    updated_at: meta.updated_at,
    description: rewriteSkillOrigin(meta.description, env),
    format: 'zip',
    endpoints: {
      full: 'GET /v1/skill',
      version: 'GET /v1/skill/version',
      meta: 'GET /v1/skill/meta',
      file: 'GET /v1/skill/{path}',
    },
    sections,
    version_check: {
      description: 'Check if you have the latest skill version without downloading',
      methods: [
        'HEAD /v1/skill - Returns X-Skill-Version and X-Skill-Updated-At headers',
        'GET /v1/skill/version - Returns JSON with version and updated_at',
        'GET /v1/skill with If-None-Match: "version" - Returns 304 if unchanged',
      ],
      version_format: '<SKILL.md frontmatter version>+<first 8 hex of the skill.zip sha256>; changes with any skill content change. `semver` holds the frontmatter version alone.',
    },
  }), {
    status: 200,
    headers: getSkillHeaders('application/json', meta, version),
  });
}

export async function handleGetSkillFile(path: string, env: Env): Promise<Response> {
  let safePath = path.replace(/\.\./g, '').replace(/^\/+/, '');
  if (!safePath || safePath.includes('..')) {
    return new Response('Invalid path', { status: 400 });
  }
  if (safePath === 'team') {
    safePath = 'team/SKILL.md';
  } else if (safePath.endsWith('/')) {
    safePath += 'INDEX.md';
  }

  const src = await getSkillSource(env);
  const text = src ? await getSkillFileText(env, src, safePath) : null;
  if (!src || text === null) {
    return new Response('File not found', { status: 404 });
  }

  const contentType = safePath.endsWith('.json')
    ? 'application/json'
    : 'text/markdown; charset=utf-8';

  return new Response(rewriteSkillOrigin(text, env), {
    status: 200,
    headers: getSkillHeaders(contentType, src.meta, await servedVersion(src)),
  });
}

function extractSections(indexContent: string): string[] {
  const sections: string[] = [];
  const lines = indexContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^\|\s*\*\*([^*]+)\*\*/);
    if (match) {
      sections.push(match[1].trim());
    }
  }

  if (sections.length === 0) {
    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+)/);
      if (headerMatch) {
        sections.push(headerMatch[1].trim());
      }
    }
  }

  return sections;
}
