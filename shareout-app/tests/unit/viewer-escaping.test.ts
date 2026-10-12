// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/viewers/markdown-viewer';
import { renderViewer } from '../../src/viewers';
import { renderLibraryViewer } from '../../src/viewers/library-viewer';
import { serveTypeViewer } from '../../src/serve/type-viewer';
import type { ArtifactType, Env } from '../../src/types';
import { renderToolbarScriptCore } from '../../src/serve/sandbox-viewer/toolbar/script-core';
import { renderToolbarScriptComments } from '../../src/serve/sandbox-viewer/toolbar/script-comments';
import { renderToolbarScriptAdmin } from '../../src/serve/sandbox-viewer/toolbar/script-admin';

// Real (unescaped) tags in the output, with <script> bodies removed.
function tagsOf(html: string): string[] {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>').match(/<[a-zA-Z][^<>]*>/g) ?? [];
}

function decode(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Anything that would execute script once the output is parsed as HTML.
function expectInert(html: string) {
  for (const tag of tagsOf(html)) {
    const name = /^<([a-zA-Z0-9]+)/.exec(tag)![1].toLowerCase();
    expect(['script', 'iframe', 'svg', 'object', 'embed', 'style', 'base', 'form', 'meta', 'link']).not.toContain(name);
    expect(tag.replace(/"[^"]*"|'[^']*'/g, '""')).not.toMatch(/\son[a-z]+\s*=/i);
    for (const [, url] of tag.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)) {
      // eslint-disable-next-line no-control-regex
      expect(decode(url).replace(/[\x00-\x20]/g, '')).not.toMatch(/^(?:javascript|vbscript|data):/i);
    }
  }
}

describe('parseMarkdown escapes untrusted content', () => {
  const payloads: Array<[string, string]> = [
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(2)>'],
    ['svg onload', '<svg onload=alert(3)>'],
    ['iframe', '<iframe src="javascript:alert(4)"></iframe>'],
    ['html in paragraph with markdown', 'hello **<b onmouseover=alert(5)>x</b>**'],
    ['html in list item', '- <img src=x onerror=alert(6)>'],
    ['html in table cell', '| a | b |\n|---|---|\n| <script>alert(7)</script> | <svg onload=alert(8)> |\n'],
    ['html in blockquote', '> <img src=x onerror=alert(9)>'],
    ['html in inline code', '`<script>alert(10)</script>`'],
    ['html in heading', '# <img src=x onerror=alert(11)>'],
    ['javascript: link', '[x](javascript:alert(12))'],
    ['mixed-case javascript: link', '[x](JaVaScRiPt:alert(13))'],
    ['whitespace-obfuscated javascript: link', '[x]( \tjava\tscript:alert(14))'],
    ['vbscript: link', '[x](vbscript:msgbox(15))'],
    ['data: link', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxNik8L3NjcmlwdD4=)'],
    ['javascript: image', '![x](javascript:alert(17))'],
    ['data: image', '![x](data:image/svg+xml,<svg onload=alert(18)>)'],
    ['attribute breakout in link href', '[x](http://a.example/" onmouseover="alert(19))'],
    ['attribute breakout in image alt', '![" onerror="alert(20)](http://a.example/i.png)'],
    ['autolink', '<javascript:alert(21)>'],
    ['entity-encoded scheme', '[x](&#106;avascript:alert(22))'],
    ['nested markdown in link text', '[**<img src=x onerror=alert(23)>**](https://a.example)'],
    ['link text hiding a second link', '[a](https://ok.example)](javascript:alert(24))'],
  ];

  it.each(payloads)('%s', (_name, md) => {
    expectInert(parseMarkdown(md));
  });

  it('keeps raw HTML visible as text', () => {
    expect(parseMarkdown('<b>hi</b>')).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('keeps safe links and images working', () => {
    const html = parseMarkdown('[a](https://x.example/p?q=1&r=2) [b](mailto:a@b.co) [c](#top) [d](/rel) ![i](https://x.example/i.png)');
    expect(html).toContain('<a href="https://x.example/p?q=1&amp;r=2">a</a>');
    expect(html).toContain('<a href="mailto:a@b.co">b</a>');
    expect(html).toContain('<a href="#top">c</a>');
    expect(html).toContain('<a href="/rel">d</a>');
    expect(html).toContain('<img src="https://x.example/i.png" alt="i">');
  });

  it('renders unsafe links as plain text', () => {
    const html = parseMarkdown('[click me](javascript:alert(1))');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a');
  });

  it('still renders markdown structure', () => {
    const html = parseMarkdown('# Title & co\n\n**bold** _it_ `a<b`\n\n- one\n- two\n\n> quote\n\n```js\nif (a < b) {}\n```\n');
    expect(html).toContain('<h1 id="title-co">Title &amp; co</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>a&lt;b</code>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<blockquote>quote</blockquote>');
    expect(html).toContain('<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
  });
});

function render(type: ArtifactType, content: string, loggedIn = true) {
  return renderViewer(type, 'slug', 'name', {}, 'https://shareout.test', content, true, 'art_1', loggedIn, false,
    undefined, undefined, undefined, undefined, 'testnonce')!;
}

describe('type viewers ship no inline handlers and nonce every script', () => {
  const cases: Array<[ArtifactType, string]> = [
    ['markdown', '# hi\n\n<img src=x onerror=alert(1)>'],
    ['txt', '<script>alert(1)</script>'],
    ['csv', 'a,b\n<script>alert(1)</script>,"<img src=x onerror=alert(2)>"\n'],
    ['json', JSON.stringify({ "x');alert(1);('": 1, "\"><img src=x onerror=alert(2)>": [null, true, '<script>'], '<svg onload=alert(3)>': {} })],
  ];

  it.each(cases)('%s', (type, content) => {
    const html = render(type, content);
    for (const tag of tagsOf(html)) expect(tag.replace(/"[^"]*"|'[^']*'/g, '""')).not.toMatch(/\son[a-z]+\s*=/i);
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toBe('<script nonce="testnonce">');
  });

  it('json viewer keeps key paths as escaped data attributes', () => {
    const html = render('json', JSON.stringify({ "a\"b": 1 }));
    expect(html).toContain('data-path="a&quot;b"');
  });
});

function fakeEnv(content: string): Env {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) };
  return {
    SHAREOUT_BASE_URL: 'https://shareout.test',
    ARTIFACTS: { get: async () => ({ text: async () => content }) },
    DB: { prepare: () => stmt, batch: async () => [] },
  } as unknown as Env;
}

describe('serveTypeViewer CSP', () => {
  it('restricts scripts to a per-response nonce', async () => {
    const res = await serveTypeViewer(
      new Request('https://shareout.test/a/slug/'),
      fakeEnv('# hi'),
      { artifact_id: 'art_1', artifact_type: 'markdown', artifact_name: 'n', owner_id: 'u', visibility: 'private', workspace_id: null, type_metadata: null, entrypoint: 'README.md' } as never,
      { r2_key: 'k', mime: 'text/markdown', size_bytes: 4 },
      'slug',
      undefined as never,
    );
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toMatch(/frame-ancestors /);
    const nonce = /script-src 'nonce-([a-f0-9]+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
  });
});

describe('sandbox-viewer toolbar escaping', () => {
  const scripts = [
    renderToolbarScriptCore(),
    renderToolbarScriptComments('https://shareout.test', 'art_1'),
    renderToolbarScriptAdmin('https://shareout.test', 'slug', 'art_1'),
  ].join('\n');

  it('client escapeHtml also escapes quotes', () => {
    const fn = /function escapeHtml\(s\) \{([\s\S]*?)\}/.exec(scripts)![1];
    expect(fn).toContain('&quot;');
    expect(fn).toContain('&#39;');
  });

  it('never splices escaped user strings into inline-handler JS', () => {
    expect(scripts).not.toMatch(/on[a-z]+="[^"]*\\'' *\+ *escapeHtml\(/);
  });
});

describe('library viewer keeps code out of the reader view (L6)', () => {
  it('shows the README first and tucks import snippets into a closed "For developers" panel', () => {
    const html = renderLibraryViewer({
      slug: 'fmt', artifactName: 'Formato es-AR', artifactType: 'library' as ArtifactType,
      typeMetadata: { library: { exports: ['formatUSD'] } } as never,
      baseUrl: 'https://x.test', content: '# Formato\n\nFormatea montos.', isAdmin: false, artifactId: 'art_1',
      loggedIn: false, isFavorite: false, locale: 'es',
      libraryMetrics: { scope: 'workspace', version: '1.0.0', versions: ['1.0.0'], importPath: '/lib/fmt.js', moduleName: 'fmt' } as never,
    });
    const readme = html.indexOf('Formatea montos');
    const dev = html.indexOf('<details class="lib-dev">');
    expect(readme).toBeGreaterThan(-1);
    expect(dev).toBeGreaterThan(readme);
    expect(html).toContain('<summary>Para desarrolladores</summary>');
    expect(html.indexOf('ESM import')).toBeGreaterThan(dev);
    expect(html.indexOf('class="lib-chip lib-export"')).toBeGreaterThan(dev);
  });
});
