/**
 * The team's hand on what Knowledge learned, over MCP: confirm, fix, merge or discard entities,
 * connections and facts, and keep the team's types, glossary and rules. Each tool replays the
 * real /v1/workspaces/{id}/knowledge/* curation route in-process as the caller, so only owners
 * and admins change anything, members read the rules, and every edit holds on every re-learn
 * (knowledge/corpus/curation.ts). Names resolve the way knowledge_entity does: only what the
 * caller may see, and an edit that loses something (discard, merge, disconnect) needs an exact
 * name or an id.
 */
import type { BotWorkspace } from '../chat-agent/access';
import { relationType } from '../knowledge/corpus/extract';
import { NOT_MEMBER, errorText, fail, invalid, ok, str, type Args, type ToolContext, type ToolDef, type ToolResult } from './tool-kit';
import {
  WORKSPACE_ARG, entityDetail, findEntities, isConfirmed, isResult, knowledgeRequest, notAnswered, pickWorkspace,
  type EntityDetail, type EntitySummary,
} from './knowledge-tools';

const KEPT = 'Knowledge keeps this on every re-learn, and new files are fitted to it.';
const TELL = 'Answer in the person\'s language: say what changed in a line or two.';
const ADMINS = 'Only workspace owners and admins can use it; for anyone else it changes nothing and says so.';
const NOTHING = 'Nothing was changed.';

type Body = Record<string, unknown>;

/** The UI's discard reasons (shown translated in the Rules view), by the words a model uses. */
const REASONS: Record<string, string> = { not_relevant: 'noint', misread: 'wrong', not_a_thing: 'notent', duplicate: 'dup' };
const REASON_ARG = { type: 'string', enum: Object.keys(REASONS), description: 'Why, when the person said: not_relevant, misread (Knowledge read it wrong), not_a_thing, duplicate.' };

const adminsOnly = (w: BotWorkspace) =>
  invalid(`Only owners and admins of "${w.name}" can change what Knowledge learned. ${NOTHING} Tell the person to ask one of them.`, { workspace_id: w.id, forbidden: true });

/** The answer for a curation route that did not succeed. */
function refused(w: BotWorkspace, status: number, body: Body): ToolResult {
  if (body.code === 'KNOWLEDGE_DISABLED' || body.code === 'NOT_CONFIGURED') return notAnswered(w, status, body);
  // Membership was checked by pickWorkspace; a 403 here is a member who may not edit
  // (or, if the list was wrong, someone who is not in the workspace at all).
  if (status === 403) return w.role === 'member' ? adminsOnly(w) : fail(NOT_MEMBER);
  if (status === 409) {
    const other = /"into":"([^"]+)"/.exec(String(body.suggestion ?? ''))?.[1] ?? null;
    return invalid(`${String(body.error)}. ${NOTHING}${other ? ` If they are the same thing, merge them: knowledge_edit_entity with action "merge", this entity and into "${other}".` : ''}`,
      { workspace_id: w.id, conflict: true, other_id: other });
  }
  if (status === 404 || status === 400) return invalid(`${NOTHING} ${errorText(body, status)}`, { workspace_id: w.id });
  return notAnswered(w, status, body);
}

async function call(ctx: ToolContext, w: BotWorkspace, method: string, sub: string, body?: unknown, params?: Record<string, string>) {
  const r = await knowledgeRequest(ctx, w.id, method, sub, { body, params });
  return r.status >= 200 && r.status < 300 ? { ok: true as const, body: r.body } : { ok: false as const, result: refused(w, r.status, r.body) };
}

const nameList = (e: { name: string; type: string; id: string; status?: string }) => `- ${e.name} (${e.type}${isConfirmed(e) ? ', confirmed' : ''}) — id ${e.id}`;

