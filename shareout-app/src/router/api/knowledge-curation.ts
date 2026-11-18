// The team's edits to the knowledge graph, under /v1/workspaces/{id}/knowledge/…:
//   POST   entities                    {name, type, description?, aliases?}  create (confirmed)
//   PATCH  entities/{id}               {name?, type?, description?, aliases?, confirm?}
//   DELETE entities/{id}?reason=       discard: gone, and never learned again
//   POST   entities/{id}/merge         {into}
//   POST   entities/{id}/facts         {predicate, value, unit?}
//   POST   relations                   {from, type, to}
//   POST   relations/{id}/confirm      ·  DELETE relations/{id}?reason=
//   POST   facts/{id}/confirm          ·  DELETE facts/{id}
//   GET    schema  ·  PUT schema {teamOnly}  ·  PUT|DELETE schema/types/{type} {description?, ignored?}
//   GET    rules   ·  POST rules {kind: rule|glossary, term?, text}  ·  DELETE rules/{id}
//   GET    discarded  ·  POST discarded/restore {kind, key}
//   GET    history?entity=&limit=
// Reading the schema and rules is for every member (they shape what everyone sees); every
// write, the discarded list and the history are for owners and admins.
import type { FetchContext } from '../context';
import { jsonResponse } from '../helpers/json-response';
import { apiErrorResponse } from '../../http/api-error';
import { corpusFor } from '../../knowledge/corpus/client';
import type { CurationOp, CurationResult } from '../../knowledge/corpus/curation';

type Store = NonNullable<ReturnType<typeof corpusFor>>;
type Body = Record<string, unknown>;

const isCurationRoute = (sub: string, method: string) =>
  (sub === 'entities' && method === 'POST')
  || (sub.startsWith('entities/') && method !== 'GET')
  || sub === 'relations' || sub.startsWith('relations/')
  || sub.startsWith('facts/')
  || sub === 'schema' || sub.startsWith('schema/')
  || sub === 'rules' || sub.startsWith('rules/')
  || sub === 'discarded' || sub.startsWith('discarded/')
  || sub === 'history';

const invalid = (message: string, param?: string) => apiErrorResponse({ message, code: 'VALIDATION_ERROR', status: 400, ...(param ? { param } : {}) });
const forbidden = () => apiErrorResponse({
  message: 'Only workspace owners and admins can change what Knowledge learned',
  code: 'FORBIDDEN',
  status: 403,
  hint: 'Ask an owner or admin of this workspace.',
});
const notAllowed = () => apiErrorResponse({ message: 'Method not allowed', code: 'METHOD_NOT_ALLOWED', status: 405 });
const str = (b: Body, k: string) => (typeof b[k] === 'string' ? (b[k] as string) : undefined);

async function body(ctx: FetchContext): Promise<Body | null> {
  const text = await ctx.request.text();
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : null;
  } catch {
    return null;
  }
}

function result(r: CurationResult, created = false): Response {
  if (r.ok) return jsonResponse({ ok: true, ...(r.id ? { id: r.id } : {}) }, created ? 201 : 200);
  if (r.code === 'NOT_FOUND') return apiErrorResponse({ message: r.message, code: 'NOT_FOUND', status: 404 });
  if (r.code === 'CONFLICT') {
    return apiErrorResponse({
      message: r.message, code: 'CONFLICT', status: 409,
      ...(r.otherId ? { suggestion: `POST entities/{id}/merge {"into":"${r.otherId}"}` } : {}),
    });
  }
  return invalid(r.message);
}

