import type { AuthUser } from '../../api-auth';
import type { Env } from '../../types';
import { apiErrorResponse } from '../../http/api-error';
import { jsonResponse } from '../helpers/json-response';
import { logAudit } from '../../audit';
import { isCatalogEnabled } from '../../catalog/store';
import { findEntry } from '../../catalog/lineage';
import { loadGovernedCatalog } from '../../catalog/governed';
import {
  MAX_CERT_NOTE_CHARS,
  isCertDecision,
  recordCertification,
  resolveCertification,
} from '../../catalog/certification';
import type { CertificationRecord } from '../../catalog/types';

/** One entry's decisions, newest first, each marked when it was made on the current version. */
export function certificationHistory(decisions: CertificationRecord[], currentHash: string) {
  return decisions
    .slice()
    .reverse()
    .map(d => ({ ...d, current: d.content_hash === currentHash }));
}

/**
 * POST /v1/workspaces/{id}/catalog/entries/{entryId}/certify — an owner/admin decision
 * (`certified` | `revoked` | `deprecated`) on the entry's current version. The caller
 * (routeCatalogApi) has already checked the role. Sending the `content_hash` the reviewer
 * saw makes it a decision about that exact version: if the entry changed meanwhile, 409.
 */
export async function handleCatalogCertify(
  env: Env,
  workspaceId: string,
  entryId: string,
  user: AuthUser,
  request: Request
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { decision?: unknown; note?: unknown; content_hash?: unknown }
    | null;
  if (!isCertDecision(body?.decision)) {
    return apiErrorResponse({
      code: 'BAD_REQUEST',
      message: 'decision must be one of: certified, revoked, deprecated',
      status: 400,
      param: 'decision',
    });
  }
  const decision = body.decision;
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return apiErrorResponse({ code: 'BAD_REQUEST', message: 'note must be a string', status: 400, param: 'note' });
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > MAX_CERT_NOTE_CHARS) {
    return apiErrorResponse({
      code: 'BAD_REQUEST',
      message: `note is too long (max ${MAX_CERT_NOTE_CHARS} characters)`,
      status: 400,
      param: 'note',
    });
  }
  if (body.content_hash !== undefined && typeof body.content_hash !== 'string') {
    return apiErrorResponse({ code: 'BAD_REQUEST', message: 'content_hash must be a string', status: 400, param: 'content_hash' });
  }

  if (!(await isCatalogEnabled(env, workspaceId))) {
    return apiErrorResponse({
      code: 'CATALOG_DISABLED',
      message: 'This workspace has no data catalog',
      status: 409,
      hint: 'An owner or admin can turn it on: POST /v1/workspaces/{id}/catalog/enable',
    });
  }

  const catalog = await loadGovernedCatalog(env, workspaceId);
  const entry = findEntry(catalog.entries, entryId);
  if (!entry?.certification) return apiErrorResponse({ code: 'NOT_FOUND', message: 'No catalog entry with that id', status: 404 });

  const hash = entry.certification.content_hash;
  if (typeof body.content_hash === 'string' && body.content_hash !== hash) {
    return apiErrorResponse({
      code: 'CONFLICT',
      message: 'This entry changed after you opened it',
      status: 409,
      hint: 'Reload the entry, review the current version, then decide again.',
    });
  }

  const record = await recordCertification(env, {
    workspaceId,
    entryId: entry.id,
    contentHash: hash,
    decision,
    note: note || null,
    decidedBy: user.id,
  });
  await logAudit(env, {
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
    action: `catalog.${decision === 'certified' ? 'certify' : decision === 'revoked' ? 'revoke' : 'deprecate'}`,
    targetType: 'catalog_entry',
    targetId: entry.id,
    // `via` keeps provenance honest: a decision sent with a personal token may be an agent's.
    detail: { content_hash: hash, note: note || null, via: /^bearer\s/i.test(request.headers.get('Authorization') ?? '') ? 'token' : 'session' },
  });

  const decisions = [...(catalog.decisions.get(entry.id) ?? []), record];
  const certification = resolveCertification(entry.certification.declared_status ?? undefined, hash, decisions);
  return jsonResponse({
    ok: true,
    entry_id: entry.id,
    status: certification.status,
    certification,
    history: certificationHistory(decisions, hash),
  });
}