/** One entity by id, exact name or alias. A single partial match is taken unless `strict`. */
async function resolveEntity(ctx: ToolContext, w: BotWorkspace, ref: string, strict: boolean): Promise<EntitySummary | ToolResult> {
  const found = await findEntities(ctx, w, ref, 6);
  if (isResult(found)) return found;
  const want = ref.toLowerCase();
  const exact = found.filter((e) => e.id === ref || [e.name, ...e.aliases].some((a) => a.toLowerCase() === want));
  if (exact.length === 1) return exact[0];
  if (!exact.length && found.length === 1 && !strict) return found[0];
  if (!found.length) {
    return invalid(`Nothing called "${ref}" is in what "${w.name}" knows. ${NOTHING} Check the name with knowledge_entity, or add it with knowledge_edit_entity (action "create").`, { workspace_id: w.id, found: false });
  }
  const list = exact.length ? exact : found;
  return invalid([
    `${exact.length > 1 ? `Several things are called "${ref}"` : `Nothing is called exactly "${ref}"`}. ${NOTHING} Ask the person which one they mean, then call again with its id:`,
    ...list.map(nameList),
  ].join('\n'), { workspace_id: w.id, ambiguous: true, matches: list.map(({ id, name, type }) => ({ id, name, type })) });
}

async function detailOf(ctx: ToolContext, w: BotWorkspace, e: EntitySummary): Promise<EntityDetail | ToolResult> {
  return (await entityDetail(ctx, w, e.id)) ?? invalid(`"${e.name}" is no longer in what "${w.name}" knows. ${NOTHING}`, { workspace_id: w.id, found: false });
}

const aliasesArg = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.trim().slice(0, 120)).slice(0, 20) : undefined);

// ── knowledge_edit_entity ───────────────────────────────────────────────────

const editEntity: ToolDef = {
  name: 'knowledge_edit_entity',
  title: 'Fix a client, person or project Knowledge learned',
  description: [
    'Changes one thing Knowledge learned (a company, person, product, project…) the way the team says it is.',
    'create: add it (name, type; description and aliases optional). update: rename (the old name stays an alias), retype, set its description or aliases.',
    'confirm: the team agrees with it as learned. discard: it goes and is never learned again. merge: two entries are the same thing, entity is folded into "into" (the one kept).',
    'Whatever is created, updated, confirmed or merged becomes the team\'s: ' + KEPT,
    'For when the person corrects Knowledge ("that is not a client", "X and Y are the same", "call it Z"). discard and merge cannot be undone from here, only restored with knowledge_edit_rules.',
    ADMINS,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'confirm', 'discard', 'merge'] },
      entity: { type: 'string', description: 'The thing to change, by its name or alias as the person said it, or its id. Not for create.' },
      name: { type: 'string', description: 'create: its name. update: the new name.' },
      type: { type: 'string', description: 'What kind of thing it is, e.g. Organization, Person, Project, Document. Required for create.' },
      description: { type: 'string', description: 'A short definition in the team\'s words.' },
      aliases: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Other names it goes by. On update this replaces the team\'s list.' },
      into: { type: 'string', description: 'merge: the one to keep, by name or id.' },
      reason: REASON_ARG,
      workspace_id: WORKSPACE_ARG,
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const action = String(args.action);
    const w = await pickWorkspace(ctx, args, 'knowledge_edit_entity');
    if (isResult(w)) return w;

    if (action === 'create') {
      const name = str(args.name, 120), type = str(args.type, 40);
      if (!name || !type) return invalid(`create needs a name and a type. ${NOTHING}`);
      const r = await call(ctx, w, 'POST', 'entities', { name, type, description: str(args.description, 2000) ?? undefined, aliases: aliasesArg(args.aliases) });
      if (!r.ok) return r.result;
      return ok(`Added "${name}" (${type}) to what "${w.name}" knows, confirmed by the team (id ${String(r.body.id)}). ${KEPT} ${TELL}`, { workspace_id: w.id, id: r.body.id });
    }

    const ref = str(args.entity, 200);
    if (!ref) return invalid(`Say which entity to ${action} (entity: its name or id). ${NOTHING}`);
    const e = await resolveEntity(ctx, w, ref, action === 'discard' || action === 'merge');
    if (isResult(e)) return e;
    const sub = `entities/${encodeURIComponent(e.id)}`;

    if (action === 'update') {
      const fields = { name: str(args.name, 120) ?? undefined, type: str(args.type, 40) ?? undefined, description: typeof args.description === 'string' ? args.description.slice(0, 2000) : undefined, aliases: aliasesArg(args.aliases) };
      if (Object.values(fields).every((v) => v === undefined)) return invalid(`update needs a new name, type, description or aliases. ${NOTHING}`);
      const r = await call(ctx, w, 'PATCH', sub, fields);
      if (!r.ok) return r.result;
      const renamed = fields.name && fields.name !== e.name;
      return ok([
        `Updated ${e.name}${renamed ? `, now called "${fields.name}"` : ''}${fields.type && fields.type !== e.type ? `, now a ${fields.type}` : ''}${fields.description !== undefined ? ', description set' : ''}${fields.aliases ? ', aliases set' : ''}.`,
        renamed ? `"${e.name}" stays an alias, so files that use it still land here.` : '',
        `It is confirmed by the team. ${KEPT} ${TELL}`,
      ].filter(Boolean).join(' '), { workspace_id: w.id, id: e.id });
    }
    if (action === 'confirm') {
      const r = await call(ctx, w, 'PATCH', sub, { confirm: true });
      if (!r.ok) return r.result;
      return ok(`${e.name} (${e.type}) is confirmed by the team. ${KEPT} ${TELL}`, { workspace_id: w.id, id: e.id });
    }
    if (action === 'discard') {
      const reason = typeof args.reason === 'string' ? REASONS[args.reason] : undefined;
      const r = await call(ctx, w, 'DELETE', sub, undefined, reason ? { reason } : undefined);
      if (!r.ok) return r.result;
      return ok(`Discarded ${e.name} (${e.type}) with its connections and facts. Knowledge will not learn it again; an owner or admin can bring it back from the discarded list (knowledge_review, show "discarded"). ${TELL}`, { workspace_id: w.id, id: e.id });
    }
    if (action === 'merge') {
      const intoRef = str(args.into, 200);
      if (!intoRef) return invalid(`merge needs into: the entity to keep. ${NOTHING}`);
      const into = await resolveEntity(ctx, w, intoRef, true);
      if (isResult(into)) return into;
      if (into.id === e.id) return invalid(`"${e.name}" and "${into.name}" are already the same entry. ${NOTHING}`);
      const r = await call(ctx, w, 'POST', `${sub}/merge`, { into: into.id });
      if (!r.ok) return r.result;
      return ok(`Merged ${e.name} into ${into.name}: its connections, facts and mentions are now on ${into.name}, and "${e.name}" is one of its names, so files that say it land there. ${KEPT} ${TELL}`, { workspace_id: w.id, id: into.id, merged: e.id });
    }
    return invalid(`action must be create, update, confirm, discard or merge. ${NOTHING}`);
  },
};

