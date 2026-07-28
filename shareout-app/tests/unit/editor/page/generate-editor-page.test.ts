import { describe, expect, it } from 'vitest';
import {
  generateEditorPage,
  EDITOR_CLIENT_SCRIPT_URL,
} from '../../../../src/editor/page/generate-editor-page';

const options = {
  artifactId: 'art_test001',
  slug: 'hello-world',
  theme: 'light' as const,
};

describe('generateEditorPage', () => {
  it('produces a complete HTML document with head, body, and scripts', () => {
    const html = generateEditorPage(options);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en" data-theme="light">');
    expect(html).toContain('<title>Edit - hello-world | ShareOut</title>');
    expect(html).toContain('>hello-world</div>');
    expect(html).toContain('window.EDITOR_CONFIG');
    expect(html).toContain('artifactId: "art_test001"');
    expect(html).toContain('/sdk/v1/shareout.js');
    expect(html).toContain('/sdk/v1/shareout-charts.js');
    expect(html).toContain(`<script type="module" src="${EDITOR_CLIENT_SCRIPT_URL}"></script>`);
    expect(html.endsWith('</html>')).toBe(true);
  });

  it('does not inline collab or editor scripts (bundled in editor.js)', () => {
    const html = generateEditorPage(options);

    expect(html).not.toContain('class EditorCollab');
    expect(html).not.toContain('async function init()');
    expect(html.match(/<script type="module"/g)?.length).toBe(1);
  });

  it('defaults theme to auto when omitted', () => {
    const html = generateEditorPage({
      artifactId: 'art_x',
      slug: 's',
    });

    expect(html).toContain('data-theme="auto"');
    expect(html).toContain('theme: "auto"');
  });
});
