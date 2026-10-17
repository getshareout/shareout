// Per-table write roles (work/039 B4 / maturity). Policy comes from the published
// artifact manifest: sources.tables.<name>.write = "owner" | "collaborator" | "any",
// declared in the entry page's <script type="shareout/manifest">. A table with no
// declaration defaults to "any"; a declaration that cannot be read counts as "owner".
import type { Env } from '../../types';
import type { DataContext } from '../middleware';

export type TableWriteRole = 'owner' | 'collaborator' | 'any';

const VALID: ReadonlySet<string> = new Set(['owner', 'collaborator', 'any']);

/** Pure: extract write role for one table from a version's manifest_json. */
export function tableWriteRoleFromManifest(
  manifestJson: string | null | undefined,
  tableName: string,
): TableWriteRole {
  if (!manifestJson) return 'any';
  try {
    const m = JSON.parse(manifestJson) as {
      sources?: { tables?: Record<string, { write?: string }> };
    };
    const raw = m.sources?.tables?.[tableName]?.write;
    if (typeof raw === 'string' && VALID.has(raw)) return raw as TableWriteRole;
  } catch {
    /* ignore bad JSON — treat as no policy */
  }
  return 'any';
}

/**
 * Pure: may this viewer mutate rows under the given write role?
 * - any → everyone who already passed the data router (incl. viewers)
 * - collaborator → artifact owner or editor (ctx.isOwner, which includes editors)
 * - owner → true artifact owner only (ctx.isArtifactOwner)
 */
export function mayWriteTable(
  role: TableWriteRole,
  caps: { isOwner: boolean; isArtifactOwner: boolean },
): boolean {
  if (role === 'any') return true;
  if (role === 'collaborator') return caps.isOwner || caps.isArtifactOwner;
  return caps.isArtifactOwner;
}

const STRICTNESS: Record<TableWriteRole, number> = { any: 0, collaborator: 1, owner: 2 };

function stricter(a: TableWriteRole, b: TableWriteRole): TableWriteRole {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

const MANIFEST_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?shareout\/manifest["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * Pure: write role for one table from a page's HTML. No manifest or no entry for the
 * table → "any". A manifest that does not parse, or an entry whose `write` is not one
 * of the known roles, → "owner" (the author meant to restrict something).
 */
export function tableWriteRoleFromHtml(html: string | null | undefined, tableName: string): TableWriteRole {
  if (!html) return 'any';
  let role: TableWriteRole = 'any';
  for (const m of html.matchAll(MANIFEST_SCRIPT)) {
    let parsed: { sources?: { tables?: Record<string, { write?: unknown }> } };
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return 'owner';
    }
    const entry = parsed?.sources?.tables?.[tableName];
    if (!entry || entry.write === undefined) continue;
    role = stricter(role, typeof entry.write === 'string' && VALID.has(entry.write) ? entry.write as TableWriteRole : 'owner');
  }
  return role;
}

/** Thrown when the published page cannot be read, so the caller fails closed. */
export class TablePolicyUnavailable extends Error {}

// Version content is immutable, so a version's parsed HTML is safe to memo per isolate.
const pageMemo = new Map<string, string[]>();
const PAGE_MEMO_MAX = 200;

async function versionPages(env: Env, versionId: string, entrypoints: string[]): Promise<string[]> {
  const cached = pageMemo.get(versionId);
  if (cached) return cached;
  const pages: string[] = [];
  for (const path of entrypoints) {
    const asset = await env.DB.prepare('SELECT r2_key FROM assets WHERE version_id = ? AND path = ?')
      .bind(versionId, path).first<{ r2_key: string }>();
    if (!asset) continue;
    const obj = await env.ARTIFACTS.get(asset.r2_key);
    if (!obj) throw new TablePolicyUnavailable(`missing page ${path}`);
    pages.push(await obj.text());
  }
  if (pageMemo.size >= PAGE_MEMO_MAX) pageMemo.clear();
  pageMemo.set(versionId, pages);
  return pages;
}

/** Production-deployment write role for one table. Throws TablePolicyUnavailable on a read failure. */
export async function resolveTableWriteRole(
  env: Env,
  artifactId: string,
  tableName: string,
): Promise<TableWriteRole> {
  const row = await env.DB.prepare(
    `SELECT v.id AS version_id, v.manifest_json AS manifest_json, v.entrypoint AS entrypoint,
            v.mobile_entrypoint AS mobile_entrypoint
     FROM deployments d
     JOIN versions v ON v.id = d.version_id
     WHERE d.artifact_id = ? AND d.channel = 'production'
     LIMIT 1`,
  ).bind(artifactId).first<{ version_id: string; manifest_json: string | null; entrypoint: string | null; mobile_entrypoint: string | null }>();
  let role = tableWriteRoleFromManifest(row?.manifest_json, tableName);
  if (!row?.version_id || !row.entrypoint || !/\.html?$/i.test(row.entrypoint)) return role;
  const entrypoints = [row.entrypoint, row.mobile_entrypoint].filter((p): p is string => !!p && /\.html?$/i.test(p));
  let pages: string[];
  try {
    pages = await versionPages(env, row.version_id, [...new Set(entrypoints)]);
  } catch (err) {
    throw err instanceof TablePolicyUnavailable ? err : new TablePolicyUnavailable(String(err));
  }
  for (const html of pages) role = stricter(role, tableWriteRoleFromHtml(html, tableName));
  return role;
}

/** HTTP gate for table mutations — null when allowed, error payload when not. */
export async function denyTableWrite(
  ctx: DataContext,
  tableName: string,
): Promise<{ code: string; message: string; status: number; hint: string; suggestion: string } | null> {
  // Trusted internal callers (crew/bot) build DataContext without HTTP auth flags;
  // isArtifactOwner/isOwner may both be undefined — treat as system/owner path.
  if (ctx.isArtifactOwner === undefined && ctx.isOwner === undefined) return null;

  let role: TableWriteRole;
  try {
    role = await resolveTableWriteRole(ctx.env, ctx.artifactId, tableName);
  } catch {
    // The page that declares the policy could not be read: allow only the owner.
    role = 'owner';
  }
  if (mayWriteTable(role, {
    isOwner: !!ctx.isOwner,
    isArtifactOwner: !!ctx.isArtifactOwner,
  })) {
    return null;
  }

  const who =
    role === 'owner'
      ? 'the artifact owner'
      : 'the artifact owner or an editor';
  return {
    code: 'TABLE_WRITE_FORBIDDEN',
    message: `Writing to table "${tableName}" requires ${who}`,
    status: 403,
    hint: `This table's manifest sets write: "${role}".`,
    suggestion:
      role === 'owner'
        ? 'Sign in as the artifact owner, or change sources.tables.' + tableName + '.write in the manifest.'
        : 'Ask for editor access, or set sources.tables.' + tableName + '.write to "any" if viewers should edit rows.',
  };
}
