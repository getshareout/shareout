import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the render module so importing email.ts doesn't pull in @cloudflare/puppeteer.
vi.mock('../../src/screenshots', () => ({ captureArtifactReport: vi.fn() }));

import {
  artifactEmailAddress,
  artifactEmailDomain,
  checkEmailRateLimit,
  incrementEmailCount,
  sendArtifactEmail,
  sendEmail,
} from '../../src/scheduling/email';
import { captureArtifactReport } from '../../src/screenshots';
import type { Env } from '../../src/types';

function envWithEmail(send: SendEmail['send']): Env {
  return {
    EMAIL: { send },
  } as Env;
}

/** Returns DB.first() results in prepare() call order. */
function dbEnv(firstResults: unknown[], overrides: Partial<Env> = {}): Env {
  let idx = 0;
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstResults[idx++] ?? null),
        run: vi.fn(async () => ({})),
      })),
    })),
  };
  return {
    DB: db,
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
    EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'msg_1' }) },
    ARTIFACTS: { get: vi.fn() },
    ...overrides,
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('artifact email helpers', () => {
  it('builds artifact email domain and addresses from env', () => {
    expect(artifactEmailDomain({ EMAIL_ARTIFACTS_DOMAIN: 'mail.example.com' } as Env)).toBe('mail.example.com');
    expect(artifactEmailDomain({} as Env)).toBe('artifacts.shareout.site');
    expect(artifactEmailAddress('report', { EMAIL_ARTIFACTS_DOMAIN: 'mail.example.com' } as Env))
      .toBe('report@mail.example.com');
  });
});

