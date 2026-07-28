import { describe, expect, it } from 'vitest';
import { renderEmailLayout, renderEmailText, escapeHtml } from '../../src/email/layout';
import { colors } from '../../src/design-system/tokens';

describe('renderEmailLayout', () => {
  const base = { heading: 'Your page is live', bodyHtml: '<p>It is published.</p>' };

  it('wraps content in a full HTML document with a presentation table', () => {
    const html = renderEmailLayout(base);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('max-width:560px');
  });

  it('includes the ShareOut wordmark and logo and uses design tokens', () => {
    const html = renderEmailLayout(base);
    expect(html).toContain('ShareOut');
    expect(html).toContain('/brand/logo-mark.png');
    expect(html).toContain(colors.bg);
    expect(html).toContain(colors.text);
  });

  it('renders a hidden preheader', () => {
    const html = renderEmailLayout({ ...base, preheader: 'Published just now' });
    expect(html).toContain('Published just now');
    expect(html).toMatch(/display:none/);
  });

  it('renders a token-styled CTA button when provided', () => {
    const html = renderEmailLayout({ ...base, cta: { label: 'Open your home', href: 'https://shareout.site/app' } });
    expect(html).toContain('Open your home');
    expect(html).toContain('https://shareout.site/app');
    expect(html).toContain(colors.primary);
  });

  it('escapes the heading', () => {
    const html = renderEmailLayout({ ...base, heading: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderEmailText', () => {
  it('produces a tag-free plaintext twin ending in the signature', () => {
    const text = renderEmailText({ heading: 'Hi', bodyText: 'Body here', cta: { label: 'Open', href: 'https://shareout.site/app' } });
    expect(text).not.toContain('<');
    expect(text).toContain('https://shareout.site/app');
    expect(text.trim().endsWith('— ShareOut')).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('escapes the five entities', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
  });
});
