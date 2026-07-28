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
}

/** Base URL for ASSETS.fetch — the binding only cares about the path. */
function assetUrl(path: string): string {
  return new URL(path, 'https://assets.local').toString();
}

async function getSkillMeta(env: Env): Promise<SkillMeta | null> {
  const obj = await env.ARTIFACTS.get(`${R2_PREFIX}/_meta.json`);
  if (obj) return obj.json();

  // Optional access: a Worker deployed without the [assets] binding should 404,
  // not throw a TypeError that surfaces as an opaque 500.
  const asset = await env.ASSETS?.fetch(assetUrl(SKILL_META_ASSET));
  if (!asset?.ok) return null;
  return asset.json();
}

/** The skill tree as a zip: R2 first (live updates), then the staged asset. */
async function getSkillBundle(env: Env): Promise<ArrayBuffer | null> {
  const obj = await env.ARTIFACTS.get(SKILL_BUNDLE_KEY);
  if (obj) return obj.arrayBuffer();

  const asset = await env.ASSETS?.fetch(assetUrl(SKILL_ZIP_ASSET));
  if (!asset?.ok) return null;
  return asset.arrayBuffer();
}

/** One file from the skill tree, by path relative to the skill root. */
async function getSkillFileText(env: Env, relPath: string): Promise<string | null> {
  const obj = await env.ARTIFACTS.get(`${R2_PREFIX}/${relPath}`);
  if (obj) return obj.text();

  const bundle = await getSkillBundle(env);
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
  versionSuffix = '',
  extra: Record<string, string> = {},
): Record<string, string> {
  const version = (meta?.version || 'unknown') + versionSuffix;
  return {
    'Content-Type': contentType,
    'X-Skill-Version': version,
    'X-Skill-Updated-At': meta?.updated_at || '',
    'ETag': `"${version}"`,
    'Cache-Control': `${versionSuffix ? 'private' : 'public'}, max-age=${CACHE_TTL}`,
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
  const meta = await getSkillMeta(env);
  const suffix = workspaceContext ? `+ws.${shortHash(workspaceContext)}` : '';
  const ct = 'application/zip';
  const disposition = `attachment; filename="${bundleFilename(meta)}"`;

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: getSkillHeaders(ct, meta, suffix, { 'Content-Disposition': disposition }),
    });
  }

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (meta && ifNoneMatch === `"${meta.version}${suffix}"`) {
    return new Response(null, {
      status: 304,
      headers: getSkillHeaders(ct, meta, suffix, { 'Content-Disposition': disposition }),
    });
  }

  const bundle = await getSkillBundle(env);
  if (!bundle) {
    return new Response('Skill bundle not found', { status: 404 });
  }

  const rewrite = skillOriginRewriter(env);
  const body =
    workspaceContext || rewrite
      ? rebuildBundle(bundle, workspaceContext, rewrite)
      : new Uint8Array(bundle);

  return new Response(body, {
    status: 200,
    headers: getSkillHeaders(ct, meta, suffix, { 'Content-Disposition': disposition }),
  });
}

export async function handleGetSkillVersion(env: Env): Promise<Response> {
  const meta = await getSkillMeta(env);
  if (!meta) {
    return new Response(JSON.stringify({ error: 'Skill metadata not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    version: meta.version,
    updated_at: meta.updated_at,
  }), {
    status: 200,
    headers: getSkillHeaders('application/json', meta),
  });
}

export async function handleGetSkillMeta(env: Env): Promise<Response> {
  const meta = await getSkillMeta(env);
  if (!meta) {
    return new Response(JSON.stringify({ error: 'Skill metadata not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const index = await getSkillFileText(env, 'INDEX.md');
  const sections = index ? extractSections(index) : [];

  return new Response(JSON.stringify({
    name: meta.name,
    version: meta.version,
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
    },
  }), {
    status: 200,
    headers: getSkillHeaders('application/json', meta),
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

  const text = await getSkillFileText(env, safePath);
  if (text === null) {
    return new Response('File not found', { status: 404 });
  }

  const meta = await getSkillMeta(env);
  const contentType = safePath.endsWith('.json')
    ? 'application/json'
    : 'text/markdown; charset=utf-8';

  return new Response(rewriteSkillOrigin(text, env), {
    status: 200,
    headers: getSkillHeaders(contentType, meta),
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
