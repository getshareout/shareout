import { describe, expect, it } from 'vitest';
import { renderCreatePage } from '../../../src/pages/create';

describe('/create live preview frame', () => {
  it('runs the generated page in a scripts-only sandbox, outside the app origin', async () => {
    const html = await renderCreatePage('build me a dashboard', null).text();
    const tag = html.match(/<iframe[^>]*id="previewFrame"[^>]*>/)![0];
    expect(tag.match(/sandbox="([^"]*)"/)![1].split(/\s+/)).toEqual(['allow-scripts']);
  });

  it('only ever writes srcdoc into the preview, never reaches into it', async () => {
    const html = await renderCreatePage('build me a dashboard', { id: 'usr_1', email: 'a@b.test' }).text();
    expect(html).toContain('frame.srcdoc = ');
    expect(html).not.toMatch(/frame\.content(Document|Window)/);
  });
});