// ── knowledge_edit_connection ───────────────────────────────────────────────

/** The connection meant: by id, or among `from`'s connections, narrowed by `to` and `type`. */
async function findConnection(ctx: ToolContext, w: BotWorkspace, args: Args, strict: boolean) {
  const id = str(args.connection_id, 100);
  if (id) return { id, label: 'that connection' };
  const fromRef = str(args.from, 200);
  if (!fromRef) return invalid(`Say which connection: connection_id, or from (and to, type). ${NOTHING}`);
  const from = await resolveEntity(ctx, w, fromRef, false);
  if (isResult(from)) return from;
  const x = await detailOf(ctx, w, from);
  if (isResult(x)) return x;
  const toRef = str(args.to, 200)?.toLowerCase() ?? null;
  const type = str(args.type, 40) ? relationType(String(args.type)) : null;
  const hits = x.relations.filter((r) => (!toRef || r.other.id.toLowerCase() === toRef || r.other.name.toLowerCase() === toRef || (!strict && r.other.name.toLowerCase().includes(toRef)))
    && (!type || r.type === type));
  const line = (r: EntityDetail['relations'][number]) => (r.direction === 'out' ? `${from.name} ${r.type} ${r.other.name}` : `${r.other.name} ${r.type} ${from.name}`);
  if (hits.length === 1) return { id: hits[0].id, label: line(hits[0]) };
  if (!hits.length) {
    return invalid([`${from.name} has no connection like that. ${NOTHING}`, ...(x.relations.length ? ['Its connections:', ...x.relations.slice(0, 20).map((r) => `- ${line(r)} — id ${r.id}`)] : [])].join('\n'), { workspace_id: w.id, found: false });
  }
  return invalid([`Several of ${from.name}'s connections match. ${NOTHING} Ask which one, then call again with its connection_id:`, ...hits.map((r) => `- ${line(r)}${isConfirmed(r) ? ' (confirmed)' : ''} — id ${r.id}`)].join('\n'),
    { workspace_id: w.id, ambiguous: true, matches: hits.map((r) => ({ id: r.id, label: line(r) })) });
}

