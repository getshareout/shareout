// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderFolderReadme, sanitizeShellHtml } from '../../src/pages/home/folder-readme';

describe('folder README rendering (shell-safe)', () => {
  it('renders markdown to HTML', () => {
    const html = renderFolderReadme('# Q3\n\nExec **audience**.');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>audience</strong>');
  });

  it('empty / whitespace README → empty string', () => {
    expect(renderFolderReadme('')).toBe('');
    expect(renderFolderReadme('   \n  ')).toBe('');
    expect(renderFolderReadme(null)).toBe('');
    expect(renderFolderReadme(undefined)).toBe('');
  });

  it('strips script/style/iframe tags', () => {
    const out = sanitizeShellHtml('<p>ok</p><script>alert(1)</script><iframe src="x"></iframe>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
    expect(out).toContain('<p>ok</p>');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeShellHtml('<a href="#" onclick="steal()">x</a>');
    expect(out).not.toMatch(/onclick/i);
  });

  it('neutralizes javascript: and non-image data: URLs', () => {
    expect(sanitizeShellHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(sanitizeShellHtml('<a href="data:text/html,<script>">x</a>')).not.toMatch(/data:text/i);
  });

  it('renders a javascript: markdown link without an executable href', () => {
    // parseMarkdown turns [x](javascript:...) into an <a href="javascript:...">; sanitize must defuse it.
    expect(renderFolderReadme('[click](javascript:alert(1))')).not.toMatch(/href=["']javascript:/i);
  });
});
