/**
 * The tools the MCP connector offers. Each one calls the same domain function or
 * handler the REST API uses — in-process, with the caller's own identity — so every
 * existing authz, quota, moderation and visibility rule applies unchanged.
 *
 * Results are written for a model that talks to a non-technical person: what happened,
 * the link, who can see it, and any notice to pass on, in plain words.
 */
import type { Env } from '../types';
import { hashToken } from '../api-auth';
import { handlePublish } from '../publish/handle-publish';
import { handleListArtifacts, handleGetArtifact } from '../artifacts/crud';
import { handleGetArtifactFiles } from '../artifacts/files';
import { requireRole } from '../artifacts/roles';
import { listWorkspacesForUser, type BotWorkspace } from '../chat-agent/access';
import { quickSearch } from '../search/quick-search';
import { openTicket } from '../support/intake';
import { generateSlug } from '../validation';
import { createLogger, logError } from '../logging';
import {
  ON_FAILURE, errorText, fail, getRequest, ok, readJson, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';
import { MEMBER_TOOLS } from './member-tools';

export type { ToolContext, ToolResult } from './tool-kit';

export const SERVER_INSTRUCTIONS = [
  'ShareOut turns a page you write (HTML or Markdown) into a web link people can open.',
  'Talk to the person in the language they use, in plain everyday words. Avoid technical jargon',
  '(do not say HTML, artifact, deploy, slug or token unless they do).',
  'To publish: write a complete, self-contained page and call publish_artifact. Afterwards always give the',
  'person the link and say who can see it. If the result carries a notice (visibility changed, under review,',
  'a warning), tell them plainly.',
  'To change a page they already have: find it with list_artifacts, then call update_artifact (it replaces the whole page).',
  'If they have several workspaces and did not say which one, ask them before publishing.',
  'Workspace owners and admins can invite people with invite_members: confirm the emails and the role with them first,',
  'then say who was invited, who already was a member and who was skipped.',
  'If anything fails or behaves unexpectedly, call report_problem with what happened, then tell the person',
  'the ShareOut team was notified. For how-to questions about ShareOut, call get_help.',
].join(' ');

const MAX_CONTENT_CHARS = 60_000;

function artifactUrl(origin: string, routingSlug: string): string {
  return `${origin}/a/${routingSlug}/`;
}

// ── shared pieces ───────────────────────────────────────────────────────────

type Format = 'html' | 'markdown';

function detectFormat(content: string, requested: unknown): Format {
  if (requested === 'html' || requested === 'markdown') return requested;
  return /<(html|body|div|section|main|p|h1|table|style|script)\b/i.test(content) ? 'html' : 'markdown';
}

function fileFor(content: string, format: Format) {
  return format === 'html'
    ? { entrypoint: 'index.html', files: [{ path: 'index.html', content, mime: 'text/html' }] }
    : { entrypoint: 'index.md', files: [{ path: 'index.md', content, mime: 'text/markdown' }] };
}

function audience(visibility: string, workspace: BotWorkspace | null): string {
  if (visibility === 'public') return 'anyone with the link';
  if (visibility === 'workspace') return workspace ? `everyone in the workspace "${workspace.name}"` : 'people in the workspace';
  return 'only the person (and anyone they share it with)';
}

/** One new artifact per publish_artifact call: never silently overwrite a same-named page. */
async function freshSlug(env: Env, userId: string, workspaceId: string | null, title: string): Promise<string> {
  const base = generateSlug(title).slice(0, 44);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 5)}`;
    const taken = await env.DB.prepare(
      'SELECT 1 FROM artifacts WHERE display_slug = ? AND deleted_at IS NULL AND (workspace_id = ? OR owner_id = ?) LIMIT 1'
    ).bind(slug, workspaceId, userId).first();
    if (!taken) return slug;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Runs the real /v1/publish handler in-process as the caller. */
async function runPublish(ctx: ToolContext, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = new Request(`${ctx.origin}/v1/publish`, {
    method: 'POST',
    headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await handlePublish(req, ctx.env, ctx.executionCtx);
  return { status: res.status, body: await readJson(res) };
}

function describePublish(
  verb: 'Published' | 'Updated',
  title: string,
  result: Record<string, unknown>,
  workspace: BotWorkspace | null,
): ToolResult {
  const deployment = (result.deployment ?? {}) as Record<string, string>;
  const url = deployment.subdomain_url || deployment.url;
  const visibility = String(result.visibility ?? 'private');
  const notes: string[] = [];
  const moderation = result.moderation as { message?: string } | undefined;
  if (moderation?.message) notes.push(moderation.message);
  if (typeof result.notice === 'string') notes.push(result.notice);
  if (result.visibility_downgraded) notes.push(`It was published as ${visibility}, not ${String(result.requested_visibility)}.`);
  if (Array.isArray(result.warnings)) notes.push(...result.warnings.map(String));
  const approval = result.approval_required as { required?: number } | undefined;
  if (approval?.required) notes.push('This workspace requires an admin to approve the page before it goes live.');

  const lines = [
    `${verb} "${title}".`,
    `Link: ${url}`,
    `Who can see it: ${audience(visibility, workspace)}.`,
    ...(notes.length ? ['Tell the person:', ...notes.map((n) => `- ${n}`)] : []),
    'Give the person the link.',
  ];
  return ok(lines.join('\n'), {
    url,
    artifact_id: (result.artifact as { id?: string } | undefined)?.id,
    version: (result.version as { version_no?: number } | undefined)?.version_no,
    visibility,
    workspace_id: workspace?.id ?? null,
    notices: notes,
    visibility_downgraded: Boolean(result.visibility_downgraded),
  });
}

async function mainFileText(ctx: ToolContext, artifactId: string): Promise<string | null> {
  const res = await handleGetArtifactFiles(getRequest(ctx, `/v1/artifacts/${artifactId}/files`), ctx.env, ctx.user, artifactId);
  if (!res.ok) return null;
  const body = (await readJson(res)) as { entrypoint?: string; files?: Array<{ path: string; content: string; encoding: string }> };
  const main = body.files?.find((f) => f.path === body.entrypoint && f.encoding === 'utf8');
  return main ? main.content.slice(0, MAX_CONTENT_CHARS) : null;
}

// ── tools ───────────────────────────────────────────────────────────────────

const whoami: ToolDef = {
  name: 'whoami',
  title: 'Who am I',
  description: 'Shows which ShareOut account is connected and its workspaces. Answer the person in their language.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx) {
    const workspaces = await listWorkspacesForUser(ctx.env, ctx.user.id);
    const list = workspaces.map((w) => `- ${w.name} (id ${w.id}, ${w.role})`).join('\n') || '- none (pages go to the personal space)';
    return ok(`Connected as ${ctx.user.email ?? ctx.user.id}.\nWorkspaces:\n${list}`, {
      user: { id: ctx.user.id, email: ctx.user.email },
      workspaces,
    });
  },
};

const listWorkspaces: ToolDef = {
  name: 'list_workspaces',
  title: 'List workspaces',
  description: 'Lists the ShareOut workspaces (teams) the person belongs to, with their ids. Use it to ask which workspace to publish to.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx) {
    const workspaces = await listWorkspacesForUser(ctx.env, ctx.user.id);
    const list = workspaces.map((w) => `- ${w.name} (id ${w.id}, ${w.artifactCount} pages)`).join('\n');
    return ok(workspaces.length ? list : 'The person has no workspaces; pages are published to their personal space.', { workspaces });
  },
};

const listArtifacts: ToolDef = {
  name: 'list_artifacts',
  title: 'List pages',
  description: 'Lists or searches the pages the person can see on ShareOut, newest first, with links. Optional workspace_id narrows to one workspace; search finds pages by name.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'Only pages in this workspace.' },
      search: { type: 'string', description: 'Words to look for in page names.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const workspaceId = str(args.workspace_id, 100);
    const search = str(args.search, 200);
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);

    let pages: Array<{ id: string; title: string; url: string; type?: string; visibility?: string; updated_at?: string | null }>;
    if (search) {
      const result = await quickSearch(ctx.env, ctx.user.id, { q: search, workspaceId: workspaceId ?? undefined, groups: ['artifacts'], limit });
      pages = result.artifacts.map((h) => ({ id: h.id, title: h.title, url: artifactUrl(ctx.origin, h.slug ?? h.id), type: h.artifactType }));
    } else {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (workspaceId) qs.set('workspace_id', workspaceId);
      const res = await handleListArtifacts(getRequest(ctx, `/v1/artifacts?${qs}`), ctx.env, ctx.user);
      const body = await readJson(res);
      if (!res.ok) return fail(`Could not list pages: ${errorText(body, res.status)}`);
      const rows = (body.artifacts ?? []) as Array<{ id: string; name: string; slug: string; artifact_type: string; visibility: string; updated_at: string | null }>;
      pages = rows.map((a) => ({ id: a.id, title: a.name, url: artifactUrl(ctx.origin, a.slug), type: a.artifact_type, visibility: a.visibility, updated_at: a.updated_at }));
    }
    const text = pages.length
      ? pages.map((p) => `- ${p.title} — ${p.url} (id ${p.id})`).join('\n')
      : 'No pages found.';
    return ok(text, { pages });
  },
};

const getArtifact: ToolDef = {
  name: 'get_artifact',
  title: 'Get a page',
  description: 'Details of one page: name, link, who can see it, version. Set include_content to also get the page source (to edit it with update_artifact).',
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      include_content: { type: 'boolean', default: false },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return fail('artifact_id is required.');
    const res = await handleGetArtifact(getRequest(ctx, `/v1/artifacts/${id}`), ctx.env, ctx.user, id);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not open that page: ${errorText(body, res.status)}`);
    const content = args.include_content === true ? await mainFileText(ctx, id) : null;
    const text = [
      `"${String(body.name)}" — ${String(body.url)}`,
      `Visibility: ${String(body.visibility)}. Version ${String(body.current_version)}. Updated ${String(body.updated_at ?? body.created_at)}.`,
      ...(content !== null ? ['Content:', content] : []),
    ].join('\n');
    return ok(text, { artifact: body, ...(content !== null ? { content } : {}) });
  },
};