describe('sendEmail', () => {
  it('returns error when recipients are missing', async () => {
    const result = await sendEmail(envWithEmail(vi.fn()), {
      from: 'noreply@shareout.site',
      to: [],
      subject: 'Test',
      text: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('recipient');
  });

  it('returns error when EMAIL binding is missing', async () => {
    const result = await sendEmail({} as Env, {
      from: 'noreply@shareout.site',
      to: ['user@example.com'],
      subject: 'Test',
      text: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('EMAIL Workers binding');
  });

  it('returns error when body is empty', async () => {
    const result = await sendEmail(envWithEmail(vi.fn()), {
      from: 'noreply@shareout.site',
      to: ['user@example.com'],
      subject: 'Test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('text or html');
  });

  it('sends via Cloudflare Email Service binding', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_abc' });

    const result = await sendEmail(envWithEmail(send), {
      from: 'report@artifacts.shareout.site',
      replyTo: 'owner@example.com',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Daily report',
      text: 'Plain',
      html: '<p>HTML</p>',
    });

    expect(result).toEqual({ success: true, messageId: 'msg_abc' });
    expect(send).toHaveBeenCalledWith({
      from: { email: 'report@artifacts.shareout.site', name: 'ShareOut' },
      to: ['a@example.com', 'b@example.com'],
      subject: 'Daily report',
      replyTo: 'owner@example.com',
      text: 'Plain',
      html: '<p>HTML</p>',
    });
  });

  it('maps binding errors to a clear message', async () => {
    const send = vi.fn().mockRejectedValue(new Error('domain not verified'));

    const result = await sendEmail(envWithEmail(send), {
      from: 'noreply@shareout.site',
      to: ['user@example.com'],
      subject: 'Test',
      text: 'Hi',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cloudflare Email Service error');
    expect(result.error).toContain('domain not verified');
  });

  it('stringifies non-Error rejections', async () => {
    const send = vi.fn().mockRejectedValue('smtp down');

    const result = await sendEmail(envWithEmail(send), {
      from: 'noreply@shareout.site',
      to: ['user@example.com'],
      subject: 'Test',
      text: 'Hi',
    });

    expect(result.error).toBe('Cloudflare Email Service error: smtp down');
  });

  it('passes a single recipient as a string to the binding', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_single' });

    await sendEmail(envWithEmail(send), {
      from: 'noreply@shareout.site',
      to: ['solo@example.com'],
      subject: 'Test',
      text: 'Hi',
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'solo@example.com' }));
  });
});

describe('sendArtifactEmail', () => {
  const artifact = { id: 'art_1', name: 'Q4 Report', slug: 'q4-report' };

  it('returns error when artifact is missing', async () => {
    const env = dbEnv([null]);
    const result = await sendArtifactEmail(env, 'art_missing', {
      recipients: ['a@example.com'],
      subject: 'Hi',
      body: 'Plain',
    });
    expect(result).toEqual({ success: false, error: 'Artifact not found' });
  });

  it('sends with artifact prefix, link, content, and reply-to from record', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_art' });
    const artifactsGet = vi.fn().mockResolvedValue({
      text: async () => '<section>Snapshot</section>',
    });
    const env = dbEnv(
      [artifact, { email_prefix: 'report', reply_to: 'owner@example.com' }, { r2_key: 'keys/index.html' }],
      {
        EMAIL: { send },
        EMAIL_ARTIFACTS_DOMAIN: 'mail.example.com',
        ARTIFACTS: { get: artifactsGet },
      }
    );

    const result = await sendArtifactEmail(env, 'art_1', {
      recipients: ['team@example.com'],
      subject: 'Weekly',
      body: 'Summary',
      html: '<p>Summary</p>',
      includeArtifactLink: true,
      includeArtifactContent: true,
    });

    expect(result).toEqual({ success: true, messageId: 'msg_art' });
    expect(send).toHaveBeenCalledWith({
      from: { email: 'report@mail.example.com', name: 'ShareOut' },
      to: 'team@example.com',
      subject: 'Weekly',
      replyTo: 'owner@example.com',
      text: expect.stringContaining('Summary'),
      html: expect.stringMatching(/Summary.*View Q4 Report.*Snapshot/s),
    });
    expect(send.mock.calls[0][0].text).toContain('https://shareout.example.com/a/q4-report/');
    expect(artifactsGet).toHaveBeenCalledWith('keys/index.html');
  });

  it('uses default from, slug-less URL, reply override, and fallback templates', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_default' });
    const env = dbEnv(
      [{ id: 'art_2', name: 'Dashboard', slug: '' }, null],
      { EMAIL: { send }, EMAIL_DEFAULT_FROM: 'alerts@corp.example.com' }
    );

    await sendArtifactEmail(env, 'art_2', {
      recipients: ['ops@example.com'],
      replyTo: 'visitor@example.com',
      includeArtifactLink: true,
    });

    const call = send.mock.calls[0][0];
    expect(call.from.email).toBe('alerts@corp.example.com');
    expect(call.replyTo).toBe('visitor@example.com');
    expect(call.subject).toBe('Update from Dashboard');
    expect(call.text).toContain('https://shareout.example.com/a/art_2/');
    expect(call.html).toContain('View Dashboard');
  });

  it('appends link-only content when body fields are empty', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_link' });
    const env = dbEnv([artifact, null], { EMAIL: { send } });

    await sendArtifactEmail(env, 'art_1', {
      recipients: ['a@example.com'],
      subject: 'Link only',
      includeArtifactLink: true,
    });

    const call = send.mock.calls[0][0];
    expect(call.text).toBe('View artifact: https://shareout.example.com/a/q4-report/');
    expect(call.html).toContain('<a href="https://shareout.example.com/a/q4-report/">View Q4 Report</a>');
  });

  it('renders default scheduled templates when body is empty', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_tpl' });
    const env = dbEnv([artifact, null], { EMAIL: { send } });

    await sendArtifactEmail(env, 'art_1', {
      recipients: ['a@example.com'],
      subject: '',
    });

    const call = send.mock.calls[0][0];
    expect(call.subject).toBe('Update from Q4 Report');
    expect(call.text).toContain('Scheduled email from Q4 Report');
    expect(call.html).toContain('Scheduled email from <strong>Q4 Report</strong>');
  });

  it('renders the artifact to PDF + CSV and uses the artifact email html', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_render' });
    const pdf = new ArrayBuffer(16);
    (captureArtifactReport as ReturnType<typeof vi.fn>).mockResolvedValue({
      pdf,
      data: { emailSubject: 'Live Subject', emailHtml: '<h1>Live numbers</h1>', csv: 'User,Read\nA,1', csvFilename: 'perms.csv' },
    });
    const env = dbEnv([artifact, null], { EMAIL: { send } });

    const result = await sendArtifactEmail(env, 'art_1', {
      recipients: ['leonel@example.com'],
      subject: 'fallback subject',
      html: '<p>fallback</p>',
      renderPdf: true,
      attachArtifactCsv: true,
      useArtifactEmailHtml: true,
    });

    expect(result).toEqual({ success: true, messageId: 'msg_render' });
    const call = send.mock.calls[0][0];
    expect(call.subject).toBe('Live Subject');
    expect(call.html).toBe('<h1>Live numbers</h1>');
    expect(call.attachments).toEqual([
      { content: 'User,Read\nA,1', filename: 'perms.csv', type: 'text/csv', disposition: 'attachment' },
      { content: pdf, filename: 'q4-report.pdf', type: 'application/pdf', disposition: 'attachment' },
    ]);
  });

  it('falls back to config html and omits attachments when render yields nothing', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_norender' });
    (captureArtifactReport as ReturnType<typeof vi.fn>).mockResolvedValue({ pdf: null, data: null });
    const env = dbEnv([artifact, null], { EMAIL: { send } });

    await sendArtifactEmail(env, 'art_1', {
      recipients: ['a@example.com'],
      subject: 'Subj',
      html: '<p>fallback body</p>',
      renderPdf: true,
      useArtifactEmailHtml: true,
    });

    const call = send.mock.calls[0][0];
    expect(call.html).toBe('<p>fallback body</p>');
    expect(call.attachments).toBeUndefined();
  });

  it('skips R2 content when entrypoint or object is missing', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'msg_no_r2' });
    const artifactsGet = vi.fn().mockResolvedValue(null);
    const env = dbEnv([artifact, null, null], {
      EMAIL: { send },
      ARTIFACTS: { get: artifactsGet },
    });

    await sendArtifactEmail(env, 'art_1', {
      recipients: ['a@example.com'],
      subject: 'No snapshot',
      html: '<p>Body</p>',
      includeArtifactContent: true,
    });

    expect(artifactsGet).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].html).toBe('<p>Body</p>');
  });
});

