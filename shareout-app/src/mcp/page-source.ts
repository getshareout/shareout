/**
 * A page's files for get_artifact and fetch, and the lossless-write guard for
 * update_artifact.
 *
 * Reads use the viewer gate of GET /v1/artifacts/{id}/files and stop at the limit of
 * GET /v1/artifacts/{id}/versions/{no}/source. Nothing is dropped quietly: a file that
 * is cut or left out says so (`truncated`), and an update that would lose work — the
 * page changed since it was read, or files of the current version are missing from the
 * new set — is refused before anything is published.
 */
import type { Env } from '../types';
import { requireRole } from '../artifacts/roles';
import { isTextMime } from '../artifacts/files';
import { SOURCE_MAX_BYTES } from '../artifacts/versions';
import { invalid, type ToolContext, type ToolResult } from './tool-kit';

/** File content (characters) one answer carries at most: get_version_source's limit. */
const SOURCE_LIMIT = SOURCE_MAX_BYTES;

interface Asset { path: string; r2_key: string; mime: string; size_bytes: number }

interface VersionFiles { version: number; entrypoint: string; assets: Asset[] }

export interface SourceFile {
  path: string;
  mime: string;
  size_bytes: number;
  encoding: 'utf8' | 'base64';
  /** Absent when the file did not fit. */
  content?: string;
  /** Cut or absent: sending it back would lose the rest. */
  truncated: boolean;
}

const MAX_LISTED = 20;

