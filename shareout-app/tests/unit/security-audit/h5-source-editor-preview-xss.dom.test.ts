// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateSourceEditorPage } from '../../../src/editor/source/page';

const page = generateSourceEditorPage({
  artifactId: 'a', slug: 's', name: 'n', type: 'markdown', entrypoint: 'index.md', path: null,
  content: '', baseUrl: 'https://so.test', versionNo: 1,
});
const code = page.slice(page.indexOf('function escHtml'), page.indexOf('/* ---------- csv grid'));
const render = new Function(`${code}; return (md) => (typeof safeHtml === 'function' ? safeHtml(mdToHtml(md)) : mdToHtml(md));`)() as (md: string) => string;

function dangerous(md: string): boolean {
  const t = document.createElement('template');
  t.innerHTML = render(md);
  return [...t.content.querySelectorAll('*')].some((el) =>
    ['script', 'iframe', 'object', 'embed', 'svg', 'style'].includes(el.tagName.toLowerCase()) ||
    // eslint-disable-next-line no-control-regex
    [...el.attributes].some((a) => a.name.startsWith('on') || (['href', 'src'].includes(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value.replace(/[\u0000- ]/g, '')))));
}

describe('h5 source editor markdown preview', () => {
  it('blocks: raw HTML and attribute injection in markdown cannot run script on the app origin', () => {
    expect(dangerous('hello <img src=x onerror=alert(1)>')).toBe(false);
    expect(dangerous('![x](a" onerror="alert(1))')).toBe(false);
    expect(dangerous('[click](javascript:alert(1))')).toBe(false);
    expect(dangerous('[click](java\tscript:alert(1))')).toBe(false);
    expect(dangerous('text <script>alert(1)</script>')).toBe(false);
    expect(dangerous('- item <svg onload=alert(1)>')).toBe(false);
    expect(dangerous('> quote <iframe src="javascript:alert(1)">')).toBe(false);
  });

  it('still renders normal markdown', () => {
    const out = render('# Title\n\n**bold** and [link](https://x.test/a) ![i](https://x.test/i.png)\n\n- one\n- two');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<a href="https://x.test/a">link</a>');
    expect(out).toContain('<img src="https://x.test/i.png" alt="i">');
    expect(out).toContain('<li>one</li>');
  });
});
