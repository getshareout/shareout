// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';
import { extractSignals, outboundHosts } from '../../../src/moderation/extract';

vi.mock('../../../src/fetch-utils', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  FetchTimeoutError: class extends Error {},
}));

const mockFetch = vi.fn();
const fireAlert = vi.fn();
vi.mock('../../../src/observability/alerts', () => ({
  fireAlert: (...args: unknown[]) => (fireAlert(...args), Promise.resolve()),
}));

import { runPublishSafetyCheck, verdictToStatus } from '../../../src/moderation/check';

const ENV = { OPENAI_API_KEY: 'sk-test' } as Env;
const BOTH_ENV = { VERCEL_AI_GATEWAY: 'gw-test', OPENAI_API_KEY: 'sk-test' } as Env;

function aiResponse(verdict: string, reason = 'ok') {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict, reason }) } }] }),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  fireAlert.mockReset();
});

describe('extractSignals', () => {
  it('pulls external scripts, iframes and outbound hosts', () => {
    const html = `
      <script src="https://evil.example/x.js"></script>
      <iframe src="https://tracker.example/frame"></iframe>
      <a href="https://docs.good.com/page">link</a>`;
    const s = extractSignals(html);
    expect(s.externalScripts).toContain('evil.example');
    expect(s.iframes).toContain('tracker.example');
    expect(extractSignals('<link rel="stylesheet" href="https://cdn.css.example/app.css"><link rel="icon" href="https://ico.example/f.png">').externalStyles)
      .toEqual(['cdn.css.example']); // only rel=stylesheet, not the icon link
    expect(outboundHosts(s)).toEqual(expect.arrayContaining(['evil.example', 'tracker.example', 'docs.good.com']));
  });

  it('scores obfuscated inline JS high', () => {
    const obf = `<script>eval(atob("ZG9jdW1lbnQud3JpdGU="));var a="\\x41\\x42\\x43";</script>`;
    expect(extractSignals(obf).obfuscationScore).toBeGreaterThanOrEqual(0.3);
    expect(extractSignals('<p>hello world</p>').obfuscationScore).toBe(0);
  });

  it('does not score large inline JSON / minified data as obfuscated (no eval tokens)', () => {
    // Data apps ship multi-MB inline datasets — size alone must not flag.
    const bigJson = `<script type="application/json" id="data">${'{"x":1},'.repeat(5000)}</script>`;
    expect(extractSignals(bigJson).obfuscationScore).toBe(0);
    const longMinified = `<script>${'const a=1;'.repeat(400)}</script>`;
    expect(extractSignals(longMinified).obfuscationScore).toBe(0);
  });
});

describe('verdictToStatus', () => {
  it('maps verdicts to moderation status (fail-safe)', () => {
    expect(verdictToStatus('clean')).toBe('approved');
    expect(verdictToStatus('malicious')).toBe('blocked');
    expect(verdictToStatus('suspicious')).toBe('pending');
    expect(verdictToStatus('error')).toBe('pending');
  });
});

describe('runPublishSafetyCheck', () => {
  it('approves clean content', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const r = await runPublishSafetyCheck(ENV, '<p>my dashboard</p>');
    expect(r.status).toBe('approved');
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('blocks malicious content', async () => {
    mockFetch.mockResolvedValue(aiResponse('malicious', 'phishing'));
    const r = await runPublishSafetyCheck(ENV, '<form>login to your bank</form>');
    expect(r.status).toBe('blocked');
  });

  it('fails safe to pending when the classifier errors', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'));
    const r = await runPublishSafetyCheck(ENV, '<p>x</p>');
    expect(r.verdict).toBe('error');
    expect(r.status).toBe('pending');
  });

  it('fails over to the next provider on a 402 and returns a clean verdict', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 402 }) // gateway out of credits
      .mockResolvedValueOnce(aiResponse('clean'));         // openai succeeds

    const r = await runPublishSafetyCheck(BOTH_ENV, '<p>my dashboard</p>');

    expect(r.status).toBe('approved');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(fireAlert).toHaveBeenCalledWith(
      expect.anything(),
      'ai:provider:failed:vercel-gateway',
      expect.stringContaining('failed over'),
      expect.any(Number),
    );
  });

  it('fails safe to pending when every provider fails, naming the last failure', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402 });

    const r = await runPublishSafetyCheck(BOTH_ENV, '<p>x</p>');

    expect(r.status).toBe('pending');
    expect(r.verdict).toBe('error');
    expect(r.reason).toBe('classifier http 402 (all providers)');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('approves when no AI provider is configured (self-host without a classifier)', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const r = await runPublishSafetyCheck({} as Env, '<p>x</p>');
    expect(r.status).toBe('approved');
    expect(r.reason).toMatch(/not configured/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('escalates clean-but-obfuscated content to suspicious/pending', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const obf = `<script>eval(atob("${'QQ'.repeat(20)}"));var s="\\x41\\x42";document.write(s);${'x'.repeat(2100)}</script>`;
    const r = await runPublishSafetyCheck(ENV, obf);
    expect(r.verdict).toBe('suspicious');
    expect(r.status).toBe('pending');
  });

  // The prompt now names *this instance's* domains rather than a hardcoded pair, so
  // the content domain comes from ARTIFACT_ORIGIN — which is how the hosted instance
  // is actually configured. Instance-specific behaviour: moderation/instance-domains.
  it('gives the classifier platform-domain context in the system prompt', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const hosted = { ...ENV, SHAREOUT_BASE_URL: 'https://shareout.site', ARTIFACT_ORIGIN: 'https://shareoutcdn.site' } as Env;
    await runPublishSafetyCheck(hosted, '<p>x</p>');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content).toContain('ShareOut');
    expect(body.messages[0].content).toContain('shareout.site');
    expect(body.messages[0].content).toContain('shareoutcdn.site');
  });

  // It used to name shareout.site unconditionally, which is backwards on every other
  // instance: a self-hoster's own artifacts linking to their own domain looked like
  // impersonation, while links to a domain they do not own were vouched for.
  it('names this instance domains, not the hosted ones', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    await runPublishSafetyCheck({ ...ENV, SHAREOUT_BASE_URL: 'https://acme.com' } as Env, '<p>x</p>');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content).toContain('acme.com and *.acme.com');
    expect(body.messages[0].content).not.toContain('shareout.site');
  });

  it('names a separate content origin alongside the app host', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const env = { ...ENV, SHAREOUT_BASE_URL: 'https://acme.com', ARTIFACT_ORIGIN: 'https://sandbox.acme.net' } as Env;
    await runPublishSafetyCheck(env, '<p>x</p>');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.messages[0].content).toContain('acme.com');
    expect(body.messages[0].content).toContain('sandbox.acme.net');
  });

  it('samples head + tail so end-of-file scripts survive truncation', async () => {
    mockFetch.mockResolvedValue(aiResponse('clean'));
    const big = '<!--HEAD_MARKER-->' + 'a'.repeat(80_000) + '<script>/*TAIL_MARKER*/</script>';
    await runPublishSafetyCheck(ENV, big);
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    const sent = body.messages[1].content as string;
    expect(sent).toContain('HEAD_MARKER');
    expect(sent).toContain('TAIL_MARKER');
    expect(sent).toMatch(/\[truncated \d+ chars\]/);
  });
});