const publishArtifact: ToolDef = {
  name: 'publish_artifact',
  title: 'Publish a page',
  description: [
    'Publishes a new page on ShareOut and returns its link.',
    'content is a complete, self-contained HTML document (inline CSS/JS) or Markdown text.',
    'workspace_id: needed when the person has more than one workspace — ask them which one.',
    'visibility: "workspace" (default: everyone in the workspace), "private" (only them) or "public" (anyone with the link).',
    'Afterwards give the person the link in their language, in plain words, and pass on any notice in the result.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page name, as the person would call it.' },
      content: { type: 'string', description: 'The full page: an HTML document or Markdown.' },
      format: { type: 'string', enum: ['html', 'markdown'], description: 'Defaults to a guess from the content.' },
      workspace_id: { type: 'string' },
      visibility: { type: 'string', enum: ['workspace', 'private', 'public'] },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const title = str(args.title, 120);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!title || !content.trim()) return fail('A title and the page content are both needed.');

    const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
    if (resolved.notMember) return fail('The person is not a member of that workspace. Call list_workspaces to see the right ids.');
    if (resolved.choices) {
      return ok(workspaceChoiceText('publish_artifact', resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
    }
    const workspace = resolved.workspace;

    const wanted = args.visibility === 'public' || args.visibility === 'private' || args.visibility === 'workspace' ? args.visibility : 'workspace';
    const visibility = wanted === 'workspace' && !workspace ? 'private' : wanted;
    const format = detectFormat(content, args.format);

    const { status, body } = await runPublish(ctx, {
      name: title,
      slug: await freshSlug(ctx.env, ctx.user.id, workspace?.id ?? null, title),
      ...fileFor(content, format),
      workspace_id: workspace?.id,
      visibility,
    });
    if (status >= 400) return fail(`The page was not published: ${errorText(body, status)}`, { status, code: body.code });
    return describePublish('Published', title, body, workspace);
  },
};