function listed(paths: string[]): string {
  return paths.length > MAX_LISTED
    ? `${paths.slice(0, MAX_LISTED).join(', ')} and ${paths.length - MAX_LISTED} more`
    : paths.join(', ');
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function versionFiles(env: Env, userId: string, artifactId: string, versionNo: number): Promise<VersionFiles | 'forbidden' | 'missing'> {
  const [forbidden, version] = await Promise.all([
    requireRole(env, artifactId, userId, 'viewer'),
    env.DB.prepare('SELECT id, version_no, entrypoint FROM versions WHERE artifact_id = ? AND version_no = ?')
      .bind(artifactId, versionNo).first<{ id: string; version_no: number; entrypoint: string }>(),
  ]);
  if (forbidden) return 'forbidden';
  if (!version) return 'missing';
  const { results } = await env.DB.prepare('SELECT path, r2_key, mime, size_bytes FROM assets WHERE version_id = ?')
    .bind(version.id).all<Asset>();
  return { version: version.version_no, entrypoint: version.entrypoint, assets: results ?? [] };
}

/** Characters a file takes in an answer: its text, or base64 (4 per 3 bytes). */
const cost = (a: Asset) => (isTextMime(a.mime) ? a.size_bytes : 4 * Math.ceil(a.size_bytes / 3));

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Reads files in order until SOURCE_LIMIT characters are used. Text is cut where the
 * limit falls (a UTF-16 character is at most 3 UTF-8 bytes, so a long file is read only
 * that far); a binary file comes whole as base64 or not at all, since half an image
 * cannot be sent back.
 */
async function loadFiles(env: Env, assets: Asset[]): Promise<SourceFile[]> {
  let left = SOURCE_LIMIT;
  const out: SourceFile[] = [];
  for (const a of assets) {
    const text = isTextMime(a.mime);
    const file: SourceFile = { path: a.path, mime: a.mime, size_bytes: a.size_bytes, encoding: text ? 'utf8' : 'base64', truncated: true };
    out.push(file);
    if (left <= 0 || (!text && cost(a) > left)) continue;
    const partial = text && a.size_bytes > 3 * left;
    const obj = await env.ARTIFACTS.get(a.r2_key, partial ? { range: { offset: 0, length: 3 * left } } : undefined);
    if (!obj) continue;
    const full = text ? await obj.text() : toBase64(new Uint8Array(await obj.arrayBuffer()));
    file.content = full.slice(0, left);
    file.truncated = partial || full.length > left;
    left -= file.content.length;
  }
  return out;
}

function heading(f: SourceFile): string {
  const state = f.content === undefined ? ' (not included)' : f.truncated ? ` (cut: first ${f.content.length} characters only)` : '';
  return `=== ${f.path} (${f.mime}, ${f.size_bytes} bytes${f.encoding === 'base64' ? ', base64' : ''})${state} ===`;
}

/**
 * get_artifact's source part, from the newest saved version — the one an update
 * replaces, usually the live one. `all`: every file (main file first, then smallest
 * first, so the most come back whole); otherwise the main file plus the names of the rest.
 */
export async function readSource(
  ctx: ToolContext,
  artifactId: string,
  versions: { live: number; newest: number },
  all: boolean,
): Promise<{ lines: string[]; data: Record<string, unknown> }> {
  const v = await versionFiles(ctx.env, ctx.user.id, artifactId, versions.newest);
  if (v === 'forbidden') return { lines: ['Its files are not shown: only the page\'s owner and people it is shared with as viewer or editor can read them.'], data: {} };
  if (v === 'missing') return { lines: ['It has no saved files to show.'], data: {} };
  const which = `version ${v.version}${v.version !== versions.live ? ` (saved, not live yet: people still see version ${versions.live})` : ''}`;

  if (all) {
    const first = (a: Asset) => (a.path === v.entrypoint ? 0 : 1);
    const files = await loadFiles(ctx.env, [...v.assets].sort((a, b) => first(a) - first(b) || cost(a) - cost(b) || a.path.localeCompare(b.path)));
    const cut = files.filter((f) => f.truncated && f.content !== undefined).map((f) => f.path);
    const missing = files.filter((f) => f.content === undefined).map((f) => f.path);
    const warning = cut.length || missing.length
      ? [`Only ${SOURCE_LIMIT / 1024} KB of file content fits in one answer.${cut.length ? ` Cut: ${listed(cut)}.` : ''}${missing.length ? ` Not included: ${listed(missing)}.` : ''}`
        + ' update_artifact needs every file back whole, so do not send these back as they are: to change this page without losing them, the person can edit it in ShareOut.']
      : [];
    return {
      lines: [
        `Files of ${which}: ${files.length} ${plural(files.length, 'file', 'files')}, main file ${v.entrypoint}.`,
        ...warning,
        ...files.flatMap((f) => (f.content === undefined ? [heading(f)] : [heading(f), f.content])),
      ],
      data: { version: v.version, entrypoint: v.entrypoint, files, truncated: cut.length + missing.length > 0 },
    };
  }

  const main = v.assets.find((a) => a.path === v.entrypoint);
  const others = v.assets.filter((a) => a !== main).map((a) => a.path).sort();
  const also = others.length
    ? [`Besides ${v.entrypoint}, this page has ${others.length} more ${plural(others.length, 'file', 'files')}: ${listed(others)}. update_artifact needs every file back, so read them all with include_files before changing it.`]
    : [];
  const data = { version: v.version, ...(others.length ? { other_files: others } : {}) };
  if (!main || !isTextMime(main.mime)) {
    return { lines: [...also, `The main file of ${which} is not text${main ? ` (${main.mime})` : ''}, so there is no source to show.`], data };
  }
  const [file] = await loadFiles(ctx.env, [main]);
  if (file.content === undefined) return { lines: [...also, `The source of ${which} could not be read.`], data };
  return {
    lines: [
      ...also,
      file.truncated
        ? `Content of ${which} (${main.path}), CUT: only the first ${file.content.length} characters of this ${main.size_bytes}-byte file fit in one answer. Do not send it back with update_artifact: everything after the cut would be lost. The person can edit this page in ShareOut.`
        : `Content of ${which} (${main.path}):`,
      file.content,
    ],
    data: { ...data, content: file.content, truncated: file.truncated, size_bytes: main.size_bytes },
  };
}

/** The main file's text of one version (fetch), or null when it has none to show. */
export async function mainText(ctx: ToolContext, artifactId: string, versionNo: number): Promise<{ text: string; truncated: boolean } | null> {
  const v = await versionFiles(ctx.env, ctx.user.id, artifactId, versionNo);
  if (typeof v === 'string') return null;
  const main = v.assets.find((a) => a.path === v.entrypoint);
  if (!main || !isTextMime(main.mime)) return null;
  const [file] = await loadFiles(ctx.env, [main]);
  return file.content === undefined ? null : { text: file.content, truncated: file.truncated };
}

/**
 * Why an update_artifact write would lose work, or null when it is safe: a newer
 * version than `base` (the one the caller read) exists, or the new files leave out
 * files of the newest version. With `viaContent` the one page replaces the main file,
 * even under a new name (index.md → index.html); every other file must be sent back.
 */
export async function lossyWrite(
  env: Env,
  artifactId: string,
  write: { base?: number; paths: string[]; viaContent: boolean; replaceAll: boolean },
): Promise<ToolResult | null> {
  const head = await env.DB.prepare(`
    SELECT v.id, v.version_no, v.entrypoint, v.created_at, u.name, u.email
    FROM versions v LEFT JOIN users u ON u.id = v.created_by
    WHERE v.artifact_id = ? ORDER BY v.version_no DESC LIMIT 1
  `).bind(artifactId).first<{ id: string; version_no: number; entrypoint: string; created_at: string; name: string | null; email: string | null }>();
  if (!head) return null;

  if (write.base !== undefined && write.base !== head.version_no) {
    const by = head.name || head.email || 'someone';
    // The newer number is left out on purpose: the way to get it is to read the page again.
    const text = write.base < head.version_no
      ? `Nothing was changed: the page changed after you read version ${write.base} (${by} saved a newer version at ${head.created_at}). Read it again with get_artifact, make your change on what it returns, and pass the version it reports as base_version, so their changes are kept.`
      : `Nothing was changed: this page has no version ${write.base}. Read it with get_artifact and pass the version it reports as base_version.`;
    return invalid(text, { code: 'VERSION_CONFLICT', base_version: write.base });
  }
  if (write.replaceAll) return null;

  const { results } = await env.DB.prepare('SELECT path FROM assets WHERE version_id = ? ORDER BY path')
    .bind(head.id).all<{ path: string }>();
  const current = (results ?? []).map((r) => r.path);
  const sent = new Set(write.paths);
  const gone = current.filter((p) => !sent.has(p) && !(write.viaContent && p === head.entrypoint));
  if (!gone.length) return null;
  const them = plural(gone.length, 'it', 'them');
  const text = write.viaContent
    ? `Nothing was changed: this page has ${current.length} files and content only replaces ${head.entrypoint}, so saving it would remove ${listed(gone)}. Read every file with get_artifact include_files and send them all back as files, with your change.`
    : `Nothing was changed: files leaves out ${gone.length} ${plural(gone.length, 'file', 'files')} of the current version, and saving it would remove ${them}: ${listed(gone)}. Send ${them} back too, unchanged (get_artifact include_files has the content).`;
  return invalid(
    `${text} Only if the person wants ${plural(gone.length, 'that file', 'those files')} gone, call again with replace_all_files: true.`,
    { code: 'WOULD_REMOVE_FILES', would_remove: gone },
  );
}
