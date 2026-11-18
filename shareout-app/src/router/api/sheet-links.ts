/**
 * POST /v1/workspaces/{ws}/sheet-links/inspect  { link }
 *
 * Checks a spreadsheet's share link before a public_sheet_sync job is saved: is it shared
 * with "Anyone with the link", what is it called, which tabs does it have. Workspace members
 * only (saving the job needs edit rights on its page), rate-limited per user. Fetches only
 * from Google's hosts, never the pasted URL (data/files/public-sheet-link.ts).
 */
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { jsonWithApiErrors } from '../../http/api-error';
import { checkKVRateLimit } from '../../rate-limit';
import { PublicLinkError, fetchPublicSheet, parseShareLink, type PublicLinkErrorCode } from '../../data/files/public-sheet-link';
import { SheetRowsError, sheetRows } from '../../data/files/sheet-rows';

const json = (data: unknown, status = 200) => jsonWithApiErrors(data, status);
const err = (error: string, code: string, status: number) => json({ error, code }, status);

const STATUS: Record<PublicLinkErrorCode, number> = {
  BAD_LINK: 400, NOT_PUBLIC: 422, NOT_FOUND: 422, NOT_SPREADSHEET: 422, TOO_LARGE: 422,
  BLOCKED: 502, UPSTREAM: 502, TIMEOUT: 504,
};

export async function routeSheetLinkApi(ctx: FetchContext): Promise<Response | null> {
  const m = ctx.path.match(/^\/v1\/workspaces\/([^/]+)\/sheet-links\/inspect$/);
  if (!m) return null;
  if (ctx.request.method !== 'POST') return ctx.addCORS(err('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
  return ctx.addCORS(await inspect(ctx, decodeURIComponent(m[1])));
}

async function inspect(ctx: FetchContext, workspaceId: string): Promise<Response> {
  const { env, request } = ctx;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) return err('Forbidden', 'FORBIDDEN', 403);

  let link: unknown;
  try { link = ((await request.json()) as { link?: unknown } | null)?.link; } catch { /* below */ }
  if (typeof link !== 'string') return err('Send { "link": "<share link>" }', 'VALIDATION_ERROR', 400);
  let parsed;
  try { parsed = parseShareLink(link); } catch (e) {
    return e instanceof PublicLinkError ? err(e.message, e.code, 400) : err('Not a Google share link', 'BAD_LINK', 400);
  }

  const rl = await checkKVRateLimit(env.RATE_LIMIT_KV, user.id, 'sheetLinkInspect', ctx.executionCtx ? (p) => ctx.executionCtx!.waitUntil(p) : undefined);
  if (!rl.allowed) return err('Too many links checked in the last hour. Try again later.', 'RATE_LIMITED', 429);

  try {
    const file = await fetchPublicSheet(parsed);
    const tab = await sheetRows(file.bytes);
    return json({
      kind: parsed.kind,
      fileName: file.fileName,
      sheets: tab.sheets,
      sheet: tab.sheet,
      rowCount: tab.rows.length,
      columns: tab.rows[0] ? Object.keys(tab.rows[0]).slice(0, 50) : [],
    });
  } catch (e) {
    if (e instanceof PublicLinkError) return err(e.message, e.code, STATUS[e.code]);
    if (e instanceof SheetRowsError) return err(e.message, `SHEET_${e.code}`, 422);
    throw e;
  }
}
