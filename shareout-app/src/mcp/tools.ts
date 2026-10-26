/**
 * The tools the MCP connector offers. Each one calls the same domain function or
 * handler the REST API uses — in-process, with the caller's own identity — so every
 * existing authz, quota, moderation and visibility rule applies unchanged.
 *
 * Results are written for a model that talks to a non-technical person: what happened,
 * the link, who can see it, and any notice to pass on, in plain words.
 */
import type { Env, FileEntry } from '../types';
import { hashToken } from '../api-auth';
import { handlePublish } from '../publish/handle-publish';
import { handleListArtifacts, handleGetArtifact, handleUpdateArtifact, listPages } from '../artifacts/crud';
import { requireRole } from '../artifacts/roles';
import { listWorkspacesForUser, type BotWorkspace } from '../chat-agent/access';
import { quickSearch } from '../search/quick-search';
import { openTicket } from '../support/intake';
import { generateSlug, isSafeAssetPath, mimeForPath, resolveEntrypoint } from '../validation';
import { isSafePagePath } from '../serve/page-agent';
import { createLogger, logError } from '../logging';
import {
  NOT_MEMBER, ON_FAILURE, errorText, fail, getRequest, invalid, ok, readJson, resolveFolder, resolveWorkspace, str, validateArgs, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';
import { MEMBER_TOOLS } from './member-tools';
import { KNOWLEDGE_TOOLS } from './knowledge-tools';
import { CONNECTOR_TOOLS } from './connector-tools';
import { PAGE_TOOLS } from './page-tools';
import { SHARING_TOOLS } from './sharing-tools';
import { EDIT_TOOLS } from './edit-tools';
import { lossyWrite, mainText, readSource } from './page-source';

export type { ToolContext, ToolResult } from './tool-kit';

export const SERVER_INSTRUCTIONS = [
  'ShareOut turns a page you write (HTML or Markdown) into a web link people can open.',
  'Talk to the person in the language they use, in plain everyday words. Avoid technical jargon',
  '(do not say HTML, artifact, deploy, slug or token unless they do).',
  'To publish: write a complete, self-contained page and call publish_artifact. Afterwards always give the',
  'person the link and say who can see it. If the result carries a notice (visibility changed, under review,',
  'a warning), tell them plainly.',
  'To change a page they already have: find it with list_artifacts, read it with get_artifact (include_files when it has several files),',
  'then send the whole new page to update_artifact with base_version set to the version you read.',
  'For a small change (a word, a color, one section) use read_artifact and edit_artifact instead: they change only what you name, without sending the whole page again.',
  'For a site of several pages, send files instead of content: index.html plus the other pages and any css/js/images, linked with relative links.',
  'If they have several workspaces and did not say which one, ask them before publishing.',
  'A page\'s history is list_versions; restore_version brings an old one back as a new version (confirm first).',
  'For feedback use list_comments, then resolve_comment, assign_comment or approve_version.',
  'To share a folder with someone outside the team: folder_access (who can see it), share_with_person, revoke_share, folder_activity (who opened what).',
  'Workspace owners and admins can invite people with invite_members: confirm the emails and the role with them first,',
  'then say who was invited, who already was a member and who was skipped.',
  'For questions about what the team knows (clients, projects, people, numbers, decisions), call knowledge_search first,',
  'then knowledge_entity or knowledge_facts for one company, person or project. Answer only from what they return and always',
  'say where each fact comes from (the page or file name, with its link). If nothing is found, knowledge_status says what is covered.',
  'For live numbers from the team’s databases or files (warehouses, Supabase, Amazon S3), call list_connections, then',
  'query_connection (one read-only SELECT) or browse_storage (S3 files), and say which connector the answer came from.',
  'If anything fails or behaves unexpectedly, call report_problem with what happened, then tell the person',
  'the ShareOut team was notified. For how-to questions about ShareOut, call get_help.',
].join(' ');

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

// A multi-file site (`files`) maps straight onto the REST publish payload: the REST
// validator still owns mime allow-list, per-file/total size, duplicates and the
// entrypoint rule; this only adds the strict `?page=` path guard and infers mimes.
const FILES_SCHEMA = {
  type: 'array',
  description: 'Instead of content: every file of a multi-page site. index.html is the first page; other pages and assets (css, js, json, md, svg, images, fonts) sit beside it, linked with relative links like "about.html" or "css/site.css". Use encoding "base64" for binary files.',
  items: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path, e.g. "index.html", "guides/setup.html", "img/logo@2x.png". No "..", no leading "/", no backslash, no empty segments. HTML pages: letters, digits, spaces and . _ - ~ / only.' },
      content: { type: 'string', description: 'The file\'s text, or base64 bytes when encoding is "base64".' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
};

function siteFiles(raw: unknown[]): { files: FileEntry[]; error?: undefined } | { error: string } {
  if (!raw.length) return { error: 'files must list at least one file.' };
  const files: FileEntry[] = [];
  for (const f of raw) {
    const { path, content, encoding } = (f ?? {}) as { path?: unknown; content?: unknown; encoding?: unknown };
    if (typeof path !== 'string' || typeof content !== 'string') return { error: 'Each file needs a path and content (both text).' };
    const mime = mimeForPath(path);
    // Pages become ?page= deep links, so they keep the strict page rule; other assets get REST's.
    if (mime === 'text/html' ? !isSafePagePath(path) : !isSafeAssetPath(path)) {
      return { error: mime === 'text/html'
        ? `"${path}" is not a safe file path. Pages need a relative path like "about.html" or "guides/setup.html" (letters, digits, spaces and . _ - ~ /), with no ".." and no leading "/".`
        : `"${path}" is not a safe file path. Use a relative path like "css/site.css" or "img/logo@2x.png", with no "..", no leading "/", no backslash and no empty segments.` };
    }
    if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') return { error: `encoding for "${path}" must be "utf8" or "base64".` };
    files.push({ path, content, mime, ...(encoding === 'base64' ? { encoding: 'base64' as const } : {}) });
  }
  return { files };
}

/** content XOR files → the REST publish file fields, or a reason nothing was sent. */
function publishFiles(args: Args, fallbackFormat: unknown): { entrypoint?: string; files: FileEntry[]; error?: undefined } | { error: string } {
  const content = typeof args.content === 'string' ? args.content : '';
  if (Array.isArray(args.files)) {
    if (content) return { error: 'Send either content (one page) or files (a site), not both.' };
    return siteFiles(args.files);
  }
  if (!content.trim()) return { error: 'The page content (or files, for a site) is needed.' };
  return fileFor(content, detectFormat(content, args.format ?? fallbackFormat));
}

/** HTML pages of a multi-page publish, entrypoint first (same rule as GET /v1/artifacts/:id). */
function sitePages(files: FileEntry[]): string[] {
  const entrypoint = resolveEntrypoint({ files });
  const rows = files.filter((f) => f.mime === 'text/html').map((f) => f.path).sort().map((path) => ({ entrypoint, path }));
  return listPages(rows)?.pages ?? [];
}

function pageUrl(base: string, page: string): string {
  return `${base}?page=${encodeURIComponent(page).replace(/%2F/g, '/')}`;
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
  pages: string[] = [],
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
  const version = (result.version as { version_no?: number } | undefined)?.version_no;

  const lines = [
    `${verb} "${title}"${version ? ` (version ${version})` : ''}.`,
    `Link: ${url}`,
    `Who can see it: ${audience(visibility, workspace)}.`,
    ...(pages.length ? [`Pages (${pages.length}): ${pages.map((p) => pageUrl(url, p)).join(', ')}`] : []),
    ...(notes.length ? ['Tell the person:', ...notes.map((n) => `- ${n}`)] : []),
    'Give the person the link.',
  ];
  return ok(lines.join('\n'), {
    url,
    artifact_id: (result.artifact as { id?: string } | undefined)?.id,
    version,
    visibility,
    workspace_id: workspace?.id ?? null,
    notices: notes,
    visibility_downgraded: Boolean(result.visibility_downgraded),
    ...(pages.length ? { pages: pages.map((path) => ({ path, url: pageUrl(url, path) })) } : {}),
  });
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
  description: 'Lists or searches the person\'s pages on ShareOut, newest first, with links. Without workspace_id it covers every workspace they belong to plus their personal space (no need to ask which one); workspace_id (id or slug) narrows to one workspace. search finds pages by name.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'Only pages in this workspace (id or slug). Omit to cover all of them.' },
      search: { type: 'string', description: 'Words to look for in page names.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const requested = str(args.workspace_id, 100);
    const resolved = requested ? await resolveWorkspace(ctx, requested) : null;
    if (resolved?.notMember) return fail(NOT_MEMBER);
    const workspaceId = resolved?.workspace?.id ?? null;
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
  description: [
    'Details of one page: name, link, who can see it, version.',
    'include_content adds the main file\'s source; include_files adds every file of the page (its pages, css, js, data; images and fonts as base64), main file first. Use include_files before changing a page that has more than one file.',
    'One answer holds up to 512 KB of file content: a file that does not fit comes back cut or left out and marked truncated, and must never be sent back with update_artifact.',
    'To change the page, edit what this returns and pass its version to update_artifact as base_version.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      include_content: { type: 'boolean', default: false, description: 'Also return the main file\'s source (HTML or Markdown).' },
      include_files: { type: 'boolean', default: false, description: 'Also return every file of the page (path, size, content, truncated), main file first. Includes the main file, so include_content is not needed with it.' },
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
    const live = Number(body.current_version) || 1;
    const source = args.include_files === true || args.include_content === true
      ? await readSource(ctx, String(body.id ?? id), { live, newest: Number(body.latest_version) || live }, args.include_files === true)
      : null;
    const text = [
      `"${String(body.name)}" — ${String(body.url)}`,
      `Visibility: ${String(body.visibility)}. Version ${String(body.current_version)}. Updated ${String(body.updated_at ?? body.created_at)}.`,
      ...(typeof body.live_message === 'string' && body.live_message ? [`What changed in this version: ${body.live_message}`] : []),
      ...(Array.isArray(body.pages) && body.pages.length > 1
        ? [`Pages (${body.pages.length}): ${body.pages.map((p) => pageUrl(String(body.url), String(p))).join(', ')}`]
        : []),
      ...(source?.lines ?? []),
    ].join('\n');
    return ok(text, { artifact: body, ...source?.data });
  },
};

const publishArtifact: ToolDef = {
  name: 'publish_artifact',
  title: 'Publish a page',
  description: [
    'Publishes a new page on ShareOut and returns its link.',
    'content is a complete, self-contained HTML document (inline CSS/JS) or Markdown text.',
    'For a site with several pages, send files instead of content: index.html (the first page) plus the other pages and assets, linked with relative links; the result links every page.',
    'workspace_id: needed when the person has more than one workspace — ask them which one.',
    'visibility: "workspace" (default: everyone in the workspace), "private" (only them) or "public" (anyone with the link).',
    'folder: optional, a folder of that workspace (its name or id) to file the page in.',
    'message: optional one-line note for the version history.',
    'mcp_connections: optional, lets the page call the VIEWER\'s own account on workspace MCP connections (by connection name) — only the listed read-only tools; members-only pages (visibility workspace or private) only.',
    'Afterwards give the person the link in their language, in plain words, and pass on any notice in the result.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page name, as the person would call it.' },
      content: { type: 'string', description: 'The full page: an HTML document or Markdown.' },
      files: FILES_SCHEMA,
      format: { type: 'string', enum: ['html', 'markdown'], description: 'Defaults to a guess from the content.' },
      workspace_id: { type: 'string' },
      visibility: { type: 'string', enum: ['workspace', 'private', 'public'] },
      folder: { type: 'string', description: 'Folder to file the page in: its name or id. Omit to leave it unfiled.' },
      message: { type: 'string', description: 'A short note for the version history.' },
      mcp_connections: {
        type: 'array',
        description: 'Workspace MCP connections the page may call as its viewer, each with the exact tools it uses.',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, tools: { type: 'array', items: { type: 'string' } } },
          required: ['name', 'tools'],
          additionalProperties: false,
        },
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const title = str(args.title, 120);
    if (!title) return fail('A title is needed.');
    const payload = publishFiles(args, undefined);
    if (payload.error !== undefined) return invalid(`Nothing was published: ${payload.error}`);

    const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
    if (resolved.notMember) return fail(NOT_MEMBER);
    if (resolved.choices) {
      return ok(workspaceChoiceText('publish_artifact', resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
    }
    const workspace = resolved.workspace;

    const wanted = (args.visibility as string | undefined) ?? 'workspace';
    const visibility = wanted === 'workspace' && !workspace ? 'private' : wanted;
    const folderName = str(args.folder, 200);
    const folder = folderName ? await resolveFolder(ctx, workspace?.id ?? null, folderName) : null;
    if (folder?.error) return invalid(folder.error);

    const { status, body } = await runPublish(ctx, {
      name: title,
      slug: await freshSlug(ctx.env, ctx.user.id, workspace?.id ?? null, title),
      ...payload,
      workspace_id: workspace?.id,
      visibility,
      ...(folder?.id ? { folder_id: folder.id } : {}),
      ...(str(args.message, 500) ? { message: str(args.message, 500) } : {}),
      ...(Array.isArray(args.mcp_connections) ? { capabilities: { mcp: { connections: args.mcp_connections } } } : {}),
    });
    if (status >= 400) return fail(`The page was not published: ${errorText(body, status)}`, { status, code: body.code });
    return describePublish('Published', title, body, workspace, sitePages(payload.files));
  },
};

const updateArtifact: ToolDef = {
  name: 'update_artifact',
  title: 'Update a page',
  description: [
    'Replaces the content of a page the person already has (keeps its link and who can see it) and saves it as a new version.',
    'title renames the page; folder moves it into a folder of its workspace (name or id).',
    'Send the whole new page, not a fragment. Find the artifact_id with list_artifacts, read the page with get_artifact first (include_files when it has more than one file) and pass the version it reports as base_version: if someone saved a newer version since, nothing is changed and you are told to read it again.',
    'For a multi-page site send files instead of content: every file (index.html plus every page and asset, changed or not).',
    'An update that would remove a file of the current version (content alone on a site, or files that leave some out) is refused; set replace_all_files: true only when the person wants those files gone.',
    'Never send back a file that get_artifact marked truncated.',
    'message: optional one-line note on what changed, shown in the page history.',
    'Afterwards give the person the link.',
    ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      content: { type: 'string', description: 'The full new page: an HTML document or Markdown. A page with several files takes files instead.' },
      files: { ...FILES_SCHEMA, description: 'Instead of content: every file of a multi-page site, changed or not (index.html plus every page and asset). Leaving out a file of the current version is refused unless replace_all_files is true. Same rules as publish_artifact.' },
      base_version: { type: 'integer', minimum: 1, description: 'The version you read with get_artifact. If the page has a newer one, nothing is changed.' },
      replace_all_files: { type: 'boolean', default: false, description: 'true removes the files of the current version that content or files leaves out. Only when the person wants them gone.' },
      title: { type: 'string', description: 'New name, if it should change.' },
      format: { type: 'string', enum: ['html', 'markdown'] },
      folder: { type: 'string', description: 'Folder to move the page into: its name or id.' },
      message: { type: 'string', description: 'A short note on what changed, shown in the version history. Omit it and one is written automatically.' },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return fail('artifact_id is needed.');

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

    const newTitle = str(args.title, 120);
    const folderName = str(args.folder, 200);
    const folder = folderName ? await resolveFolder(ctx, row.workspace_id, folderName) : null;
    if (folder?.error) return invalid(folder.error);
    const payload = publishFiles(args, row.artifact_type === 'markdown' ? 'markdown' : 'html');
    if (payload.error !== undefined) return invalid(`Nothing was changed: ${payload.error}`);
    const lossy = await lossyWrite(ctx.env, id, {
      base: typeof args.base_version === 'number' ? args.base_version : undefined,
      paths: payload.files.map((f) => f.path),
      viaContent: !Array.isArray(args.files),
      replaceAll: args.replace_all_files === true,
    });
    if (lossy) return lossy;
    const { status, body } = await runPublish(ctx, {
      name: row.name,
      slug: row.display_slug,
      ...payload,
      workspace_id: row.workspace_id ?? undefined,
      visibility: row.visibility,
      ...(folder?.id ? { folder_id: folder.id } : {}),
      ...(str(args.message, 500) ? { message: str(args.message, 500) } : {}),
    });
    if (status >= 400) return fail(`The page was not updated: ${errorText(body, status)}`, { status, code: body.code });
    // Publishing keeps the stored name; a rename goes through the same PATCH the REST API uses.
    let title = row.name;
    if (newTitle && newTitle !== row.name) {
      const res = await handleUpdateArtifact(new Request(`${ctx.origin}/v1/artifacts/${id}`, {
        method: 'PATCH',
        headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTitle }),
      }), ctx.env, ctx.user, id);
      if (res.ok) title = newTitle;
      else body.warnings = [...(Array.isArray(body.warnings) ? body.warnings : []), `The content was saved, but the name could not be changed: ${errorText(await readJson(res), res.status)}`];
    }
    const workspace = row.workspace_id
      ? (await listWorkspacesForUser(ctx.env, ctx.user.id)).find((w) => w.id === row.workspace_id) ?? null
      : null;
    return describePublish('Updated', title, body, workspace, sitePages(payload.files));
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
  description: 'Searches the person\'s ShareOut pages by name, across all their workspaces unless workspace_id (id or slug) narrows it to one. Returns ids to pass to fetch.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      workspace_id: { type: 'string', description: 'Only pages in this workspace (id or slug). Omit to search all of them.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const q = str(args.query, 200) ?? '';
    const requested = str(args.workspace_id, 100);
    const resolved = requested ? await resolveWorkspace(ctx, requested) : null;
    if (resolved?.notMember) return fail(NOT_MEMBER);
    const result = await quickSearch(ctx.env, ctx.user.id, { q, workspaceId: resolved?.workspace?.id, groups: ['artifacts'], limit: 10 });
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
    const main = await mainText(ctx, String(body.id ?? id), Number(body.current_version) || 1);
    const raw = main?.text ?? '';
    const text = body.artifact_type === 'html'
      ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : raw;
    const doc = {
      id,
      title: String(body.name),
      text,
      url: String(body.url),
      metadata: { visibility: body.visibility, updated_at: body.updated_at, type: body.artifact_type, ...(main?.truncated ? { truncated: true } : {}) },
    };
    return ok(JSON.stringify(doc), doc);
  },
};

// Deterministic order (lets clients cache the list).
export const TOOLS: ToolDef[] = [
  whoami, listWorkspaces, listArtifacts, getArtifact, publishArtifact, updateArtifact, ...EDIT_TOOLS,
  ...PAGE_TOOLS, ...SHARING_TOOLS, ...MEMBER_TOOLS, ...KNOWLEDGE_TOOLS, ...CONNECTOR_TOOLS, getHelp, reportProblem, search, fetchTool,
];

export function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export async function callTool(ctx: ToolContext, name: string, args: Args): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  const problem = validateArgs(tool.inputSchema, args ?? {});
  if (problem) return invalid(`Nothing was done: ${problem}`);
  try {
    return await tool.run(ctx, args ?? {});
  } catch (err) {
    logError(createLogger(ctx.env, { scope: 'mcp', event: 'mcp.tool_failed', tool: name }), 'mcp tool threw', err);
    return fail('Something went wrong on ShareOut\'s side.');
  }
}
