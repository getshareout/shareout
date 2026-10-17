// The cached grant context is keyed by every identity dimension the lookup matches on,
// so two callers with the same user ids but different emails never share an entry.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { canAccess } from '../../../src/access/can-access';

const WS = 'wsp_gck';
const ADMIN = 'usr_gck_admin';
const CALLER = 'usr_gck_caller';
const ART = 'art_gck';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'admin@example.com', 'a'), (?, 'caller@example.com', 'c')").bind(ADMIN, CALLER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'gck', ?)").bind(WS, ADMIN),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Shared', 'gck-shared', 'private', ?)").bind(ART, ADMIN, WS),
    e.DB.prepare("INSERT INTO sharees (id, workspace_id, name, slug, created_by) VALUES ('shr_gck', ?, 'Client', 'client', ?)").bind(WS, ADMIN),
    e.DB.prepare("INSERT INTO sharee_members (id, sharee_id, user_id, email, status, invited_by) VALUES ('sm_gck', 'shr_gck', NULL, 'guest@example.com', 'invited', ?)").bind(ADMIN),
    e.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('gr_gck', ?, 'sharee', 'shr_gck', 'artifact', ?, 'view', ?)").bind(WS, ART, ADMIN),
  ]);
});

describe('grant cache identity', () => {
  it('does not reuse an email-matched grant for the same user ids without that email', async () => {
    expect(await canAccess(e, { userIds: [CALLER], emails: ['guest@example.com'] }, 'artifact', ART, 'view')).toBe(true);
    expect(await canAccess(e, { userIds: [CALLER], emails: [] }, 'artifact', ART, 'view')).toBe(false);
    expect(await canAccess(e, { userIds: [CALLER], emails: ['other@example.com'] }, 'artifact', ART, 'view')).toBe(false);
  });
});