const editConnection: ToolDef = {
  name: 'knowledge_edit_connection',
  title: 'Connect or disconnect two things Knowledge knows',
  description: [
    'Changes how two things Knowledge knows are connected ("Acme is a client of Northwind").',
    'connect: from, type (e.g. client of, works at, part of, supplies) and to. confirm: the team agrees with a learned connection. disconnect: it goes and is never learned again.',
    'Name the connection by connection_id (from knowledge_entity), or by from plus to and/or type. ' + KEPT,
    ADMINS,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['connect', 'confirm', 'disconnect'] },
      from: { type: 'string', description: 'Where the connection starts, by name or id.' },
      type: { type: 'string', description: 'How they connect, in a few words, e.g. "client of".' },
      to: { type: 'string', description: 'Where it ends, by name or id.' },
      connection_id: { type: 'string', description: 'The connection\'s id, instead of from/to/type (confirm, disconnect).' },
      reason: REASON_ARG,
      workspace_id: WORKSPACE_ARG,
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const action = String(args.action);
    const w = await pickWorkspace(ctx, args, 'knowledge_edit_connection');
    if (isResult(w)) return w;
    if (action === 'connect') {
      const fromRef = str(args.from, 200), toRef = str(args.to, 200), type = str(args.type, 40);
      if (!fromRef || !toRef || !type) return invalid(`connect needs from, type and to. ${NOTHING}`);
      const from = await resolveEntity(ctx, w, fromRef, false);
      if (isResult(from)) return from;
      const to = await resolveEntity(ctx, w, toRef, false);
      if (isResult(to)) return to;
      const r = await call(ctx, w, 'POST', 'relations', { from: from.id, type, to: to.id });
      if (!r.ok) return r.result;
      return ok(`Connected: ${from.name} ${relationType(type)} ${to.name}, confirmed by the team (id ${String(r.body.id)}). ${KEPT} ${TELL}`, { workspace_id: w.id, id: r.body.id });
    }
    if (action !== 'confirm' && action !== 'disconnect') return invalid(`action must be connect, confirm or disconnect. ${NOTHING}`);
    const c = await findConnection(ctx, w, args, action === 'disconnect');
    if (isResult(c)) return c;
    const sub = `relations/${encodeURIComponent(c.id)}`;
    if (action === 'confirm') {
      const r = await call(ctx, w, 'POST', `${sub}/confirm`, {});
      if (!r.ok) return r.result;
      return ok(`Confirmed: ${c.label}. ${KEPT} ${TELL}`, { workspace_id: w.id, id: c.id });
    }
    const reason = typeof args.reason === 'string' ? REASONS[args.reason] : undefined;
    const r = await call(ctx, w, 'DELETE', sub, undefined, reason ? { reason } : undefined);
    if (!r.ok) return r.result;
    return ok(`Disconnected: ${c.label}. Knowledge will not learn that connection again; it can be brought back from the discarded list. ${TELL}`, { workspace_id: w.id, id: c.id });
  },
};

// ── knowledge_edit_fact ─────────────────────────────────────────────────────

