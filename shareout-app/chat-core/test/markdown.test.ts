import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown';

describe('renderMarkdown', () => {
  it('escapes HTML before applying markdown', () => {
    expect(renderMarkdown('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
  });

  it('renders bold, italic, and code', () => {
    expect(renderMarkdown('**b** *i* `c`')).toBe('<strong>b</strong> <em>i</em> <code>c</code>');
  });

  it('renders http links with rel=noopener and ignores non-http', () => {
    expect(renderMarkdown('[site](https://x.com)')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener">site</a>'
    );
    expect(renderMarkdown('[evil](javascript:alert(1))')).toBe('[evil](javascript:alert(1))');
  });

  it('converts newlines to <br>', () => {
    expect(renderMarkdown('a\nb')).toBe('a<br>b');
  });
});
