import { describe, expect, it } from 'vitest';
import { renderHtmlPage, renderHtmlPageStreamed } from '../../../src/design-system/shell';

const TITLE = '</title><script>x()</script>';
const DESCRIPTION = '"><script>y()</script>';

function head(html: string): string {
  return html.slice(0, html.indexOf('</head>'));
}

describe('page shell head', () => {
  it('renders the title as text', async () => {
    const html = await renderHtmlPage({ title: TITLE, pageStyles: '', body: '' }).text();
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>x()</script>');
  });

  it('escapes the description and the social tags built from title and description', async () => {
    const html = head(await renderHtmlPage({ title: TITLE, description: DESCRIPTION, pageStyles: '', body: '' }).text());
    expect(html).toContain('<meta name="description" content="&quot;&gt;&lt;script&gt;y()&lt;/script&gt;">');
    expect(html).toContain('<meta property="og:title" content="&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;">');
    expect(html).toContain('<meta name="twitter:description" content="&quot;&gt;&lt;script&gt;y()&lt;/script&gt;">');
    expect(html).not.toContain('<script>y()</script>');
    expect(html).not.toContain('<script>x()</script>');
  });

  it('escapes a plain-text title exactly once', async () => {
    const html = await renderHtmlPage({ title: 'R&D — Q3 "plan"', pageStyles: '', body: '' }).text();
    expect(html).toContain('<title>R&amp;D — Q3 &quot;plan&quot;</title>');
    expect(html).not.toContain('&amp;amp;');
  });

  it('escapes the streamed head the same way', async () => {
    const res = renderHtmlPageStreamed({
      title: TITLE,
      description: DESCRIPTION,
      pageStyles: '',
      body: async () => ({ body: '<p>ok</p>' }),
    });
    const html = await res.text();
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>');
    expect(html).not.toContain('<script>x()</script>');
    expect(html).not.toContain('<script>y()</script>');
  });
});