const editFact: ToolDef = {
  name: 'knowledge_edit_fact',
  title: 'Add, confirm or remove a fact',
  description: [
    'Changes the facts on record about one thing (amounts, dates, statuses, owners…).',
    'add: the team states a fact (about, predicate, value, unit optional); it is shown as the team\'s word, and a file that says otherwise shows next to it, never in its place.',
    'confirm: the team agrees with a learned fact, which becomes the team\'s value for that predicate. remove: the fact goes and is never learned again.',
    'Name the fact by fact_id (from knowledge_facts structured results), or by about plus predicate (and value). ' + ADMINS,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'confirm', 'remove'] },
      about: { type: 'string', description: 'Who or what the fact is about, by name or id.' },
      predicate: { type: 'string', description: 'What the fact says, in a few words, e.g. "budget", "revision", "owner".' },
      value: { type: 'string', description: 'The value as written, e.g. "50k", "Rev. 06".' },
      unit: { type: 'string', description: 'Unit, if any, e.g. USD.' },
      fact_id: { type: 'string', description: 'The fact\'s id, instead of about/predicate (confirm, remove).' },
      workspace_id: WORKSPACE_ARG,
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const action = String(args.action);
    const w = await pickWorkspace(ctx, args, 'knowledge_edit_fact');
    if (isResult(w)) return w;
    if (action !== 'add' && action !== 'confirm' && action !== 'remove') return invalid(`action must be add, confirm or remove. ${NOTHING}`);
    const predicate = str(args.predicate, 60), value = str(args.value, 200);

    let factId = action === 'add' ? null : str(args.fact_id, 100);
    let label = 'that fact';
    if (!factId) {
      const aboutRef = str(args.about, 200);
      if (!aboutRef) return invalid(`Say who or what the fact is about (about), or give fact_id. ${NOTHING}`);
      const e = await resolveEntity(ctx, w, aboutRef, false);
      if (isResult(e)) return e;
      if (action === 'add') {
        if (!predicate || !value) return invalid(`add needs a predicate and a value. ${NOTHING}`);
        const r = await call(ctx, w, 'POST', `entities/${encodeURIComponent(e.id)}/facts`, { predicate, value, unit: str(args.unit, 20) ?? undefined });
        if (!r.ok) return r.result;
        return ok(`Recorded as the team's word: ${e.name} · ${relationType(predicate)}: ${value}${str(args.unit, 20) ? ` ${str(args.unit, 20)}` : ''} (id ${String(r.body.id)}). ${KEPT} ${TELL}`, { workspace_id: w.id, id: r.body.id });
      }
      if (!predicate) return invalid(`Say which fact (predicate, and value if there are several), or give fact_id. ${NOTHING}`);
      const x = await detailOf(ctx, w, e);
      if (isResult(x)) return x;
      const want = relationType(predicate), v = value?.toLowerCase() ?? null;
      const hits = x.facts.filter((f) => f.predicate === want && (!v || f.value.toLowerCase().includes(v)));
      const line = (f: EntityDetail['facts'][number]) => `${e.name} · ${f.predicate}: ${f.value}${f.unit ? ` ${f.unit}` : ''}${f.source ? ` [${f.source.title}]` : ' (team)'}`;
      if (!hits.length) {
        return invalid([`${e.name} has no "${want}" fact${v ? ` with "${value}"` : ''}. ${NOTHING}`, ...(x.facts.length ? ['Its facts:', ...x.facts.slice(0, 20).map((f) => `- ${line(f)} — id ${f.id}`)] : [])].join('\n'), { workspace_id: w.id, found: false });
      }
      if (hits.length > 1) {
        return invalid([`Several "${want}" facts are on record for ${e.name}. ${NOTHING} Ask which one, then call again with its fact_id:`, ...hits.map((f) => `- ${line(f)} — id ${f.id}`)].join('\n'),
          { workspace_id: w.id, ambiguous: true, matches: hits.map((f) => ({ id: f.id, label: line(f) })) });
      }
      factId = hits[0].id;
      label = line(hits[0]);
    }
    if (action === 'add') return invalid(`add needs about, predicate and value. ${NOTHING}`);
    const sub = `facts/${encodeURIComponent(factId)}`;
    const r = action === 'confirm' ? await call(ctx, w, 'POST', `${sub}/confirm`, {}) : await call(ctx, w, 'DELETE', sub);
    if (!r.ok) return r.result;
    return action === 'confirm'
      ? ok(`Confirmed as the team's value: ${label}. ${KEPT} ${TELL}`, { workspace_id: w.id, id: r.body.id ?? factId })
      : ok(`Removed: ${label}. Knowledge will not learn it again. ${TELL}`, { workspace_id: w.id, id: factId });
  },
};

// ── knowledge_rules (read) ──────────────────────────────────────────────────

interface SchemaType { type: string; description: string; ignored: boolean; team: boolean; count?: number }
interface RuleRow { id: string; kind: 'rule' | 'glossary'; term: string | null; text: string }

