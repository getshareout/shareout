// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderCreatePage } from '../../../src/pages/create';

const html = async (host?: string) =>
  renderCreatePage('build me a dashboard', { id: 'usr_1', email: 'a@b.test' }, undefined, host).text();

describe('/create mock URL bar', () => {
  // It shows where the page being built will live. Hardcoded to the hosted domain,
  // it told every self-hoster their work would land on someone else's instance —
  // while they were creating their very first page.
  it('names the instance the page is being built on', async () => {
    const out = await html('acme.workers.dev');
    expect(out).toContain('acme.workers.dev/<b>your-project</b>');
    expect(out).not.toContain('shareout.site');
  });

  it('uses the same host when the slug updates client-side', async () => {
    const out = await html('acme.workers.dev');
    // Both the slug-change and reset paths rebuild the bar; neither may reintroduce
    // the hosted domain.
    expect(out).toContain('"acme.workers.dev" + \'/<b>\' + esc(slug)');
    expect(out).toContain('"acme.workers.dev" + \'/<b>your-project</b>\'');
  });

  it('escapes the host rather than interpolating it raw', async () => {
    const out = await html('</div><script>x</script>');
    expect(out).not.toContain('<script>x</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('falls back to the hosted domain when no host is supplied', async () => {
    expect(await html()).toContain('shareout.site/<b>your-project</b>');
  });
});
