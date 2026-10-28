// catalog_update: the assistant proposes an edit, nothing is written until the user
// confirms, and the confirmed action re-checks membership before saving.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/chat-agent/scope', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/scope')>()),
  scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => (c.selectedWorkspaceId === 'wsp_edag' ? 'wsp_edag' : null),
}));
import { applyMigrations, e } from '../helpers/migrated-db';
import type { ToolContext } from '../../../src/chat-agent/tools/types';
import { catalogGetTool, catalogUpdateTool } from '../../../src/chat-agent/tools/catalog';
import { describeAction, describeActionRich, executeAction, type PendingAction } from '../../../src/chat-agent/actions';
import { selectTools } from '../../../src/chat-agent/tools/index';
import { toolkitOf } from '../../../src/chat-agent/tools/toolkits';
import { listCatalogFiles, setCatalogEnabled, upsertCatalogFile } from '../../../src/catalog';

const WS = 'wsp_edag';
const MEMBER = 'usr_edag_member';
const OUTSIDER = 'usr_edag_out';
const TERM = '---\nkind: term\nid: term.ats\ntitle: ATS\ntags: [glosario]\naliases: [charla de 5 minutos]\n---\n\nCharla previa.';

const ctx = (ws: string | null, userId = MEMBER) => ({ env: e, selectedWorkspaceId: ws, userId } as unknown as ToolContext);
const content = async () => (await listCatalogFiles(e, WS)).find((f) => f.path === 'terms/ats.md')!;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email) VALUES (?, 'm@agencia.example'), (?, 'o@else.example')").bind(MEMBER, OUTSIDER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Agencia', 'agencia-edag', ?)").bind(WS, MEMBER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_ea', ?, ?, 'member', 'internal')").bind(WS, MEMBER),
  ]);
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM catalog_settings');
  await setCatalogEnabled(e, WS, true);
  await upsertCatalogFile(e, WS, { path: 'terms/ats.md', content: TERM });
});

describe('catalog_update tool', () => {
  it('is a write tool in the knowledge toolkit, dropped from answer-only turns', () => {
    expect(toolkitOf('catalog_update')).toBe('knowledge');
    const caps = { canQueryConnections: false, canSchedule: false, canBuild: false };
    expect(selectTools(caps).map((t) => t.name)).toContain('catalog_update');
    expect(selectTools({ ...caps, readOnly: true }).map((t) => t.name)).not.toContain('catalog_update');
  });

  it('proposes the edit (resolving an alias) and writes nothing yet', async () => {
    const out = await catalogUpdateTool.execute(ctx(WS), { id: 'charla de 5 minutos', body: 'Análisis de Trabajo Seguro.', tags: ['glosario', 'seguridad'] });
    expect(out).toEqual({
      __propose: {
        kind: 'catalog_edit', workspaceId: WS, entryId: 'term.ats', entryTitle: 'ATS',
        edit: { tags: ['glosario', 'seguridad'], body: 'Análisis de Trabajo Seguro.' }, certified: false,
      },
    });
    expect((await content()).content).toBe(TERM);
  });

  it('refuses outside a workspace, unknown entries, and fields it cannot change', async () => {
    expect(await catalogUpdateTool.execute(ctx(null), { id: 'term.ats', title: 'x' })).toHaveProperty('error');
    expect(await catalogUpdateTool.execute(ctx(WS), { id: 'term.nope', title: 'x' })).toEqual({ error: 'No catalog entry with id “term.nope”.' });
    const bad = (await catalogUpdateTool.execute(ctx(WS), { id: 'term.ats', status: 'certified' })) as { error: string };
    expect(bad.error).toContain('status');
  });

  it('the confirmed action saves it as the user, marked as an agent write', async () => {
    const proposal = ((await catalogUpdateTool.execute(ctx(WS), { id: 'term.ats', title: 'ATS (charla de 5 minutos)' })) as { __propose: PendingAction }).__propose;
    expect(describeAction(proposal, 'es')).toContain('¿Edito la entrada del catálogo “ATS”?');
    expect(describeActionRich(proposal)).toMatchObject({ title: 'Edit catalog entry', subject: 'ATS', lines: ['title: ATS (charla de 5 minutos)'] });
    expect(await executeAction(e, MEMBER, proposal)).toBe('Done — updated title on “ATS (charla de 5 minutos)”.');
    expect(await content()).toMatchObject({ source: 'manual', updatedBy: MEMBER, updatedByKind: 'agent' });
    const read = (await catalogGetTool.execute(ctx(WS), { id: 'term.ats' })) as { entry: Record<string, unknown> };
    expect(read.entry).toMatchObject({ title: 'ATS (charla de 5 minutos)', aliases: ['charla de 5 minutos'], terms: [] });
  });

  it('re-checks membership when the action runs', async () => {
    const proposal = ((await catalogUpdateTool.execute(ctx(WS), { id: 'term.ats', title: 'Hijacked' })) as { __propose: PendingAction }).__propose;
    expect(await executeAction(e, OUTSIDER, proposal)).toBe('Only a member of this workspace can edit its catalog.');
    expect((await content()).content).toBe(TERM);
  });
});
