/**
 * Template tools: list the templates a workspace can use, install one, and save a page
 * or folder as a template. Each replays the real /v1/artifact-templates route in-process
 * as the caller, so visibility, scopes, the admin-only instance library and the
 * findings review apply unchanged.
 */
import { routeTemplatesApi } from '../router/api/templates';
import { createFetchContext } from '../router/context';
import {
  NOT_MEMBER, ON_FAILURE, errorText, fail, ok, readJson, resolveFolder, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const WORKSPACE_ARG = { type: 'string', description: 'Which workspace. Needed when the person has more than one — ask them which. Omit for their personal space only if they say so.' };

async function call(ctx: ToolContext, method: string, path: string, body?: unknown) {
  const req = new Request(`${ctx.origin}${path}`, {
    method,
    headers: { Authorization: ctx.authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const res = await routeTemplatesApi(createFetchContext(req, ctx.env, ctx.executionCtx));
  return { status: res?.status ?? 404, body: res ? await readJson(res) : {} };
}

async function pickWorkspace(ctx: ToolContext, args: Args, action: string): Promise<{ id: string | null; name: string } | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText(action, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  return resolved.workspace ? { id: resolved.workspace.id, name: resolved.workspace.name } : { id: null, name: 'personal space' };
}

const isResult = (v: unknown): v is ToolResult => typeof v === 'object' && v !== null && 'content' in v;

interface Summary { id: string; name: string; description: string | null; scope: string; version: string | null; item_count: number; tags: string[]; setup: unknown[] }

const listTemplatesTool: ToolDef = {
  name: 'list_templates',
  title: 'List templates',
  description: [
    'Lists the ready-made templates the person can install in a workspace: the workspace\'s own, ones shared with it, and the instance library.',
    'Each has an id for install_template. Answer in the person\'s language.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { workspace_id: WORKSPACE_ARG, query: { type: 'string', description: 'Words to look for in the name, description or tags.' }, tag: { type: 'string' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const w = await pickWorkspace(ctx, args, 'list_templates');
    if (isResult(w)) return w;
    const qs = new URLSearchParams();
    if (w.id) qs.set('workspace', w.id);
    const q = str(args.query, 100); if (q) qs.set('q', q);
    const tag = str(args.tag, 32); if (tag) qs.set('tag', tag);
    const { status, body } = await call(ctx, 'GET', `/v1/artifact-templates?${qs}`);
    if (status === 403) return fail(NOT_MEMBER);
    if (status !== 200) return fail(`Could not list templates: ${errorText(body, status)}`);
    const list = (body.templates ?? []) as Summary[];
    if (!list.length) return ok(`No templates are available in "${w.name}" yet. Any page or folder can be saved as one with save_as_template.`, { workspace_id: w.id, templates: [] });
    const text = [`${list.length} templates for "${w.name}":`,
      ...list.map((t) => `- ${t.name} (id ${t.id}, ${t.scope === 'instance' ? 'instance library' : t.scope}, v${t.version ?? '?'}, ${t.item_count} page${t.item_count === 1 ? '' : 's'})${t.description ? ` — ${t.description}` : ''}`)].join('\n');
    return ok(text, { workspace_id: w.id, templates: list });
  },
};

const installTemplateTool: ToolDef = {
  name: 'install_template',
  title: 'Install a template',
  description: [
    'Installs a template (id from list_templates) into a workspace, optionally inside a folder: creates its pages and folders, empty tables and datasets, and returns their links plus the "finish setup" steps (data sources to connect, tables to fill).',
    'Nothing from the workspace the template was made in comes along. Tell the person each setup step. Answer in the person\'s language.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { template_id: { type: 'string' }, workspace_id: WORKSPACE_ARG, folder: { type: 'string', description: 'Folder name or id to install into.' } },
    required: ['template_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.template_id, 100);
    if (!id) return fail('template_id is required.');
    const w = await pickWorkspace(ctx, args, 'install_template');
    if (isResult(w)) return w;
    let folderId: string | null = null;
    const folder = str(args.folder, 200);
    if (folder) {
      const f = await resolveFolder(ctx, w.id, folder);
      if (f.error) return fail(f.error);
      folderId = f.id ?? null;
    }
    const { status, body } = await call(ctx, 'POST', `/v1/artifact-templates/${encodeURIComponent(id)}/install`, { workspace_id: w.id, folder_id: folderId });
    if (status === 404) return fail('That template does not exist or is not available in this workspace. Call list_templates for the right id.');
    if (status === 403) return fail(NOT_MEMBER);
    if (status !== 201) return fail(`Could not install the template: ${errorText(body, status)}`);
    const arts = (body.artifacts ?? []) as Array<{ name: string; url: string }>;
    const setup = (body.setup ?? []) as Array<{ step: { kind: string; name: string; provider?: string }; done: boolean }>;
    const todo = setup.filter((s) => !s.done);
    const text = [
      `Installed in "${w.name}":`, ...arts.map((a) => `- ${a.name}: ${a.url}`),
      ...(todo.length ? ['Finish setup:', ...todo.map((s) => s.step.kind === 'connector'
        ? `- Connect a ${s.step.provider} data source named "${s.step.name}"`
        : `- Add data to the ${s.step.kind} "${s.step.name}"`)] : []),
    ].join('\n');
    return ok(text, body);
  },
};

const saveAsTemplateTool: ToolDef = {
  name: 'save_as_template',
  title: 'Save a page or folder as a template',
  description: [
    'Saves a page (artifact_id) or a folder (folder_id) as a template other workspaces can install. It keeps the files, folder structure and the shape of tables and datasets, never their data, credentials, comments or Knowledge.',
    'The first call may answer review_required with findings (emails, phone numbers, the workspace or client names): show them to the person, and only if they confirm call again with acknowledge_findings true.',
    'scope: private (this workspace, default), shared (also shared_workspace_ids), instance (the whole instance — instance admins only). Answer in the person\'s language.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' }, folder_id: { type: 'string' },
      name: { type: 'string' }, description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      scope: { type: 'string', enum: ['private', 'shared', 'instance'] },
      shared_workspace_ids: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      include_sample_rows: { type: 'boolean', description: 'Keep up to 5 rows per table/dataset as an example. Off by default.' },
      acknowledge_findings: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const body: Record<string, unknown> = {};
    for (const k of ['artifact_id', 'folder_id', 'name', 'description', 'tags', 'scope', 'shared_workspace_ids', 'include_sample_rows', 'acknowledge_findings']) {
      if (args[k] !== undefined) body[k] = args[k];
    }
    if (!body.artifact_id === !body.folder_id) return fail('Give exactly one of artifact_id or folder_id.');
    const { status, body: res } = await call(ctx, 'POST', '/v1/artifact-templates', body);
    if (status === 409 && res.code === 'REVIEW_REQUIRED') {
      const findings = (res.findings ?? []) as Array<{ kind: string; sample: string; where: string; count: number }>;
      return ok([
        'Nothing was saved yet. The content may include personal or customer details:',
        ...findings.slice(0, 30).map((f) => `- ${f.kind.replace('_', ' ')}: ${f.sample} (${f.where}, ${f.count}×)`),
        'Show these to the person. If they want to keep them, call save_as_template again with acknowledge_findings true; otherwise they should edit the page first.',
      ].join('\n'), { review_required: true, findings, preview: res.preview });
    }
    if (status === 403) return fail(`Not allowed: ${errorText(res, status)}`);
    if (status !== 201) return fail(`Could not save the template: ${errorText(res, status)}`);
    const t = res.template as Summary;
    return ok(`Saved template "${t.name}" (id ${t.id}, ${t.scope}, v${t.version}). Credentials found and removed: ${Number(res.redactions) || 0}.`, res);
  },
};

export const TEMPLATE_TOOLS: ToolDef[] = [listTemplatesTool, installTemplateTool, saveAsTemplateTool];
