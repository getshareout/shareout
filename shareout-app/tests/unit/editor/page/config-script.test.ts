import { describe, expect, it } from 'vitest';
import { renderEditorConfigScript } from '../../../../src/editor/page/template/config-script';

const baseOptions = {
  artifactId: 'art_abc123',
  slug: 'my-demo',
  theme: 'dark' as const,
  baseUrl: 'https://shareout.site',
};

describe('renderEditorConfigScript', () => {
  it('embeds artifact id, slug, theme, and base URL in window.EDITOR_CONFIG', () => {
    const script = renderEditorConfigScript(baseOptions);

    expect(script).toContain('window.EDITOR_CONFIG');
    expect(script).toContain('artifactId: "art_abc123"');
    expect(script).toContain('slug: "my-demo"');
    expect(script).toContain('theme: "dark"');
    expect(script).toContain('baseUrl: "https://shareout.site"');
  });
});

describe('renderEditorConfigScript aiEnabled', () => {
  it('defaults aiEnabled to true when omitted', () => {
    const script = renderEditorConfigScript(baseOptions);
    expect(script).toContain('aiEnabled: true');
  });

  it('embeds aiEnabled false when disabled', () => {
    const script = renderEditorConfigScript({ ...baseOptions, aiEnabled: false });
    expect(script).toContain('aiEnabled: false');
  });
});

describe('renderEditorConfigScript embedding', () => {
  it('keeps names that contain markup inside the script as data', () => {
    const name = '</script><script>x()</script>';
    const description = 'a\u2028b <!-- c';
    const script = renderEditorConfigScript({ ...baseOptions, name, description, userName: '</SCRIPT>' });

    expect(script.match(/<\/script/gi)).toHaveLength(1);
    expect(script).not.toContain('<!--');
    expect(script).not.toContain('\u2028');
    const value = (key: string) => JSON.parse(script.match(new RegExp(`${key}: (.*)`))![1].replace(/,$/, ''));
    expect(value('name')).toBe(name);
    expect(value('description')).toBe(description);
    expect(value('userName')).toBe('</SCRIPT>');
  });
});
