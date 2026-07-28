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
