// Per-table write roles (work/039 B4 / maturity). Policy comes from the published
// artifact manifest: sources.tables.<name>.write = "owner" | "collaborator" | "any".
// Default "any" preserves pre-policy behaviour for existing artifacts.
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

/** Production-deployment manifest write role for one table (1 D1 read). */
export async function resolveTableWriteRole(
  env: Env,
  artifactId: string,
  tableName: string,
): Promise<TableWriteRole> {
  const row = await env.DB.prepare(
    `SELECT v.manifest_json AS manifest_json
     FROM deployments d
     JOIN versions v ON v.id = d.version_id
     WHERE d.artifact_id = ? AND d.channel = 'production'
     LIMIT 1`,
  ).bind(artifactId).first<{ manifest_json: string | null }>();
  return tableWriteRoleFromManifest(row?.manifest_json, tableName);
}

/** HTTP gate for table mutations — null when allowed, error payload when not. */
export async function denyTableWrite(
  ctx: DataContext,
  tableName: string,
): Promise<{ code: string; message: string; status: number; hint: string; suggestion: string } | null> {
  // Trusted internal callers (crew/bot) build DataContext without HTTP auth flags;
  // isArtifactOwner/isOwner may both be undefined — treat as system/owner path.
  if (ctx.isArtifactOwner === undefined && ctx.isOwner === undefined) return null;

  const role = await resolveTableWriteRole(ctx.env, ctx.artifactId, tableName);
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
