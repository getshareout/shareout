// Deliver-now / job email: the destination must surface a step trace (recipients + messageId),
// so a successful send is never reported as `steps: []`.
import { env } from 'cloudflare:workers';
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { DeliveryContext } from '../../../src/delivery/types';

vi.mock('../../../src/scheduling/email', () => ({
  sendArtifactEmail: vi.fn(async () => ({ success: true, messageId: 'msg_1' })),
  checkEmailRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })),
  incrementEmailCount: vi.fn(async () => {}),
}));
const { emailDestination } = await import('../../../src/delivery/destinations/email');
const { sendArtifactEmail } = await import('../../../src/scheduling/email');

const e = env as unknown as Env;
const ctx: DeliveryContext = { artifactId: 'art1', createdBy: 'usr', triggeredVia: 'manual' };

describe('emailDestination.deliver', () => {
  it('returns a deliver step with recipient count and messageId on success', async () => {
    const r = await emailDestination.deliver(e, ctx, { recipients: ['a@x.com', 'b@x.com'], subject: 's', html: '<p>h</p>' });
    expect(r.success).toBe(true);
    expect(r.steps).toHaveLength(1);
    expect(r.steps![0]).toMatchObject({ step: 'deliver', status: 'success', detail: { recipients: 2, messageId: 'msg_1' } });
  });

  it('returns a failed step carrying the error', async () => {
    vi.mocked(sendArtifactEmail).mockResolvedValueOnce({ success: false, error: 'boom' });
    const r = await emailDestination.deliver(e, ctx, { recipients: ['a@x.com'] });
    expect(r.success).toBe(false);
    expect(r.steps![0]).toMatchObject({ status: 'failed', detail: { error: 'boom' } });
  });
});
