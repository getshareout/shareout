import { describe, it, expect } from 'vitest';
import { supportBody } from '../../../src/superadmin/views/bodies/support';
import type { Ticket } from '../../../src/support/store';

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 'tkt_1', workspace_id: null, requester_user_id: null, requester_email: 'a@b.com',
    channel: 'email', channel_ref: 'a@b.com', subject: 'Need help', status: 'open',
    priority: 'high', category: 'bug', assignee_user_id: null, ai_draft: null, ai_meta_json: null,
    sla_due: null, severity: null, request_id: null, page_url: null, artifact_id: null, user_agent: null,
    client: null, idempotency_key: null, locale: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', last_msg_at: '2026-10-01T00:00:00.000Z', ...over,
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

  it('makes rows open the thread, offers filters, and no longer claims Telegram pings', () => {
    const html = supportBody([ticket({ client: 'chat_agent', channel: 'ui', severity: 'blocker' })]);
    expect(html).toContain(`saTicket('tkt_1')`);
    expect(html).toContain('id="sa-sup-status"');
    expect(html).toContain('id="sa-sup-category"');
    expect(html).toContain('<option value="none">No workspace</option>');
    expect(html).toContain('ui · chat_agent');
    expect(html).toContain('bug · blocker');
    expect(html).not.toMatch(/telegram/i);
  });
});
