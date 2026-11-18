// "Update by email" over MCP: set_email_sync turns it on (senders, then the job) and hands back the
// address; check_email_sync confirms what the last file did. Real schema and REST routes.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const validateToken = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));

import type { AuthUser } from '../../../src/api-auth';
import { callTool, listTools, SERVER_INSTRUCTIONS } from '../../../src/mcp/tools';
import { applyMigrations, e } from '../helpers/migrated-db';
import { writeDatasetRows } from '../../../src/data/datasets/handler';

const WS = 'wsp_mcpe';
const ART = 'art_mcpe';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const alice = u('usr_mcpe_alice', 'alice@example.com'); // owner
const carol = u('usr_mcpe_carol', 'carol@example.com'); // viewer collaborator

const ctx = (user: AuthUser) => ({ env: e, user, origin: 'https://shareout.test', authorization: 'Bearer so_test' });
const call = (user: AuthUser, name: string, args: Record<string, unknown>) => {
  validateToken.mockReset().mockResolvedValue(user);
  return callTool(ctx(user), name, args).then((r) => r!);
};
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map((c) => c.text ?? '').join(' ');

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[alice, carol].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.id)),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-mcpe', ?)").bind(WS, alice.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_mcpe1', ?, ?, 'owner', 'internal'), ('wm_mcpe2', ?, ?, 'member', 'internal')")
      .bind(WS, alice.id, WS, carol.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Ventas', 'mcpe-ventas', 'workspace', ?)").bind(ART, alice.id, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_mcpe1', ?, ?, 'viewer')").bind(ART, carol.email),
  ]);
  await writeDatasetRows(e, ART, 'ventas', 'json', [{ a: 1 }]);
});

describe('update by email over MCP', () => {
  it('lists both tools with honest hints, and the server tells the agent how to guide the person', () => {
    const tools = new Map(listTools().map((t) => [t.name, t]));
    expect(tools.get('set_email_sync')?.annotations.readOnlyHint).toBe(false);
    expect(tools.get('check_email_sync')?.annotations.readOnlyHint).toBe(true);
    expect(SERVER_INSTRUCTIONS).toMatch(/ask who sends the file, one question/);
  });

  it('asks for the sender first, refuses a bad address in plain words, then turns on and gives the address', async () => {
    const first = await call(alice, 'set_email_sync', { artifact_id: ART });
    expect(first.isError).toBe(true);
    expect(text(first)).toMatch(/ask the person who will send the file/);
    expect(first.structuredContent).toMatchObject({ needs_senders: true, suggested: alice.email });

    expect(text(await call(alice, 'set_email_sync', { artifact_id: ART, senders: ['@gmail.com'] }))).toMatch(/whole free-mail domain/);

    const on = await call(alice, 'set_email_sync', { artifact_id: ART, senders: ['ana@acme.com'] });
    expect(on.isError).toBeFalsy();
    const address = String(on.structuredContent!.address);
    expect(address).toMatch(/@inbox\./);
    expect(text(on)).toContain(`Give the person this address to copy: ${address}`);
    expect(on.structuredContent).toMatchObject({ senders: ['ana@acme.com'], dataset: 'ventas' });
    const job = await e.DB.prepare("SELECT trigger_type, event_type, config FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync'").bind(ART).first<{ trigger_type: string; event_type: string; config: string }>();
    expect(job).toMatchObject({ trigger_type: 'event', event_type: 'email.received' });
    expect(JSON.parse(job!.config)).toEqual({ dataset: 'ventas' });

    // Calling again changes the tab without a second job.
    await call(alice, 'set_email_sync', { artifact_id: ART, sheet: 'Resumen' });
    const jobs = await e.DB.prepare("SELECT config FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync'").bind(ART).all<{ config: string }>();
    expect(jobs.results.map((r) => JSON.parse(r.config))).toEqual([{ dataset: 'ventas', sheet: 'Resumen' }]);
  });

  it('check_email_sync says what the last file did', async () => {
    expect(text(await call(alice, 'check_email_sync', { artifact_id: ART }))).toMatch(/No file has arrived yet/);
    await writeDatasetRows(e, ART, 'ventas', 'json', [{ a: 1 }, { a: 2 }, { a: 3 }], { source: { provider: 'email', file: 'ventas.xlsx', sheet: 'Resumen', syncedAt: new Date().toISOString() } });
    expect(text(await call(alice, 'check_email_sync', { artifact_id: ART }))).toMatch(/3 rows from ventas\.xlsx \(tab “Resumen”\)/);
    await e.DB.prepare("UPDATE scheduled_jobs SET last_status = 'failed', last_error = 'The email had no file attached. Attach the Excel or CSV file and send it again.', last_run_at = ? WHERE artifact_id = ?")
      .bind(Math.floor(Date.now() / 1000) + 5, ART).run();
    expect(text(await call(alice, 'check_email_sync', { artifact_id: ART }))).toMatch(/kept its previous data\. Tell the person: The email had no file attached/);
  });

  it('a viewer cannot set it up or read it', async () => {
    expect(text(await call(carol, 'set_email_sync', { artifact_id: ART, senders: ['carol@example.com'] }))).toMatch(/cannot edit it/);
    expect((await call(carol, 'check_email_sync', { artifact_id: ART })).isError).toBe(true);
  });

  it('stop removes it and the page keeps its data', async () => {
    expect(text(await call(alice, 'set_email_sync', { artifact_id: ART, stop: true }))).toMatch(/Stopped/);
    expect(await e.DB.prepare("SELECT 1 FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync'").bind(ART).first()).toBeNull();
    expect(await e.DB.prepare('SELECT 1 FROM datasets WHERE artifact_id = ? AND name = ?').bind(ART, 'ventas').first()).toBeTruthy();
  });
});