const rulesTool: ToolDef = {
  name: 'knowledge_rules',
  title: 'The team\'s rules for Knowledge',
  description: [
    'Reads how the workspace team shapes Knowledge: the kinds of things it keeps (its types, and which are ignored), whether it keeps only the team\'s types, the glossary (what the team\'s words mean) and plain-language rules.',
    'Every member may read them. The glossary and rules say how the team wants Knowledge read, and what is already set before types or rules are changed.',
  ].join(' '),
  inputSchema: { type: 'object', properties: { workspace_id: WORKSPACE_ARG }, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const w = await pickWorkspace(ctx, args, 'knowledge_rules');
    if (isResult(w)) return w;
    const [schema, rules] = await Promise.all([knowledgeRequest(ctx, w.id, 'GET', 'schema'), knowledgeRequest(ctx, w.id, 'GET', 'rules')]);
    if (schema.status !== 200) return refused(w, schema.status, schema.body);
    if (rules.status !== 200) return refused(w, rules.status, rules.body);
    const types = (schema.body.types ?? []) as SchemaType[];
    const list = (rules.body.rules ?? []) as RuleRow[];
    const team = types.filter((t) => t.team), learned = types.filter((t) => !t.team);
    const glossary = list.filter((r) => r.kind === 'glossary'), plain = list.filter((r) => r.kind === 'rule');
    const count = (t: SchemaType) => (t.count !== undefined ? ` · ${t.count}` : '');
    const text = [
      `How the team shapes Knowledge in "${w.name}":`,
      team.length ? 'The team\'s types:' : 'The team has not set its types yet.',
      ...team.map((t) => `- ${t.type}${t.ignored ? ' (ignored: never learned)' : ''}${t.description ? ` — ${t.description}` : ''}${count(t)}`),
      `Only the team's types: ${schema.body.teamOnly ? 'on (anything else is not learned)' : 'off'}.`,
      ...(learned.length ? ['Other types Knowledge learned:', learned.map((t) => `${t.type}${count(t)}`).join(', ')] : []),
      glossary.length ? 'Glossary:' : 'No glossary yet.',
      ...glossary.map((g) => `- ${g.term}: ${g.text} — id ${g.id}`),
      plain.length ? 'Rules:' : 'No rules yet.',
      ...plain.map((r) => `- ${r.text} — id ${r.id}`),
    ].join('\n');
    return ok(text, { workspace_id: w.id, types, team_types_only: !!schema.body.teamOnly, relation_types: schema.body.relationTypes ?? [], rules: list });
  },
};

// ── knowledge_edit_rules ────────────────────────────────────────────────────

