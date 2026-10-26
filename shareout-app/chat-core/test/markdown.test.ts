import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown';

describe('renderMarkdown', () => {
  it('escapes HTML before applying markdown', () => {
    expect(renderMarkdown('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('renders bold, italic, and code', () => {
    expect(renderMarkdown('**b** *i* `c`')).toBe('<strong>b</strong> <em>i</em> <code>c</code>');
  });

  it('renders http links with rel=noopener noreferrer and ignores non-http', () => {
    expect(renderMarkdown('[site](https://x.com)')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer">site</a>'
    );
    expect(renderMarkdown('[evil](javascript:alert(1))')).toBe('[evil](javascript:alert(1))');
  });

  it('keeps quotes from a link text or url inside the attribute', () => {
    const html = renderMarkdown('[a "b" \'c\'](https://x.com/?q="1"&r=\'2\')');
    expect(html).toBe(
      '<a href="https://x.com/?q=&quot;1&quot;&amp;r=&#39;2&#39;" target="_blank" rel="noopener noreferrer">a &quot;b&quot; &#39;c&#39;</a>'
    );
    const t = document.createElement('template');
    t.innerHTML = renderMarkdown('[x](https://a"onmouseover="alert(1))');
    const a = t.content.querySelector('a')!;
    expect(a.getAttributeNames()).toEqual(['href', 'target', 'rel']);
    expect(a.getAttribute('href')).toBe('https://a"onmouseover="alert(1');
  });

  it('never puts markup written by another rule inside a link url', () => {
    expect(renderMarkdown('[x](https://a.com/`b`)')).toBe('[x](https://a.com/<code>b</code>)');
  });

  it('converts newlines to <br>', () => {
    expect(renderMarkdown('a\nb')).toBe('a<br>b');
  });
});
