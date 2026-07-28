import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const resolveArtifactAccessForUser = vi.hoisted(() => vi.fn());
const updateRule = vi.hoisted(() => vi.fn());
const deleteRule = vi.hoisted(() => vi.fn());
const getRule = vi.hoisted(() => vi.fn());
const listRulesForOwner = vi.hoisted(() => vi.fn());
const updateJob = vi.hoisted(() => vi.fn());
const deleteJob = vi.hoisted(() => vi.fn());
const listJobs = vi.hoisted(() => vi.fn());
const addCollaboratorEmails = vi.hoisted(() => vi.fn());
const getCrew = vi.hoisted(() => vi.fn());
const proposeEdit = vi.hoisted(() => vi.fn());
const publishEdits = vi.hoisted(() => vi.fn());
const botInsertRows = vi.hoisted(() => vi.fn());
const botUpdateRowById = vi.hoisted(() => vi.fn());
const botUpdateRowsByFilter = vi.hoisted(() => vi.fn());
const botSetJson = vi.hoisted(() => vi.fn());
const buildBotDataContext = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/agent/headless-edit', () => ({ proposeEdit, publishEdits }));
vi.mock('../../../src/data/tables', () => ({ botInsertRows, botUpdateRowById, botUpdateRowsByFilter }));
vi.mock('../../../src/data/json-store', () => ({ botSetJson }));
vi.mock('../../../src/chat-agent/data-write', () => ({ buildBotDataContext }));
vi.mock('../../../src/chat-agent/access', () => ({ resolveArtifactAccessForUser }));
vi.mock('../../../src/metric-alerts/rules', () => ({ updateRule, deleteRule, getRule, listRulesForOwner }));
vi.mock('../../../src/scheduling/jobs', () => ({ updateJob, deleteJob, listJobs }));
vi.mock('../../../src/artifacts/collaborators', () => ({ addCollaboratorEmails }));
vi.mock('../../../src/crew/store', () => ({ getCrew, createRun: vi.fn(), getRun: vi.fn() }));
vi.mock('../../../src/crew/limits', () => ({ resolveCrewLimits: vi.fn(), countActiveRuns: vi.fn() }));
vi.mock('../../../src/crew/principal', () => ({ buildOwnerDataContextForCrew: vi.fn() }));
vi.mock('../../../src/crew/run-loop', () => ({ runCrewToCompletion: vi.fn() }));

import { describeAction, executeAction, type PendingAction } from '../../../src/chat-agent/actions';
import { shareArtifactTool, manageAlertTool, askCrewTool, editPageTool } from '../../../src/chat-agent/tools/actions';
import { addTableRowTool, updateTableRowTool, setJsonValueTool } from '../../../src/chat-agent/tools/data';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ name: 'Sales Dashboard' }) }) }) },
} as unknown as Env;
const ctx = { env, userId: 'user_1', chatId: 1 };

// A DataContext stub for the data-write tools: db.prepare(...).bind(...).all()
// lists table names, .first() answers the JSON key-existence probe.
function mockDataCtx(opts: { tables?: string[]; jsonExists?: boolean; viewerScope?: unknown } = {}) {
  const tables = opts.tables ?? ['leads'];
  return {
    artifact: { name: 'Sales Dashboard' },
    viewerScope: opts.viewerScope ?? null,
    db: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: tables.map((name) => ({ name })) }),
          first: async () => (opts.jsonExists ? {} : null),
        }),
      }),
    },
  };
}

beforeEach(() => {
  [resolveArtifactAccessForUser, updateRule, deleteRule, getRule, listRulesForOwner, updateJob, deleteJob, listJobs, addCollaboratorEmails, getCrew, proposeEdit, publishEdits, botInsertRows, botUpdateRowById, botUpdateRowsByFilter, botSetJson, buildBotDataContext].forEach((m) => m.mockReset());
});
afterEach(() => vi.restoreAllMocks());