/** Null when `sub` is not a curation route (the caller carries on with its own routes). */
export async function routeKnowledgeCuration(
  ctx: FetchContext,
  p: { workspaceId: string; sub: string; canManage: boolean; userId: string; store: Store },
): Promise<Response | null> {
  const { sub, canManage, store } = p;
  const method = ctx.request.method;
  if (!isCurationRoute(sub, method)) return null;
  const url = ctx.url;
  const seg = sub.split('/').map(decodeURIComponent);

  // ----- reads -----
  if (method === 'GET') {
    if (sub === 'schema') return jsonResponse(await store.schema());
    if (sub === 'rules') return jsonResponse({ rules: await store.rules() });
    if (!canManage) return forbidden();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
    if (sub === 'discarded') return jsonResponse({ discarded: await store.discarded(limit) });
    if (sub === 'history') return jsonResponse({ history: await store.history({ entity: url.searchParams.get('entity') || undefined, limit }) });
    return notAllowed();
  }

  // ----- writes: owners and admins -----
  if (!canManage) return forbidden();
  const b = await body(ctx);
  if (!b) return invalid('Body must be a JSON object');
  const run = (op: CurationOp, created = false) => store.curate(p.userId, op).then((r) => result(r, created));

  if (seg[0] === 'entities') {
    if (seg.length === 1 && method === 'POST') {
      const name = str(b, 'name'), type = str(b, 'type');
      if (!name?.trim()) return invalid('name is required', 'name');
      if (!type?.trim()) return invalid('type is required', 'type');
      if (b.aliases !== undefined && !Array.isArray(b.aliases)) return invalid('aliases must be an array of strings', 'aliases');
      return run({ op: 'entity.create', name, type, description: str(b, 'description'), aliases: b.aliases as string[] | undefined }, true);
    }
    const id = seg[1];
    if (seg.length === 2 && method === 'PATCH') {
      if (b.aliases !== undefined && !Array.isArray(b.aliases)) return invalid('aliases must be an array of strings', 'aliases');
      const fields = { name: str(b, 'name'), type: str(b, 'type'), description: str(b, 'description'), aliases: b.aliases as string[] | undefined };
      if (Object.values(fields).every((v) => v === undefined)) {
        return b.confirm === true ? run({ op: 'entity.confirm', id }) : invalid('Send name, type, description, aliases or {"confirm": true}');
      }
      return run({ op: 'entity.update', id, ...fields });
    }
    if (seg.length === 2 && method === 'DELETE') return run({ op: 'entity.discard', id, reason: url.searchParams.get('reason') || str(b, 'reason') });
    if (seg.length === 3 && seg[2] === 'merge' && method === 'POST') {
      const into = str(b, 'into');
      if (!into) return invalid('into is required', 'into');
      return run({ op: 'entity.merge', id, into });
    }
    if (seg.length === 3 && seg[2] === 'facts' && method === 'POST') {
      const predicate = str(b, 'predicate'), value = str(b, 'value');
      if (!predicate?.trim() || !value?.trim()) return invalid('predicate and value are required', predicate?.trim() ? 'value' : 'predicate');
      return run({ op: 'fact.add', entityId: id, predicate, value, unit: str(b, 'unit') ?? null }, true);
    }
    return notAllowed();
  }

  if (seg[0] === 'relations') {
    if (seg.length === 1 && method === 'POST') {
      const from = str(b, 'from'), to = str(b, 'to'), type = str(b, 'type');
      if (!from || !to) return invalid('from and to are required', from ? 'to' : 'from');
      if (!type?.trim()) return invalid('type is required', 'type');
      return run({ op: 'relation.create', from, type, to }, true);
    }
    if (seg.length === 3 && seg[2] === 'confirm' && method === 'POST') return run({ op: 'relation.confirm', id: seg[1] });
    if (seg.length === 2 && method === 'DELETE') return run({ op: 'relation.discard', id: seg[1], reason: url.searchParams.get('reason') || str(b, 'reason') });
    return notAllowed();
  }

  if (seg[0] === 'facts') {
    if (seg.length === 3 && seg[2] === 'confirm' && method === 'POST') return run({ op: 'fact.confirm', id: seg[1] });
    if (seg.length === 2 && method === 'DELETE') return run({ op: 'fact.discard', id: seg[1] });
    return notAllowed();
  }

  if (seg[0] === 'schema') {
    if (seg.length === 1 && method === 'PUT') {
      if (typeof b.teamOnly !== 'boolean') return invalid('teamOnly (boolean) is required', 'teamOnly');
      return run({ op: 'schema.teamOnly', on: b.teamOnly });
    }
    if (seg.length === 3 && seg[1] === 'types' && seg[2]) {
      if (method === 'PUT') {
        if (b.ignored !== undefined && typeof b.ignored !== 'boolean') return invalid('ignored must be a boolean', 'ignored');
        return run({ op: 'type.set', type: seg[2], description: str(b, 'description'), ignored: b.ignored as boolean | undefined });
      }
      if (method === 'DELETE') return run({ op: 'type.remove', type: seg[2] });
    }
    return notAllowed();
  }

  if (seg[0] === 'rules') {
    if (seg.length === 1 && method === 'POST') {
      const kind = str(b, 'kind') ?? 'rule';
      if (kind !== 'rule' && kind !== 'glossary') return invalid('kind is rule or glossary', 'kind');
      const text = str(b, 'text');
      if (!text?.trim()) return invalid('text is required', 'text');
      return run({ op: 'rule.add', kind, term: str(b, 'term'), text }, true);
    }
    if (seg.length === 2 && method === 'DELETE') return run({ op: 'rule.remove', id: seg[1] });
    return notAllowed();
  }

  if (seg[0] === 'discarded' && seg[1] === 'restore' && method === 'POST') {
    const kind = str(b, 'kind'), key = str(b, 'key');
    if (kind !== 'entity' && kind !== 'relation' && kind !== 'fact') return invalid('kind is entity, relation or fact', 'kind');
    if (!key) return invalid('key is required', 'key');
    return run({ op: 'discarded.restore', kind, key });
  }
  return notAllowed();
}
