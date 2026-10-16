// Review and sharing notifications against the real migrated schema. Only the transports
// are stubbed (the mail send and the Telegram call), so the email gateway's preference,
// suppression and audience rules run for real. Every case checks who hears, who never
// does (the actor), and the dedupe/debounce rule.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.hoisted(() => vi.fn(async () => ({ success: true, messageId: 'm' })));
const sendMessage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../src/scheduling/email', () => ({ sendEmail }));
vi.mock('../../../src/telegram/client', () => ({ sendMessage }));

import type { AuthUser } from '../../../src/api-auth';
import { setApproval } from '../../../src/pages/home/queries/review';
import { recordShareeView } from '../../../src/sharees/activity';
import { runVersionNoticeSweep, VERSION_QUIET_MS } from '../../../src/notify/review-notify';
import { handleCreateGrant, handleShareWithPerson } from '../../../src/sharees/grants';
import { queryNeedsYou } from '../../../src/pages/home/queries/activity-needs-you';
import { invalidateGrants } from '../../../src/access/can-access';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';

const env = { ...baseEnv, SESSION_SECRET: 'notify-secret', TELEGRAM_BOT_TOKEN: 'tg', SLUGS: undefined } as unknown as typeof baseEnv;
const WS = 'ws_nt';
const u = (id: string, email: string, name: string) => ({ id, email, name });
const owner = u('usr_nt_owner', 'owner@studio.test', 'Olivia');
const editor = u('usr_nt_editor', 'editor@studio.test', 'Eddie');
const follower = u('usr_nt_follower', 'follower@studio.test', 'Fran');
const optedOut = u('usr_nt_optout', 'quiet@studio.test', 'Quinn');
const outsider = u('usr_nt_outsider', 'outsider@else.test', 'Oscar');
const client = u('usr_nt_client', 'client@acme.test', 'Cleo');
const newbie = u('usr_nt_newbie', 'newbie@acme.test', 'Nia');
const ART = 'art_nt';
const ART_PUBLIC = 'art_nt_pub';
const ART_IN_FOLDER = 'art_nt_folder';

const sentTo = (type?: string) => (sendEmail.mock.calls as unknown as Array<[unknown, { to: string[]; subject: string; text: string }]>)
  .filter(([, p]) => !type || p.subject.includes(type))
  .map(([, p]) => p.to[0]);