describe('checkEmailRateLimit', () => {
  it('allows sends when under user and artifact limits', async () => {
    const today = new Date().toISOString().split('T')[0];
    const env = dbEnv([{ count: 5 }, { emails_sent_today: 2, last_reset_date: today }]);

    const result = await checkEmailRateLimit(env, 'user_1', 'art_1');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(8);
    expect(result.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('blocks when user or artifact daily limits are exhausted', async () => {
    const today = new Date().toISOString().split('T')[0];

    const userBlocked = dbEnv([{ count: 50 }, { emails_sent_today: 0, last_reset_date: today }]);
    expect((await checkEmailRateLimit(userBlocked, 'user_1', 'art_1')).allowed).toBe(false);

    const artifactBlocked = dbEnv([{ count: 0 }, { emails_sent_today: 10, last_reset_date: today }]);
    expect((await checkEmailRateLimit(artifactBlocked, 'user_1', 'art_1')).allowed).toBe(false);

    const staleArtifact = dbEnv([{ count: 0 }, { emails_sent_today: 99, last_reset_date: '2020-01-01' }]);
    const reset = await checkEmailRateLimit(staleArtifact, 'user_1', 'art_1');
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(10);
  });
});

describe('incrementEmailCount', () => {
  it('updates user and artifact counters', async () => {
    const env = dbEnv([]);
    const runSpy = vi.fn(async () => ({}));
    env.DB.prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(), run: runSpy })),
    })) as Env['DB']['prepare'];

    await incrementEmailCount(env, 'user_1', 'art_1');

    expect(env.DB.prepare).toHaveBeenCalledTimes(2);
    expect(runSpy).toHaveBeenCalledTimes(2);
  });
});
