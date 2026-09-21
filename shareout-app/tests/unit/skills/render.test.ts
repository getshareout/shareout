// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderSkillHtml } from '../../../src/skills/render';

// This output is injected into the Studio, same origin as the session cookie, and any
// workspace member can publish a skill. The markdown-viewer used elsewhere passes raw
// HTML through — safe in a sandboxed artifact, a stored XSS here — so these are the
// tests that keep the two renderers from being confused for each other.
describe('renderSkillHtml — untrusted input', () => {
  it('escapes a script tag instead of emitting one', () => {
    const html = renderSkillHtml('# Hi\n\n<script>alert(1)</script>\n');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an inline event handler on an author-written tag', () => {
    const html = renderSkillHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;img');
  });

  it('refuses to turn a javascript: link into an anchor', () => {
    const html = renderSkillHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('<a href="javascript');
    expect(html).toContain('[click](javascript:alert(1))');
  });

  it('refuses a data: URL link', () => {
    const html = renderSkillHtml('[x](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('<a href="data:');
  });

  it('does not let a code fence smuggle markup out', () => {
    const html = renderSkillHtml('```html\n<script>alert(1)</script>\n```');
    expect(html).toContain('<pre><code class="language-html">');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('escapes a bare iframe and an svg onload', () => {
    const html = renderSkillHtml('<iframe src="//evil"></iframe>\n\n<svg onload=alert(1)>');
    expect(html).not.toMatch(/<(iframe|svg)/i);
  });
});

describe('renderSkillHtml — markdown it is supposed to render', () => {
  it('renders headings, emphasis and inline code', () => {
    const html = renderSkillHtml('## Steps\n\nUse **bold**, *em* and `so.json()`.\n');
    expect(html).toContain('<h2>Steps</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code>so.json()</code>');
  });

  it('renders lists and blockquotes', () => {
    const html = renderSkillHtml('- one\n- two\n\n> note\n');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<blockquote>note</blockquote>');
  });

  it('renders an https link and opens it safely', () => {
    const html = renderSkillHtml('[docs](https://example.com/a)');
    expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it('drops the frontmatter block from the rendered body', () => {
    const html = renderSkillHtml('---\ncategory: Design\n---\n\n# Title\n');
    expect(html).not.toContain('category');
    expect(html).toContain('<h1>Title</h1>');
  });

  it('keeps code-fence contents byte-exact apart from escaping', () => {
    const html = renderSkillHtml('```js\nconst a = 1 < 2 && 3 > 2;\n```');
    expect(html).toContain('const a = 1 &lt; 2 &amp;&amp; 3 &gt; 2;');
  });
});
