import { describe, expect, it } from 'vitest';
import { renderEditorShell } from '../../../../src/editor/page/template/shell';

describe('renderEditorShell', () => {
  it('includes slug in the artifact name field', () => {
    const html = renderEditorShell({ slug: 'quarterly-report' });
    expect(html).toContain('>quarterly-report</div>');
  });

  it('includes required editor regions and controls', () => {
    const html = renderEditorShell({ slug: 'x' });

    expect(html).toContain('id="canvas-frame"');
    expect(html).toContain('id="studio-rail"');
    expect(html).toContain('id="chat-messages"');
    expect(html).toContain('id="chat-input"');
    expect(html).toContain('id="property-panel"');
    expect(html).toContain('id="data-browser"');
    expect(html).toContain('id="tab-inspect"');
    expect(html).toContain('id="btn-publish"');
    expect(html).toContain('id="lasso-overlay"');
    expect(html).toContain('data-tool="select"');
    expect(html).toContain('data-tool="lasso"');
  });
});