describe('describeAction', () => {
  it('phrases each action for confirmation', () => {
    expect(describeAction({ kind: 'alert_delete', ruleId: 'r', label: 'Rev' })).toMatch(/Delete the alert/);
    expect(describeAction({ kind: 'share', artifactId: 'a', artifactName: 'Dash', emails: ['x@y.com'], role: 'viewer' })).toMatch(/Share .*Dash.* x@y.com .*viewer/);
    expect(describeAction({ kind: 'crew', artifactId: 'a', artifactName: 'Dash', instruction: 'refresh' })).toMatch(/crew on .*Dash.*refresh/);
  });
});

describe('executeAction', () => {
  it('pauses an alert via updateRule(enabled:false)', async () => {
    updateRule.mockResolvedValue({ rule: {} });
    const out = await executeAction(env, 'user_1', { kind: 'alert_pause', ruleId: 'r1', label: 'Rev' });
    expect(updateRule).toHaveBeenCalledWith(env, 'user_1', 'r1', { enabled: false });
    expect(out).toMatch(/paused/);
  });

  it('surfaces a permission error from the backend', async () => {
    deleteJob.mockResolvedValue({ success: false, error: 'Permission denied' });
    const out = await executeAction(env, 'user_1', { kind: 'job_delete', jobId: 'j1', label: 'email' });
    expect(out).toMatch(/Permission denied/);
  });

  it('refuses to share when the caller is not the owner', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    const out = await executeAction(env, 'user_1', { kind: 'share', artifactId: 'a1', artifactName: 'D', emails: ['x@y.com'], role: 'viewer' });
    expect(out).toMatch(/owner/i);
    expect(addCollaboratorEmails).not.toHaveBeenCalled();
  });

  it('shares for an owner', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    addCollaboratorEmails.mockResolvedValue(['x@y.com']);
    const out = await executeAction(env, 'user_1', { kind: 'share', artifactId: 'a1', artifactName: 'D', emails: ['x@y.com'], role: 'editor' });
    expect(addCollaboratorEmails).toHaveBeenCalledWith(env, 'a1', ['x@y.com'], 'editor', 'user_1');
    expect(out).toMatch(/shared with x@y.com/);
  });
});

describe('propose tools', () => {
  it('share_artifact proposes for an owner with a valid email', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    const out = await shareArtifactTool.execute(ctx, { artifact_id: 'a1', emails: ['Sam@Example.com'], role: 'editor' }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'share', artifactId: 'a1', emails: ['sam@example.com'], role: 'editor' });
  });

  it('share_artifact rejects a non-owner', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    const out = await shareArtifactTool.execute(ctx, { artifact_id: 'a1', emails: ['sam@example.com'] }) as { error?: string };
    expect(out.error).toMatch(/owner/i);
  });

  it('share_artifact rejects when no valid email is given', async () => {
    const out = await shareArtifactTool.execute(ctx, { artifact_id: 'a1', emails: ['not-an-email'] }) as { error?: string };
    expect(out.error).toMatch(/valid email/i);
    expect(resolveArtifactAccessForUser).not.toHaveBeenCalled();
  });

  it('manage_alert proposes a pause for an alert the user can manage', async () => {
    getRule.mockResolvedValue({ rule: { id: 'r1', name: 'Revenue drop' } });
    const out = await manageAlertTool.execute(ctx, { rule_id: 'r1', operation: 'pause' }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'alert_pause', ruleId: 'r1', label: 'Revenue drop' });
  });

  it('ask_crew rejects when the page has no crew', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    getCrew.mockResolvedValue(null);
    const out = await askCrewTool.execute(ctx, { artifact_id: 'a1', instruction: 'refresh' }) as { error?: string };
    expect(out.error).toMatch(/crew/i);
  });

  it('edit_page proposes a publish when the agent staged file edits', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    proposeEdit.mockResolvedValue({ ok: true, conversationId: 'conv_1', explanation: 'Updated the headline.', files: ['index.html'] });
    const out = await editPageTool.execute(ctx, { artifact_id: 'a1', instruction: 'change the headline' }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'edit_publish', conversationId: 'conv_1', files: ['index.html'] });
  });

  it('edit_page relays the agent’s answer when no edits were staged', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    proposeEdit.mockResolvedValue({ ok: true, conversationId: 'conv_1', explanation: 'Which headline did you mean?', files: [] });
    const out = await editPageTool.execute(ctx, { artifact_id: 'a1', instruction: 'change it' }) as { note?: string; __propose?: unknown };
    expect(out.note).toMatch(/which headline/i);
    expect(out.__propose).toBeUndefined();
  });

  it('edit_page rejects a viewer', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    const out = await editPageTool.execute(ctx, { artifact_id: 'a1', instruction: 'x' }) as { error?: string };
    expect(out.error).toMatch(/owner or an editor/i);
    expect(proposeEdit).not.toHaveBeenCalled();
  });
});

