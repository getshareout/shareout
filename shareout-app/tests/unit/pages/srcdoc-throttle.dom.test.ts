// @vitest-environment happy-dom
//
// Shared live-preview painter (/create + Studio Create with AI): throttles srcdoc repaints
// and never shows the markdown fence a model may wrap the page in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SRCDOC_THROTTLE_JS } from '../../../src/pages/srcdoc-throttle';

type Throttle = { push: (s: string) => void; flush: () => void; cancel: () => void };
const lib = new Function(`${SRCDOC_THROTTLE_JS}; return { stripFence: stripFence, srcdocThrottle: srcdocThrottle };`)() as {
  stripFence: (s: string) => string;
  srcdocThrottle: (apply: (s: string) => void, ms: number) => Throttle;
};
const F = '```';

describe('stripFence', () => {
  it('leaves an unfenced page alone', () => {
    const page = '<!doctype html>\n<html><body><p>Hi</p></body></html>';
    expect(lib.stripFence(page)).toBe(page);
    expect(lib.stripFence('<p>a `code` b</p>')).toBe('<p>a `code` b</p>');
  });

  it('drops a leading fence with or without a language, after leading whitespace', () => {
    expect(lib.stripFence(`${F}html\n<html></html>`)).toBe('<html></html>');
    expect(lib.stripFence(`${F}\n<html></html>`)).toBe('<html></html>');
    expect(lib.stripFence(`  \n ${F}HTML\n<html></html>`)).toBe('<html></html>');
  });

  it('drops a trailing fence, with or without trailing whitespace', () => {
    expect(lib.stripFence(`${F}html\n<html></html>\n${F}`)).toBe('<html></html>');
    expect(lib.stripFence(`<html></html>\n${F}\n  `)).toBe('<html></html>');
    expect(lib.stripFence(`<html></html>\n\`\``)).toBe('<html></html>');
  });

  it('hides a fence that is still arriving', () => {
    expect(lib.stripFence('`')).toBe('');
    expect(lib.stripFence('``')).toBe('');
    expect(lib.stripFence(`${F}ht`)).toBe('');
    expect(lib.stripFence(`${F}html`)).toBe('');
    expect(lib.stripFence(`${F}html\n`)).toBe('');
    expect(lib.stripFence(`${F}html\n<ht`)).toBe('<ht');
  });
});

describe('srcdocThrottle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('paints the first push at once and coalesces the rest into one paint per window', () => {
    const paints: string[] = [];
    const p = lib.srcdocThrottle(s => paints.push(s), 250);
    p.push('<p>a');
    expect(paints).toEqual(['<p>a']);
    p.push('<p>ab');
    p.push('<p>abc');
    expect(paints).toEqual(['<p>a']);
    vi.advanceTimersByTime(250);
    expect(paints).toEqual(['<p>a', '<p>abc']);
    p.push('<p>abcd');
    p.cancel();
    vi.advanceTimersByTime(500);
    expect(paints).toEqual(['<p>a', '<p>abc']);
  });

  it('never paints fence text when the fence is split across chunks', () => {
    const paints: string[] = [];
    const p = lib.srcdocThrottle(s => paints.push(s), 250);
    let full = '';
    for (const chunk of ['`', '``ht', 'ml\n<h1>', 'Hi</h1>\n', '``', '`']) {
      full += chunk;
      p.push(full);
      p.flush();
    }
    expect(paints.every(s => !s.includes('`'))).toBe(true);
    expect(paints[paints.length - 1]).toBe('<h1>Hi</h1>');
  });
});