const updateArtifact: ToolDef = {
  name: 'update_artifact',
  title: 'Update a page',
  description: [
    'Replaces the content of a page the person already has (keeps its link and who can see it) and saves it as a new version.',
    'Send the whole new page, not a fragment. Find the artifact_id with list_artifacts; get_artifact with include_content gives the current source.',
    'Afterwards give the person the link.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      content: { type: 'string', description: 'The full new page: an HTML document or Markdown.' },
      title: { type: 'string', description: 'New name, if it should change.' },
      format: { type: 'string', enum: ['html', 'markdown'] },
    },
    required: ['artifact_id', 'content'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    const content = typeof args.content === 'string' ? args.content : '';
    if (!id || !content.trim()) return fail('artifact_id and the new content are both needed.');

    const row = await ctx.env.DB.prepare(
      'SELECT name, display_slug, owner_id, workspace_id, visibility, artifact_type FROM artifacts WHERE id = ? AND deleted_at IS NULL'
    ).bind(id).first<{ name: string; display_slug: string | null; owner_id: string | null; workspace_id: string | null; visibility: string; artifact_type: string }>();
    if (!row) return fail('That page was not found.');
    if (await requireRole(ctx.env, id, ctx.user.id, 'editor')) return fail('The person cannot edit that page.');
    if (row.artifact_type !== 'html' && row.artifact_type !== 'markdown') {
      return fail('Only HTML or Markdown pages can be updated from here. The person can edit it in ShareOut.');
    }
    // Publishing upserts by (display slug, workspace) — or, for a personal page, by
    // (display slug, owner). Anything that would make that key land on a different
    // artifact is refused rather than risk overwriting the wrong page.
    if (!row.display_slug || (!row.workspace_id && row.owner_id !== ctx.user.id)) {
      return fail('This page can only be updated in ShareOut itself.');
    }
    if (!row.workspace_id) {
      const clash = await ctx.env.DB.prepare(
        'SELECT 1 FROM artifacts WHERE display_slug = ? AND owner_id = ? AND workspace_id IS NOT NULL AND deleted_at IS NULL LIMIT 1'
      ).bind(row.display_slug, ctx.user.id).first();
      if (clash) return fail('This page can only be updated in ShareOut itself.');
    }

    const title = str(args.title, 120) ?? row.name;
    const format = detectFormat(content, args.format ?? (row.artifact_type === 'markdown' ? 'markdown' : 'html'));
    const { status, body } = await runPublish(ctx, {
      name: title,
      slug: row.display_slug,
      ...fileFor(content, format),
      workspace_id: row.workspace_id ?? undefined,
      visibility: row.visibility,
    });
    if (status >= 400) return fail(`The page was not updated: ${errorText(body, status)}`, { status, code: body.code });
    const workspace = row.workspace_id
      ? (await listWorkspacesForUser(ctx.env, ctx.user.id)).find((w) => w.id === row.workspace_id) ?? null
      : null;
    return describePublish('Updated', title, body, workspace);
  },
};

