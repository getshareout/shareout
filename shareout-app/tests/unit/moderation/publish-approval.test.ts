// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

// External effects mocked — we test the approval state machine, not R2/AI/email.
vi.mock('../../../src/moderation/check', () => ({
  contentHash: async () => 'hash1',
  classifyAndPersist: async () => 'approved',
}));
vi.mock('../../../src/serve/deployment-cache', () => ({ invalidateDeploymentCacheById: async () => {} }));
vi.mock('../../../src/scheduling/email', () => ({ sendArtifactEmail: async () => ({ success: true }) }));
const role = vi.fn(async (userId: string) => (typeof userId === 'string' && userId.startsWith('m') ? 'member' : null));
vi.mock('../../../src/workspaces', () => ({
  getWorkspaceRole: async (_e: unknown, _w: string, userId: string) => role(userId),
  getInternalWorkspaceRole: async (_e: unknown, _w: string, userId: string) => role(userId),
}));

import { createPublishApproval, decidePublishApproval } from '../../../src/publish-approval';

// Minimal stateful DB + R2 keyed by SQL substring.
function makeEnv(opts: { policy?: string; n?: number } = {}): Env {
  const approvals = new Map<string, { id: string; artifact_id: string; requested_visibility: string; content_hash: string; status: string; requester_id: string }>();
  const voters: Array<{ approval_id: string; approver_id: string; status: string }> = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('public_publish_policy')) return { policy: opts.policy ?? 'require_approval', n: opts.n ?? 1 } as T;
              if (sql.includes('ast.r2_key')) return { r2_key: 'k', mime: 'text/html' } as T;
              if (sql.includes("status = 'approved' LIMIT 1")) return null as T; // hasApprovedPublish
              if (sql.startsWith('SELECT * FROM artifact_publish_approvals WHERE id')) {
                return (approvals.get(args[0] as string) ?? null) as T;
              }
              if (sql.includes('UPDATE artifact_publish_approval_voters SET status')) {
                const [status, approvalId, approverId] = args as [string, string, string];
                const v = voters.find((x) => x.approval_id === approvalId && x.approver_id === approverId && x.status === 'pending');
                if (!v) return null as T;
                v.status = status;
                return { id: 'v' } as T;
              }
              if (sql.includes('COUNT(*) AS n FROM artifact_publish_approval_voters')) {
                const approvalId = args[0] as string;
                const n = voters.filter((x) => x.approval_id === approvalId && x.status !== 'approved').length;
                return { n } as T;
              }
              if (sql.includes("SET status='approved'") && sql.includes('RETURNING id')) {
                const a = approvals.get(args[0] as string);
                if (a && a.status === 'pending') { a.status = 'approved'; return { id: a.id } as T; }
                return null as T;
              }
              return null as T;
            },
            async run() {
              if (sql.startsWith('INSERT INTO artifact_publish_approvals')) {
                const [id, artifact_id, , requester_id, requested_visibility, content_hash] = args as string[];
                approvals.set(id, { id, artifact_id, requested_visibility, content_hash, status: 'pending', requester_id });
              } else if (sql.startsWith('INSERT INTO artifact_publish_approval_voters')) {
                const [, approval_id, approver_id] = args as string[];
                voters.push({ approval_id, approver_id, status: 'pending' });
              } else if (sql.includes("UPDATE artifact_publish_approvals SET status='rejected'")) {
                const a = approvals.get(args[0] as string);
                if (a && a.status === 'pending') a.status = 'rejected';
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { DB, ARTIFACTS: { get: async () => ({ text: async () => '<html></html>' }) }, SHAREOUT_BASE_URL: 'https://x' } as unknown as Env;
}

beforeEach(() => role.mockClear());

describe('createPublishApproval', () => {
  it('rejects when the workspace does not require approval', async () => {
    const r = await createPublishApproval(makeEnv({ policy: 'allow' }), { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1'] });
    expect(r.ok).toBe(false);
  });
  it('requires exactly N approvers', async () => {
    const r = await createPublishApproval(makeEnv({ n: 2 }), { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exactly 2/);
  });
  it('rejects non-members and self-nomination', async () => {
    const nonMember = await createPublishApproval(makeEnv({ n: 1 }), { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['x9'] });
    expect(nonMember.ok).toBe(false);
    const selfOnly = await createPublishApproval(makeEnv({ n: 1 }), { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m0'] });
    expect(selfOnly.ok).toBe(false); // self filtered out -> 0 approvers
  });
  it('creates a pending request with valid approvers', async () => {
    const r = await createPublishApproval(makeEnv({ n: 1 }), { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1'] });
    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();
  });
});

describe('decidePublishApproval', () => {
  it('finalizes when the only approver approves', async () => {
    const env = makeEnv({ n: 1 });
    const created = await createPublishApproval(env, { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1'] });
    const r = await decidePublishApproval(env, created.id!, 'm1', 'approve');
    expect(r.status).toBe('approved');
  });
  it('stays pending until all N approve', async () => {
    const env = makeEnv({ n: 2 });
    const created = await createPublishApproval(env, { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1', 'm2'] });
    expect((await decidePublishApproval(env, created.id!, 'm1', 'approve')).status).toBe('pending');
    expect((await decidePublishApproval(env, created.id!, 'm2', 'approve')).status).toBe('approved');
  });
  it('rejects the whole request on one rejection', async () => {
    const env = makeEnv({ n: 2 });
    const created = await createPublishApproval(env, { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1', 'm2'] });
    expect((await decidePublishApproval(env, created.id!, 'm1', 'reject')).status).toBe('rejected');
    // m2 can no longer act on a decided request
    expect((await decidePublishApproval(env, created.id!, 'm2', 'approve')).ok).toBe(false);
  });
  it('rejects a non-nominated approver', async () => {
    const env = makeEnv({ n: 1 });
    const created = await createPublishApproval(env, { artifactId: 'a', workspaceId: 'w', requesterId: 'm0', visibility: 'public', approverIds: ['m1'] });
    expect((await decidePublishApproval(env, created.id!, 'm9', 'approve')).ok).toBe(false);
  });
});