describe('executeAction edit_publish', () => {
  it('publishes the staged conversation for an editor and returns the URL', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    publishEdits.mockResolvedValue({ ok: true, url: 'https://shareout.site/a/page' });
    const out = await executeAction(env, 'user_1', { kind: 'edit_publish', artifactId: 'a1', artifactName: 'P', conversationId: 'conv_1', summary: 's', files: ['index.html'] });
    expect(publishEdits).toHaveBeenCalledWith(env, 'a1', 'conv_1');
    expect(out).toMatch(/Published .*shareout.site\/a\/page/);
  });

  it('refuses to publish for a viewer', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    const out = await executeAction(env, 'user_1', { kind: 'edit_publish', artifactId: 'a1', artifactName: 'P', conversationId: 'conv_1', summary: 's', files: [] });
    expect(out).toMatch(/owner or an editor/i);
    expect(publishEdits).not.toHaveBeenCalled();
  });
});

describe('data-write propose tools', () => {
  it('add_table_row proposes an insert for an editor when the table exists', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    buildBotDataContext.mockResolvedValue(mockDataCtx({ tables: ['leads'] }));
    const out = await addTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'leads', row: { name: 'Sam' } }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'data_table_insert', artifactId: 'a1', table: 'leads', row: { name: 'Sam' } });
  });

  it('add_table_row reports available tables when the named one is missing', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    buildBotDataContext.mockResolvedValue(mockDataCtx({ tables: ['leads', 'orders'] }));
    const out = await addTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'nope', row: { x: 1 } }) as { error?: string; available_tables?: string[] };
    expect(out.error).toMatch(/not found/i);
    expect(out.available_tables).toEqual(['leads', 'orders']);
  });

  it('add_table_row rejects a viewer before touching data', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    const out = await addTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'leads', row: { name: 'Sam' } }) as { error?: string };
    expect(out.error).toMatch(/owner or an editor/i);
    expect(buildBotDataContext).not.toHaveBeenCalled();
  });

  it('update_table_row requires exactly one of row_id / filter', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    const both = await updateTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'leads', row_id: 'r1', filter: { x: 1 }, changes: { y: 2 } }) as { error?: string };
    expect(both.error).toMatch(/either a row_id or a filter/i);
    const neither = await updateTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'leads', changes: { y: 2 } }) as { error?: string };
    expect(neither.error).toMatch(/row_id or a filter/i);
  });

  it('update_table_row proposes a by-id update', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner' });
    buildBotDataContext.mockResolvedValue(mockDataCtx({ tables: ['leads'] }));
    const out = await updateTableRowTool.execute(ctx, { artifact_id: 'a1', table: 'leads', row_id: 'row_9', changes: { status: 'won' } }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'data_table_update', table: 'leads', rowId: 'row_9', changes: { status: 'won' } });
  });

  it('set_json_value proposes a set and flags an existing key', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    buildBotDataContext.mockResolvedValue(mockDataCtx({ jsonExists: true }));
    const out = await setJsonValueTool.execute(ctx, { artifact_id: 'a1', key: 'config', value: { theme: 'dark' } }) as { __propose?: PendingAction };
    expect(out.__propose).toMatchObject({ kind: 'data_json_set', key: 'config', value: { theme: 'dark' }, exists: true });
  });

  it('set_json_value refuses when a row-level policy restricts the JSON store', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
    buildBotDataContext.mockResolvedValue(mockDataCtx({ viewerScope: { field: 'email', values: ['x@y.com'] } }));
    const out = await setJsonValueTool.execute(ctx, { artifact_id: 'a1', key: 'config', value: 1 }) as { error?: string };
    expect(out.error).toMatch(/access policy/i);
  });
});