const editRules: ToolDef = {
  name: 'knowledge_edit_rules',
  title: 'Change the team\'s rules for Knowledge',
  description: [
    'Changes what Knowledge is told before it learns every file, team decisions first.',
    'add_rule: a plain-language rule (text), e.g. "Procedures are coded PR-xx; never treat them as people". add_glossary: what one of the team\'s words means (term, text). remove_rule: by rule_id (from knowledge_rules).',
    'set_type: add or change one of the team\'s types (type, description; ignored true = never learn things of that type). remove_type. team_types_only: on true, Knowledge keeps only the team\'s types.',
    'restore: bring back something discarded (kind and key from knowledge_review, show "discarded").',
    'Rules apply to files learned from now on; owners and admins can re-learn older ones with knowledge_reindex.', ADMINS,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add_rule', 'add_glossary', 'remove_rule', 'set_type', 'remove_type', 'team_types_only', 'restore'] },
      text: { type: 'string', description: 'add_rule: the rule. add_glossary: what the term means.' },
      term: { type: 'string', description: 'add_glossary: the word or abbreviation.' },
      rule_id: { type: 'string', description: 'remove_rule: which one.' },
      type: { type: 'string', description: 'set_type / remove_type: the type, e.g. Procedure.' },
      description: { type: 'string', description: 'set_type: what counts as this type.' },
      ignored: { type: 'boolean', description: 'set_type: true to never learn things of this type.' },
      on: { type: 'boolean', description: 'team_types_only: true to keep only the team\'s types.' },
      kind: { type: 'string', enum: ['entity', 'relation', 'fact'], description: 'restore: what was discarded.' },
      key: { type: 'string', description: 'restore: its key, from the discarded list.' },
      workspace_id: WORKSPACE_ARG,
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const action = String(args.action);
    const w = await pickWorkspace(ctx, args, 'knowledge_edit_rules');
    if (isResult(w)) return w;
    const done = (r: Awaited<ReturnType<typeof call>>, text: string) => (r.ok ? ok(`${text} ${TELL}`, { workspace_id: w.id, ...(r.body.id ? { id: r.body.id } : {}) }) : r.result);
    const type = str(args.type, 40);
    switch (action) {
      case 'add_rule': {
        const text = str(args.text, 500);
        if (!text) return invalid(`add_rule needs the rule as text. ${NOTHING}`);
        return done(await call(ctx, w, 'POST', 'rules', { kind: 'rule', text }), `Rule saved: "${text}". Knowledge follows it on every file it learns from now on.`);
      }
      case 'add_glossary': {
        const term = str(args.term, 60), text = str(args.text, 500);
        if (!term || !text) return invalid(`add_glossary needs a term and its meaning (text). ${NOTHING}`);
        return done(await call(ctx, w, 'POST', 'rules', { kind: 'glossary', term, text }), `Glossary: "${term}" means ${text}. Knowledge reads it before every file.`);
      }
      case 'remove_rule': {
        const id = str(args.rule_id, 100);
        if (!id) return invalid(`remove_rule needs rule_id (knowledge_rules lists them). ${NOTHING}`);
        return done(await call(ctx, w, 'DELETE', `rules/${encodeURIComponent(id)}`), 'Rule removed.');
      }
      case 'set_type': {
        if (!type) return invalid(`set_type needs a type. ${NOTHING}`);
        const ignored = typeof args.ignored === 'boolean' ? args.ignored : undefined;
        const r = await call(ctx, w, 'PUT', `schema/types/${encodeURIComponent(type)}`, { description: str(args.description, 200) ?? undefined, ignored });
        return done(r, ignored ? `${type} is ignored: Knowledge will not learn things of that type.` : `${type} is one of the team's types${str(args.description, 200) ? `: ${str(args.description, 200)}` : ''}.`);
      }
      case 'remove_type': {
        if (!type) return invalid(`remove_type needs a type. ${NOTHING}`);
        return done(await call(ctx, w, 'DELETE', `schema/types/${encodeURIComponent(type)}`), `${type} is no longer one of the team's types.`);
      }
      case 'team_types_only': {
        if (typeof args.on !== 'boolean') return invalid(`team_types_only needs on: true or false. ${NOTHING}`);
        return done(await call(ctx, w, 'PUT', 'schema', { teamOnly: args.on }), args.on ? 'Knowledge now keeps only the team\'s types.' : 'Knowledge learns any type again, not only the team\'s.');
      }
      case 'restore': {
        const kind = str(args.kind, 20), key = str(args.key, 400);
        if (!kind || !key) return invalid(`restore needs kind and key from the discarded list (knowledge_review, show "discarded"). ${NOTHING}`);
        return done(await call(ctx, w, 'POST', 'discarded/restore', { kind, key }), 'Restored: Knowledge may learn it again the next time a file mentions it.');
      }
      default:
        return invalid(`Unknown action "${action}". ${NOTHING}`);
    }
  },
};

// ── knowledge_review (read) ─────────────────────────────────────────────────

interface Discarded { kind: string; key: string; label: string; reason: string | null; at: string }
interface LogEntry { at: string; action: string; detail: Record<string, unknown> }
const REASON_WORDS = Object.fromEntries(Object.entries(REASONS).map(([k, v]) => [v, k.replace(/_/g, ' ')]));