const getHelp: ToolDef = {
  name: 'get_help',
  title: 'How ShareOut works',
  description: 'Short explanation of what ShareOut does and where to learn more. Use it for how-to questions. Answer in the person\'s language, in plain words.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx) {
    const text = [
      'ShareOut turns a page into a link you can share.',
      '- Ask me to make something (a report, a dashboard, a one-pager, a form) and I publish it and give you the link.',
      '- Pages go to your workspace by default, so your team can open them. You can also keep a page private or make it public.',
      '- To change a page, tell me which one and what to change; I save a new version at the same link.',
      '- Everything you publish is also in ShareOut, where you can share, comment and see who viewed it.',
      `Your ShareOut home: ${ctx.origin}/home`,
      `Connecting AI apps: ${ctx.origin}/home?view=connect`,
      'Docs: https://docs.shareout.site/',
      'If something does not work, tell me and I will let the ShareOut team know.',
    ].join('\n');
    return ok(text);
  },
};

const reportProblem: ToolDef = {
  name: 'report_problem',
  title: 'Report a problem',
  description: 'Tells the ShareOut team something went wrong (a failed publish, an error, a page that does not work). Call it whenever a ShareOut tool fails or the person reports a problem, then tell the person, in their language, that the team was notified.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One line: what went wrong.' },
      details: { type: 'string', description: 'What the person was trying to do, what happened, and any error text.' },
      artifact_id: { type: 'string' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async run(ctx, args) {
    const summary = str(args.summary, 200);
    if (!summary) return { ...ok('A one-line summary is needed.'), isError: true };
    const details = str(args.details, 8000) ?? '';
    const artifactId = str(args.artifact_id, 100);
    const app = await clientName(ctx);
    const ticket = await openTicket(ctx.env, {
      requesterUserId: ctx.user.id,
      requesterEmail: ctx.user.email,
      channel: 'skill',
      channelRef: `mcp:${app}`.slice(0, 120),
      client: 'mcp',
      artifactId: artifactId ?? null,
      subject: summary,
      body: [details, artifactId ? `Page: ${artifactId}` : '', `Reported from: ${app} (MCP connector)`].filter(Boolean).join('\n\n'),
    });
    return ok(`The ShareOut team got the report (ticket ${ticket.id}). Tell the person the team was notified and will follow up by email.`, { ticket_id: ticket.id });
  },
};