describe('executeAction data writes', () => {
  const access = { role: 'editor' as const };
  beforeEach(() => {
    resolveArtifactAccessForUser.mockResolvedValue(access);
    buildBotDataContext.mockResolvedValue(mockDataCtx());
  });

  it('inserts a row and reports success', async () => {
    botInsertRows.mockResolvedValue({ inserted: [{ id: 'row_1' }], count: 1 });
    const out = await executeAction(env, 'user_1', { kind: 'data_table_insert', artifactId: 'a1', artifactName: 'P', table: 'leads', row: { name: 'Sam' } });
    expect(botInsertRows).toHaveBeenCalledWith(expect.anything(), 'leads', [{ name: 'Sam' }]);
    expect(out).toMatch(/added 1 row/i);
  });

  it('surfaces a backend error from the insert', async () => {
    botInsertRows.mockResolvedValue({ error: 'Row too large' });
    const out = await executeAction(env, 'user_1', { kind: 'data_table_insert', artifactId: 'a1', artifactName: 'P', table: 'leads', row: {} });
    expect(out).toMatch(/Row too large/);
  });

  it('updates rows by filter and reports the count', async () => {
    botUpdateRowsByFilter.mockResolvedValue({ updated: 3 });
    const out = await executeAction(env, 'user_1', { kind: 'data_table_update', artifactId: 'a1', artifactName: 'P', table: 'leads', filter: { status: 'open' }, changes: { status: 'closed' } });
    expect(botUpdateRowsByFilter).toHaveBeenCalledWith(expect.anything(), 'leads', { status: 'open' }, { status: 'closed' });
    expect(out).toMatch(/updated 3 rows/i);
  });

  it('sets a JSON value', async () => {
    botSetJson.mockResolvedValue({ created: false });
    const out = await executeAction(env, 'user_1', { kind: 'data_json_set', artifactId: 'a1', artifactName: 'P', key: 'config', value: 1, exists: true });
    expect(botSetJson).toHaveBeenCalledWith(expect.anything(), 'config', 1);
    expect(out).toMatch(/saved “config”/i);
  });

  it('refuses a data write for a viewer', async () => {
    resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    const out = await executeAction(env, 'user_1', { kind: 'data_table_insert', artifactId: 'a1', artifactName: 'P', table: 'leads', row: {} });
    expect(out).toMatch(/owner or an editor/i);
    expect(botInsertRows).not.toHaveBeenCalled();
  });
});

describe('describeAction data writes', () => {
  it('phrases each data-write kind', () => {
    expect(describeAction({ kind: 'data_table_insert', artifactId: 'a', artifactName: 'Dash', table: 'leads', row: { name: 'Sam' } })).toMatch(/Add this row to “leads”/);
    expect(describeAction({ kind: 'data_table_update', artifactId: 'a', artifactName: 'Dash', table: 'leads', rowId: 'row_9', changes: { x: 1 } })).toMatch(/Update row row_9/);
    expect(describeAction({ kind: 'data_json_set', artifactId: 'a', artifactName: 'Dash', key: 'config', value: 1, exists: true })).toMatch(/replaces the current value/);
  });
});