function logLine(x: LogEntry): string {
  const d = x.detail;
  // A changed field is logged as {from, to}; everything else as a plain value.
  const say = (v: unknown): string => {
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && 'to' in v) return `${String((v as { from?: unknown }).from)} → ${String((v as { to: unknown }).to)}`;
    return '';
  };
  const parts = [
    say(d.name), d.merged ? `merged ${say(d.merged)}` : '', d.type ? `${typeof d.type === 'string' ? '' : 'type '}${say(d.type)}` : '',
    d.predicate ? `${say(d.predicate)}: ${say(d.value)}` : '', say(d.term), say(d.text), say(d.label),
  ].filter(Boolean);
  return `- ${x.at.slice(0, 16).replace('T', ' ')} · ${x.action}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
}

const reviewTool: ToolDef = {
  name: 'knowledge_review',
  title: 'What Knowledge proposed, discarded and changed',
  description: [
    'For reviewing what Knowledge learned. show "proposals" (default): things it learned that the team has not confirmed yet, most mentioned first (optional type filter);',
    'confirm, fix or discard each with knowledge_edit_entity. show "discarded": what the team discarded, with the kind and key knowledge_edit_rules restores.',
    'show "history": the team\'s recent changes (optionally for one entity). Discarded and history are for owners and admins.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      show: { type: 'string', enum: ['proposals', 'discarded', 'history'], default: 'proposals' },
      type: { type: 'string', description: 'proposals: only this type, e.g. Organization.' },
      entity: { type: 'string', description: 'history: only changes to this entity, by name or id.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      workspace_id: WORKSPACE_ARG,
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const show = typeof args.show === 'string' ? args.show : 'proposals';
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const w = await pickWorkspace(ctx, args, 'knowledge_review');
    if (isResult(w)) return w;

    if (show === 'discarded') {
      const r = await call(ctx, w, 'GET', 'discarded', undefined, { limit: String(limit) });
      if (!r.ok) return r.result;
      const items = (r.body.discarded ?? []) as Discarded[];
      if (!items.length) return ok(`Nothing is discarded in "${w.name}".`, { workspace_id: w.id, discarded: [] });
      return ok([
        `${items.length} things the team discarded in "${w.name}" (Knowledge will not learn them again):`,
        ...items.map((x) => `- ${x.label} (${x.kind}${x.reason ? `, ${REASON_WORDS[x.reason] ?? x.reason}` : ''}) — key ${x.key}`),
        'To bring one back: knowledge_edit_rules with action "restore", its kind and key.',
      ].join('\n'), { workspace_id: w.id, discarded: items });
    }

    if (show === 'history') {
      let entity: EntitySummary | null = null;
      const ref = str(args.entity, 200);
      if (ref) {
        const e = await resolveEntity(ctx, w, ref, false);
        if (isResult(e)) return e;
        entity = e;
      }
      const r = await call(ctx, w, 'GET', 'history', undefined, { limit: String(limit), ...(entity ? { entity: entity.id } : {}) });
      if (!r.ok) return r.result;
      const items = (r.body.history ?? []) as LogEntry[];
      const scope = entity ? `${entity.name} in "${w.name}"` : `"${w.name}"`;
      if (!items.length) return ok(`The team has not changed anything about ${scope} yet.`, { workspace_id: w.id, history: [] });
      return ok([`The team's latest changes to ${scope}, newest first:`, ...items.map(logLine)].join('\n'), { workspace_id: w.id, history: items });
    }

    if (show !== 'proposals') return invalid('show must be proposals, discarded or history.');
    const type = str(args.type, 40);
    const r = await knowledgeRequest(ctx, w.id, 'GET', 'entities', { params: { status: 'draft', limit: String(limit), ...(type ? { type } : {}) } });
    if (r.status !== 200) return notAnswered(w, r.status, r.body);
    const items = (r.body.entities ?? []) as EntitySummary[];
    if (!items.length) return ok(`Nothing is waiting for review in "${w.name}"${type ? ` among ${type}` : ''}: everything Knowledge learned is confirmed or discarded.`, { workspace_id: w.id, proposals: [] });
    return ok([
      `${items.length} things Knowledge learned in "${w.name}" that the team has not confirmed yet${type ? ` (${type})` : ''}, most mentioned first:`,
      ...items.map((e) => `- ${e.name} (${e.type}) · ${e.mentions} mentions · ${e.sources.slice(0, 2).map((s) => s.title).join('; ')} — id ${e.id}`),
      'For each: knowledge_edit_entity confirm, update (rename or retype), merge into another, or discard — only as the person decides.',
    ].join('\n'), { workspace_id: w.id, proposals: items });
  },
};

export const KNOWLEDGE_CURATION_TOOLS: ToolDef[] = [rulesTool, reviewTool, editEntity, editConnection, editFact, editRules];
