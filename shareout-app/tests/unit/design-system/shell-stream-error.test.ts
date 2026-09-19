import { describe, expect, it, vi } from 'vitest';
import { renderHtmlPageStreamed } from '../../../src/design-system/shell';
import { renderStreamedPageErrorBody } from '../../../src/pages/not-found';

describe('renderHtmlPageStreamed error fallback', () => {
  it('renders a branded retry state when body() throws', async () => {
    const onStreamError = vi.fn();
    const res = renderHtmlPageStreamed({
      title: 'Test',
      pageStyles: '',
      body: async () => {
        throw new Error('boom');
      },
      onStreamError,
    });

    const html = await new Response(res.body).text();
    expect(onStreamError).toHaveBeenCalledOnce();
    expect(html).toContain(renderStreamedPageErrorBody().trim().slice(0, 40));
    expect(html).toContain('Try again');
    expect(html).toContain('Studio didn');
    expect(html).not.toContain('Something went wrong loading this page');
    expect(html).not.toContain('padding:2rem;font-family:system-ui');
  });
});
