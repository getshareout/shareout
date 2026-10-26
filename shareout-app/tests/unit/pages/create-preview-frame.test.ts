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

  it('asks who can see it before building, private by default, and sends the choice', async () => {
    const html = await renderCreatePage('build me a dashboard', { id: 'usr_1', email: 'a@b.test' }).text();
    expect(html).toContain('Who can see it?');
    expect(html).toContain("vis: 'private'");
    expect(html).toContain('visibility: state.vis');
  });

  it('only says Copied! once the clipboard write succeeds', async () => {
    const html = await renderCreatePage('build me a dashboard', { id: 'usr_1', email: 'a@b.test' }).text();
    expect(html).toContain("writeText(url).then(function(){ flash('Copied!'); }, function(){ flash('Couldn’t copy'); })");
  });
});