/** The AI app this token was minted for (`mcp:<client name>`), or a generic label. */
async function clientName(ctx: ToolContext): Promise<string> {
  const token = ctx.authorization.replace(/^Bearer\s+/i, '');
  const row = await ctx.env.DB.prepare('SELECT name FROM tokens WHERE token_hash = ?').bind(await hashToken(token)).first<{ name: string }>();
  return row?.name?.startsWith('mcp:') ? row.name.slice(4) : 'API token';
}

// ChatGPT's deep-research / company-knowledge mode looks for these two read-only
// tools by name and shape: search → { results: [{ id, title, url }] }, fetch → one document.
const search: ToolDef = {
  name: 'search',
  title: 'Search pages',
  description: 'Searches the person\'s ShareOut pages by name. Returns ids to pass to fetch.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const q = str(args.query, 200) ?? '';
    const result = await quickSearch(ctx.env, ctx.user.id, { q, groups: ['artifacts'], limit: 10 });
    const results = result.artifacts.map((h) => ({ id: h.id, title: h.title, url: artifactUrl(ctx.origin, h.slug ?? h.id) }));
    return ok(JSON.stringify({ results }), { results });
  },
};

const fetchTool: ToolDef = {
  name: 'fetch',
  title: 'Read a page',
  description: 'Reads one ShareOut page by id (from search) and returns its text.',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.id, 100);
    if (!id) return fail('id is required.');
    const res = await handleGetArtifact(getRequest(ctx, `/v1/artifacts/${id}`), ctx.env, ctx.user, id);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not open that page: ${errorText(body, res.status)}`);
    const raw = (await mainFileText(ctx, id)) ?? '';
    const text = body.artifact_type === 'html'
      ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : raw;
    const doc = {
      id,
      title: String(body.name),
      text,
      url: String(body.url),
      metadata: { visibility: body.visibility, updated_at: body.updated_at, type: body.artifact_type },
    };
    return ok(JSON.stringify(doc), doc);
  },
};

// Deterministic order (lets clients cache the list).
export const TOOLS: ToolDef[] = [
  whoami, listWorkspaces, listArtifacts, getArtifact, publishArtifact, updateArtifact,
  ...MEMBER_TOOLS, getHelp, reportProblem, search, fetchTool,
];

export function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export async function callTool(ctx: ToolContext, name: string, args: Args): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  try {
    return await tool.run(ctx, args ?? {});
  } catch (err) {
    logError(createLogger(ctx.env, { scope: 'mcp', event: 'mcp.tool_failed', tool: name }), 'mcp tool threw', err);
    return fail('Something went wrong on ShareOut\'s side.');
  }
}