beforeAll(async () => {
  await applyMigrations();
  const all = [owner, editor, follower, optedOut, outsider, client, newbie];
  await env.DB.batch([
    ...all.map((x) => env.DB.prepare('INSERT INTO users (id, email, name, last_login_at) VALUES (?, ?, ?, ?)')
      .bind(x.id, x.email, x.name, x.id === newbie.id ? null : '2026-10-01T00:00:00.000Z')),
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Studio', 'studio-nt', ?)").bind(WS, owner.id),
    env.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_nt1', ?, ?, 'owner', 'internal'), ('wm_nt2', ?, ?, 'member', 'internal'), ('wm_nt3', ?, ?, 'member', 'internal'),
      ('wm_nt4', ?, ?, 'member', 'internal'), ('wm_nt5', ?, ?, 'member', 'external')`)
      .bind(WS, owner.id, WS, editor.id, WS, follower.id, WS, optedOut.id, WS, client.id),
    env.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug, created_by) VALUES ('fld_nt', ?, ?, 'Acme deliverables', 'acme', ?), ('fld_nt_new', ?, ?, 'Q4 plans', 'q4', ?)")
      .bind(WS, owner.id, owner.id, WS, owner.id, owner.id),
    env.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, folder_id) VALUES
      (?, 'Roadmap', 'nt-roadmap', ?, ?, 'workspace', NULL), (?, 'Launch page', 'nt-launch', ?, ?, 'public', NULL), (?, 'Deck', 'nt-deck', ?, ?, 'private', 'fld_nt')`)
      .bind(ART, owner.id, WS, ART_PUBLIC, owner.id, WS, ART_IN_FOLDER, owner.id, WS),
    env.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, created_at) VALUES
      ('ver_nt1', ?, 1, 'index.html', '2026-01-01T00:00:00.000Z'), ('ver_np1', ?, 1, 'index.html', '2026-01-01T00:00:00.000Z')`).bind(ART, ART_PUBLIC),
    env.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_nt', ?, 'ver_nt1', 'production', 'nt-roadmap'), ('dep_np', ?, 'ver_np1', 'production', 'nt-launch')").bind(ART, ART_PUBLIC),
    env.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_nt', ?, ?, 'editor')").bind(ART, editor.email),
    env.DB.prepare(`INSERT INTO user_profiles (user_id, follows) VALUES (?, ?), (?, ?), (?, ?)`)
      .bind(follower.id, JSON.stringify([{ kind: 'artifact', ref: ART }]), optedOut.id, JSON.stringify([{ kind: 'artifact', ref: ART }]),
        outsider.id, JSON.stringify([{ kind: 'artifact', ref: ART }, { kind: 'artifact', ref: ART_PUBLIC }])),
    env.DB.prepare("INSERT INTO email_preferences (user_id, category, opted_in) VALUES (?, 'product', 0)").bind(optedOut.id),
    env.DB.prepare("INSERT INTO messaging_links (platform, session_key, user_id, linked_at) VALUES ('telegram', '111', ?, '2026-01-01T00:00:00.000Z'), ('telegram', '222', ?, '2026-01-01T00:00:00.000Z')").bind(follower.id, optedOut.id),
    env.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('grt_nt', ?, 'external_user', ?, 'folder', 'fld_nt', 'view', ?)")
      .bind(WS, client.id, editor.id),
  ]);
});

beforeEach(() => { sendEmail.mockClear(); sendMessage.mockClear(); });
afterEach(() => vi.useRealTimers());

describe('version approved → owner', () => {
  it('tells the owner once per approver per version, with a feed row', async () => {
    expect((await setApproval(env, editor, ART, null, true)).ok).toBe(true);
    expect(sentTo()).toEqual([owner.email]);
    const mail = (sendEmail.mock.calls[0] as unknown as [unknown, { subject: string }])[1];
    expect(mail.subject).toBe('Eddie approved version 1 of Roadmap');
    await setApproval(env, editor, ART, null, false);
    await setApproval(env, editor, ART, null, true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const feed = await queryNeedsYou(env, owner, { workspaceId: WS });
    expect(feed.find((f) => f.kind === 'version_approved')).toMatchObject({ artifact_id: ART, actor: 'Eddie', summary: 'approved v1' });
  });

  it('never tells the owner about their own approval', async () => {
    await setApproval(env, owner, ART, null, true);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('outside person opens a shared folder → whoever shared it', () => {
  it('once per person per folder per day, never to the viewer', async () => {
    await recordShareeView(env, { workspaceId: WS, userId: client.id, resourceType: 'artifact', resourceId: ART_IN_FOLDER });
    await recordShareeView(env, { workspaceId: WS, userId: client.id, resourceType: 'artifact', resourceId: ART_IN_FOLDER });
    expect(sentTo()).toEqual([editor.email]);
    const mail = (sendEmail.mock.calls[0] as unknown as [unknown, { subject: string; text: string }])[1];
    expect(mail.subject).toBe('client@acme.test opened Acme deliverables');
    expect(mail.text).toContain('/home#l/artifacts/fld_nt');
    const feed = await queryNeedsYou(env, editor, { workspaceId: WS });
    expect(feed.find((f) => f.kind === 'folder_first_open')).toMatchObject({ actor: client.email, summary: 'opened it · Acme deliverables' });

    vi.useFakeTimers({ now: Date.now() + 86_400_000, toFake: ['Date'] });
    await recordShareeView(env, { workspaceId: WS, userId: client.id, resourceType: 'artifact', resourceId: ART_IN_FOLDER });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('says nothing for an artifact outside any folder shared with that person', async () => {
    await recordShareeView(env, { workspaceId: WS, userId: client.id, resourceType: 'artifact', resourceId: ART });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('new versions → followers and collaborators, debounced', () => {
  const publish = (id: string, artifactId: string, no: number, by: string, message: string | null, at: number) =>
    env.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, created_by, message, message_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, artifactId, no, 'index.html', by, message, message ? 'ai' : null, new Date(at).toISOString()).run();

  it('waits for publishing to settle, then sends one notice covering every version', async () => {
    const now = Date.now();
    await publish('ver_nt2', ART, 2, owner.id, 'Added the Q3 numbers', now - 30 * 60_000);
    await publish('ver_nt3', ART, 3, owner.id, 'Fixed the chart labels', now - 2 * 60_000);
    expect(await runVersionNoticeSweep(env, now)).toEqual({ notified: 0 });
    expect(sendEmail).not.toHaveBeenCalled();

    const later = now + VERSION_QUIET_MS;
    const res = await runVersionNoticeSweep(env, later);
    // editor (collaborator) + follower; the publisher, the opted-out follower's email and
    // the follower who cannot open a workspace page are left out.
    expect(sentTo().sort()).toEqual([editor.email, follower.email].sort());
    expect(res.notified).toBe(3);
    const mail = (sendEmail.mock.calls[0] as unknown as [unknown, { subject: string; text: string }])[1];
    expect(mail.subject).toBe('Roadmap has a new version');
    expect(mail.text).toContain('Version 2: Added the Q3 numbers');
    expect(mail.text).toContain('Version 3: Fixed the chart labels');
    expect(sendMessage.mock.calls.map((c) => (c as unknown as [unknown, number])[1])).toEqual([111]);

    sendEmail.mockClear();
    expect(await runVersionNoticeSweep(env, later + 3_600_000)).toEqual({ notified: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a public page reaches any follower, and never the person who published', async () => {
    const now = Date.now();
    await publish('ver_np2', ART_PUBLIC, 2, editor.id, null, now - 20 * 60_000);
    await runVersionNoticeSweep(env, now);
    expect(sentTo()).toEqual(expect.arrayContaining([outsider.email, owner.email]));
    expect(sentTo()).not.toContain(editor.email);
  });
});

describe('a new folder shared with an existing outside person', () => {
  const admin = { id: owner.id, email: owner.email, username: null } as AuthUser;
  const post = (body: unknown) => new Request('https://shareout.test/x', { method: 'POST', body: JSON.stringify(body) });

  it('emails an active external member a link to /shared?folder=<id>, once', async () => {
    await invalidateGrants(env, WS);
    const res = await handleCreateGrant(post({ subject_type: 'external_user', subject_id: client.id, resource_type: 'folder', resource_id: 'fld_nt_new', capability: 'view' }), env, admin, WS);
    expect(res.status).toBe(201);
    expect(sentTo()).toEqual([client.email]);
    const mail = (sendEmail.mock.calls[0] as unknown as [unknown, { subject: string; text: string }])[1];
    expect(mail.subject).toBe('Olivia shared Q4 plans with you');
    expect(mail.text).toContain('/shared?folder=fld_nt_new');
    sendEmail.mockClear();
    await handleCreateGrant(post({ subject_type: 'external_user', subject_id: client.id, resource_type: 'folder', resource_id: 'fld_nt_new', capability: 'view' }), env, admin, WS);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a person who never signed in gets only the invite, not a second email', async () => {
    const res = await handleShareWithPerson(post({ email: newbie.email, resource_type: 'folder', resource_id: 'fld_nt_new', capability: 'view' }), env, admin, WS);
    expect(res.status).toBe(201);
    const subjects = (sendEmail.mock.calls as unknown as Array<[unknown, { subject: string }]>).map(([, p]) => p.subject);
    expect(subjects.some((s) => s.includes('shared Q4 plans'))).toBe(false);
  });
});
