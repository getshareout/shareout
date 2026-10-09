import { beforeEach, describe, it, expect, vi } from 'vitest';

const openTicket = vi.fn(async () => ({ id: 'tkt_1' }));
vi.mock('../../../src/support/intake', () => ({ openTicket: (...a: unknown[]) => openTicket(...a) }));
let ROLE: string | null = null;
vi.mock('../../../src/workspaces/roles', async (orig) => ({ ...(await orig<object>()), getInternalWorkspaceRole: async () => ROLE }));

import { reportProblemTool } from '../../../src/chat-agent/tools/report-problem';
import { ACCOUNT_TOOLS } from '../../../src/chat-agent/tools/index';
import { toolkitOf } from '../../../src/chat-agent/tools/toolkits';

const ctx = (selectedWorkspaceId: string | null = null) => ({ env: {} as never, userId: 'usr_1', selectedWorkspaceId });

beforeEach(() => { openTicket.mockClear(); ROLE = null; });

describe('report_problem tool', () => {
  it('is a core tool, always reachable without opening a toolkit', () => {
    expect(ACCOUNT_TOOLS.map((t) => t.name)).toContain('report_problem');
    expect(toolkitOf('report_problem')).toBeUndefined();
  });

  it('opens a chat_agent ticket with the context the agent passed', async () => {
    ROLE = 'member';
    const out = await reportProblemTool.execute(ctx('wsp_1'), {
      summary: 'Cannot publish', details: 'Tried twice; error 500', category: 'bug', severity: 'blocker',
      artifact_id: 'art_1', request_id: 'req_1', language: 'es',
    });
    expect(out).toMatchObject({ ok: true, ticket_id: 'tkt_1' });
    expect(openTicket).toHaveBeenCalledWith({}, expect.objectContaining({
      workspaceId: 'wsp_1', requesterUserId: 'usr_1', channel: 'ui', client: 'chat_agent',
      subject: 'Cannot publish', body: 'Tried twice; error 500', category: 'bug', severity: 'blocker',
      artifactId: 'art_1', requestId: 'req_1', locale: 'es',
    }));
  });

  it('drops a workspace the user is not in and defaults category/severity', async () => {
    await reportProblemTool.execute(ctx('wsp_x'), { summary: 's', details: 'd', category: 'nonsense' });
    expect(openTicket).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceId: null, category: 'bug', severity: 'normal' }));
  });

  it('asks for a summary and details', async () => {
    expect(await reportProblemTool.execute(ctx(), { summary: ' ' })).toEqual({ error: 'summary and details are required.' });
    expect(openTicket).not.toHaveBeenCalled();
  });
});
