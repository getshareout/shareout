import { describe, expect, it } from 'vitest';
import { EMAILS } from '../../src/email/catalog';

const ctx = { env: {} as any, baseUrl: 'https://shareout.site' };

describe('catalog: artifact_share', () => {
  const base = {
    artifactName: 'Q3 Sales Dashboard',
    artifactDescription: 'Revenue and pipeline overview',
    viewUrl: 'https://shareout.site/a/q3-sales/',
    thumbnailUrl: 'https://shareout.site/t/art_123.webp',
    role: 'none' as const,
  };
  const build = EMAILS.artifact_share.build!;

  it('builds subject with and without sharer name', () => {
    expect(build({ ...base, sharerName: 'Leo' }, ctx).subject).toBe('Leo shared: Q3 Sales Dashboard');
    expect(build(base, ctx).subject).toBe('Shared with you: Q3 Sales Dashboard');
  });

  it('includes preview image, view link and CTA', () => {
    const { bodyHtml, cta } = build(base, ctx);
    expect(bodyHtml).toContain(base.thumbnailUrl);
    expect(cta?.href).toBe(base.viewUrl);
    expect(cta?.label).toBe('Open page');
  });

  it('escapes interpolated values', () => {
    const { bodyHtml } = build({ ...base, artifactName: '<script>alert(1)</script>', customMessage: 'a & b "c"' }, ctx);
    expect(bodyHtml).not.toContain('<script>alert(1)</script>');
    expect(bodyHtml).toContain('a &amp; b &quot;c&quot;');
  });

  it('adds an editor note when role is editor', () => {
    const { bodyHtml, bodyText } = build({ ...base, role: 'editor' }, ctx);
    expect(bodyHtml).toContain('added as an editor');
    expect(bodyText).toContain('added as an editor');
  });
});

describe('catalog: other templates', () => {
  it('otp embeds the code', () => {
    const b = EMAILS.otp.build!({ code: '123456' }, ctx);
    expect(b.subject).toBe('123456 is your ShareOut code');
    expect(b.bodyHtml).toContain('123456');
  });

  it('workspace_invite shows the claim code and expiry', () => {
    const b = EMAILS.workspace_invite.build!({ workspaceName: 'Acme', inviterName: 'Leo', claimCode: 'ABC-123', claimTtlDays: 7 }, ctx);
    expect(b.bodyHtml).toContain('ABC-123');
    expect(b.footerNote).toContain('7 days');
  });

  it('comment_notify escapes the snippet', () => {
    const b = EMAILS.comment_notify.build!({ fromName: 'Beto', verb: 'mentioned you in a comment', title: 'Q3', snippet: '<b>x</b>', url: 'https://shareout.site/a/q3/' }, ctx);
    expect(b.bodyHtml).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(b.cta?.href).toBe('https://shareout.site/a/q3/');
  });

  it('publish_approval varies by kind', () => {
    expect(EMAILS.publish_approval.build!({ kind: 'approved' }, ctx).subject).toContain('approved');
    expect(EMAILS.publish_approval.build!({ kind: 'declined' }, ctx).subject).toContain('declined');
  });

  it('first_publish includes the page name and url', () => {
    const b = EMAILS.first_publish.build!({ pageName: 'Q3 Notes', url: 'https://shareout.site/a/q3/' }, ctx);
    expect(b.subject).toBe('Your page is live');
    expect(b.bodyHtml).toContain('Q3 Notes');
    expect(b.cta?.href).toBe('https://shareout.site/a/q3/');
  });

  it('added_to_workspace tells the existing member they are in', () => {
    const b = EMAILS.added_to_workspace.build!({ workspaceName: 'Enterprise', inviterName: 'Leonel' }, ctx);
    expect(b.subject).toBe("You've been added to Enterprise on ShareOut");
    expect(b.bodyHtml).toContain('Enterprise');
    expect(EMAILS.added_to_workspace.category).toBe('transactional');
  });

  it('member_joined names member and workspace', () => {
    const b = EMAILS.member_joined.build!({ memberName: 'Ana', workspaceName: 'Acme' }, ctx);
    expect(b.subject).toBe('Ana joined Acme');
  });

  it('access_request escapes and links', () => {
    const b = EMAILS.access_request.build!({ requesterEmail: 'a@x.com', pageName: 'Plan', url: 'https://shareout.site/home' }, ctx);
    expect(b.subject).toContain('a@x.com');
    expect(b.cta?.href).toBe('https://shareout.site/home');
  });

  it('activation_nudge nudges to publish', () => {
    const b = EMAILS.activation_nudge.build!({}, ctx);
    expect(b.subject).toContain('first page');
    expect(b.cta?.href).toBe('https://shareout.site/app');
  });

  it('first_view names the page', () => {
    const b = EMAILS.first_view.build!({ pageName: 'Q3 Notes', url: 'https://shareout.site/a/q3/' }, ctx);
    expect(b.subject).toBe('Someone viewed Q3 Notes');
  });

  it('win_back is product-category so it sends by default', () => {
    expect(EMAILS.win_back.category).toBe('product');
    expect(EMAILS.win_back.build!({}, ctx).subject).toContain('still live');
  });

  it('weekly_digest summarizes the week', () => {
    const b = EMAILS.weekly_digest.build!({ views: 12, comments: 3, published: 1 }, ctx);
    expect(b.bodyHtml).toContain('12');
    expect(b.bodyHtml).toContain('page published');
  });

  it('every template declares a trigger', () => {
    for (const [key, t] of Object.entries(EMAILS)) {
      expect(t.trigger, `${key} missing trigger`).toBeTruthy();
    }
  });
});
