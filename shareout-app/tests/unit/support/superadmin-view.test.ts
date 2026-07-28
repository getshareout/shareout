import { describe, it, expect } from 'vitest';
import { supportBody } from '../../../src/superadmin/views/bodies/support';
import type { Ticket } from '../../../src/support/store';

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tkt_1', workspace_id: null, requester_user_id: null, requester_email: 'a@b.com',
    channel: 'email', channel_ref: 'a@b.com', subject: 'Need help', status: 'open',
    priority: 'high', category: 'bug', assignee_user_id: null, ai_draft: null, ai_meta_json: null,
    sla_due: null, created_at: 1, updated_at: 1, last_msg_at: 1_700_000_000_000, ...over,
  };
}

describe('supportBody', () => {
  it('renders an empty state with zeroed stats', () => {
    const html = supportBody([]);
    expect(html).toContain('No support tickets yet');
    expect(html).toContain('Tickets (latest 200)');
  });

  it('renders a row and labels null-workspace tickets as personal/email', () => {
    const html = supportBody([ticket(), ticket({ id: 'tkt_2', workspace_id: 'wsp_x', channel: 'ui', status: 'pending' })]);
    expect(html).toContain('Need help');
    expect(html).toContain('a@b.com');
    expect(html).toContain('personal / email'); // null workspace
    expect(html).toContain('wsp_x');
    expect(html).toContain('>pending<');
  });
});
