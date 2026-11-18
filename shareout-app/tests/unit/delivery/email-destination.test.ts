// Deliver-now / job email: the destination must surface a step trace (recipients + messageId),
// so a successful send is never reported as `steps: []`.
import { env } from 'cloudflare:workers';
import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { DeliveryContext } from '../../../src/delivery/types';

vi.mock('../../../src/scheduling/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/scheduling/email')>()),
  sendArtifactEmail: vi.fn(async () => ({ success: true, messageId: 'msg_1' })),
  checkEmailRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })),
  incrementEmailCount: vi.fn(async () => {}),
}));
const { emailDestination } = await import('../../../src/delivery/destinations/email');
const { sendArtifactEmail } = await import('../../../src/scheduling/email');

const e = env as unknown as Env;
const ctx: DeliveryContext = { artifactId: 'art1', createdBy: 'usr', triggeredVia: 'manual' };

describe('emailDestination.validate', () => {
  const base = { recipients: ['a@x.com'], renderPdf: true };

  it('accepts a known paper size and orientation', async () => {
    expect(await emailDestination.validate(e, ctx, { ...base, pdfFormat: 'A4', pdfLandscape: true })).toBeNull();
    expect(await emailDestination.validate(e, ctx, base)).toBeNull();
  });

  it('rejects an unknown pdfFormat and a non-boolean pdfLandscape', async () => {
    expect(await emailDestination.validate(e, ctx, { ...base, pdfFormat: 'A3' as never }))
      .toBe('pdfFormat must be one of: A4, Letter, Legal');
    expect(await emailDestination.validate(e, ctx, { ...base, pdfFormat: 'A4', pdfLandscape: 'yes' as never }))
      .toBe('pdfLandscape must be true or false');
  });
});

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
