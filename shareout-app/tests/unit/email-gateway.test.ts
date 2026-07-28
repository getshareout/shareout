import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AudienceInfo } from '../../src/email/audience';

// Isolate the gateway's routing logic from DB/transport by mocking its collaborators.
// The catalog + layout render for real (pure functions).
const { resolveAudience, isCategoryAllowed, isSuppressed, sendEmail, unsubscribeUrl } = vi.hoisted(() => ({
  resolveAudience: vi.fn(),
  isCategoryAllowed: vi.fn(),
  isSuppressed: vi.fn(),
  sendEmail: vi.fn(),
  unsubscribeUrl: vi.fn(),
}));

vi.mock('../../src/email/audience', () => ({ resolveAudience }));
vi.mock('../../src/email/preferences', () => ({ isCategoryAllowed }));
vi.mock('../../src/email/suppressions', () => ({ isSuppressed }));
vi.mock('../../src/scheduling/email', () => ({ sendEmail }));
vi.mock('../../src/email/unsubscribe-token', () => ({ unsubscribeUrl }));

import { dispatchLifecycleEmail } from '../../src/email/gateway';

const env = { EMAIL_DEFAULT_FROM: 'noreply@shareout.site', SHAREOUT_BASE_URL: 'https://shareout.site' } as any;
const aud = (segment: AudienceInfo['segment'], isComplimentary = false): AudienceInfo => ({ segment, isComplimentary });
const COMMENT = { fromName: 'Beto', verb: 'mentioned you in a comment', title: 'Q3', snippet: 'hi', url: 'https://shareout.site/a/q3/' };

// A segmented (non-ANY) type — activation_nudge is INDIVIDUAL-only.
const segmented = (segment: AudienceInfo['segment']) => {
  resolveAudience.mockResolvedValue(aud(segment));
  return dispatchLifecycleEmail(env, { type: 'activation_nudge', toUserId: 'u1', toEmail: 'u1@example.com' });
};

beforeEach(() => {
  vi.clearAllMocks();
  isCategoryAllowed.mockResolvedValue(true);
  isSuppressed.mockResolvedValue(false);
  sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
  unsubscribeUrl.mockResolvedValue('https://shareout.site/v1/email/unsubscribe?token=t');
  resolveAudience.mockResolvedValue(aud('INDIVIDUAL'));
});

describe('audience gating', () => {
  it('drops a segmented type when the recipient is out of segment', async () => {
    expect((await segmented('TEAM_MEMBER')).skipped).toBe('audience');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends a segmented type to a matching recipient', async () => {
    const r = await segmented('INDIVIDUAL');
    expect(r.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail.mock.calls[0][1].subject).toContain('publish your first page');
  });

  it('ANY product email reaches a team member', async () => {
    resolveAudience.mockResolvedValue(aud('TEAM_MEMBER'));
    const r = await dispatchLifecycleEmail(env, { type: 'comment_notify', toUserId: 'u1', toEmail: 'u1@example.com', data: COMMENT });
    expect(r.sent).toBe(true);
  });
});

describe('preferences and suppression', () => {
  it('drops a product email when the user opted out', async () => {
    isCategoryAllowed.mockResolvedValue(false);
    const r = await dispatchLifecycleEmail(env, { type: 'comment_notify', toUserId: 'u1', toEmail: 'u1@example.com', data: COMMENT });
    expect(r.skipped).toBe('opted_out');
  });

  it('transactional bypasses preferences', async () => {
    isCategoryAllowed.mockResolvedValue(false);
    const r = await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: 'u1@example.com' });
    expect(r.sent).toBe(true);
  });

  it('hard-stops a suppressed address', async () => {
    isSuppressed.mockResolvedValue(true);
    const r = await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: 'u1@example.com' });
    expect(r.skipped).toBe('suppressed');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('rendering, headers and recipients', () => {
  it('renders the catalog template into a full HTML document', async () => {
    await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: 'u1@example.com' });
    const params = sendEmail.mock.calls[0][1];
    expect(params.subject).toBe('Welcome to ShareOut — your home is ready');
    expect(params.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(params.html).toContain('Your home is ready');
    expect(params.text).toContain('— ShareOut');
  });

  it('adds List-Unsubscribe for non-transactional, not for transactional', async () => {
    await segmented('INDIVIDUAL');
    expect(sendEmail.mock.calls[0][1].headers['List-Unsubscribe']).toContain('unsubscribe');
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ success: true });
    await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: 'u1@example.com' });
    expect(sendEmail.mock.calls[0][1].headers).toBeUndefined();
  });

  it('returns no_recipient when no address resolvable', async () => {
    const r = await dispatchLifecycleEmail(env, { type: 'welcome' });
    expect(r.skipped).toBe('no_recipient');
  });

  it('blocks a bare address on a segmented (non-ANY, non-EXTERNAL) type', async () => {
    // activation_nudge is INDIVIDUAL-only: with no userId we can't verify the segment.
    const r = await dispatchLifecycleEmail(env, { type: 'activation_nudge', toEmail: 'ext@x.com' });
    expect(r.skipped).toBe('audience');
  });

  it('allows an ANY type sent by bare email (e.g. welcome at signup)', async () => {
    const r = await dispatchLifecycleEmail(env, { type: 'welcome', toEmail: 'new@x.com' });
    expect(r.sent).toBe(true);
  });
});

describe('LIFECYCLE_EMAILS_DISABLED', () => {
  const off = { ...env, LIFECYCLE_EMAILS_DISABLED: '1' };

  it('skips every catalog email including transactional', async () => {
    expect((await dispatchLifecycleEmail(off, { type: 'otp', toEmail: 'u@x.com', data: { code: '123456' } })).skipped).toBe('disabled');
    expect((await dispatchLifecycleEmail(off, { type: 'welcome', toEmail: 'u@x.com' })).skipped).toBe('disabled');
    expect((await dispatchLifecycleEmail(off, { type: 'first_view', toEmail: 'u@x.com', data: { pageName: 'P', url: 'https://x' } })).skipped).toBe('disabled');
    expect((await dispatchLifecycleEmail(off, { type: 'weekly_digest', toEmail: 'u@x.com', data: { views: 1, comments: 0, published: 0 } })).skipped).toBe('disabled');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
