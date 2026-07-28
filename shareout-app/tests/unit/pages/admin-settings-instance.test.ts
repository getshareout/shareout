// @vitest-environment node
import { describe, expect, it } from 'vitest';
import adminTs from '../../../src/pages/home/render-workspace/client-script/home-views/admin.ts?raw';

// The Settings tab is a client script, so these are source-level guards: the values
// have to arrive as injected globals, because the browser cannot read env.
describe('workspace Settings — instance surfaces', () => {
  // Was `slug + '@inbox.shareout.site'`, so every self-hosted workspace was shown a
  // file-inbox address on the hosted product's domain. Mail sent there never arrives.
  it('builds the file inbox address from the instance domain', () => {
    expect(adminTs).toContain('window.WSX_INBOX_DOMAIN');
    expect(adminTs).not.toContain('@inbox.shareout.site');
  });

  it('hides the inbox address when the instance cannot receive mail', () => {
    // Empty domain ⇒ empty address ⇒ the section is not rendered at all, rather than
    // advertising an address that cannot receive.
    expect(adminTs).toContain("var inboxAddr = (slug && inboxDom)");
  });

  // /admin was reachable only by typing the URL — nothing in the app linked to it.
  it('links an instance admin to the admin portal', () => {
    expect(adminTs).toContain('window.WSX_INSTANCE_ADMIN');
    expect(adminTs).toContain('/admin?view=instance');
  });

  it('does not show the portal link to ordinary workspace admins', () => {
    // The link is behind the instance-admin global, not the workspace-admin one.
    const linkIdx = adminTs.indexOf('/admin?view=instance');
    const guardIdx = adminTs.indexOf('window.WSX_INSTANCE_ADMIN');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(linkIdx);
  });
});
