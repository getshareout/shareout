import { describe, expect, it } from 'vitest';
import { EMAILS } from '../../src/email/catalog';
import { buildEmail, EMAILS_ES } from '../../src/email/catalog-es';
import { renderEmailLayout } from '../../src/email/layout';

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

  it('workspace_invite links the claim, points at connecting an assistant, and states expiry', () => {
    const b = EMAILS.workspace_invite.build!({ workspaceName: 'Acme', inviterName: 'Leo', claimCode: 'ABC-123', claimTtlDays: 7 }, ctx);
    expect(b.cta?.href).toBe('https://shareout.site/invite/ABC-123');
    expect(b.bodyHtml).not.toContain('Claim with code');
    expect(b.bodyText).not.toContain('Claim with code');
    expect(b.bodyHtml).toContain('https://shareout.site/home?view=connect');
    expect(b.bodyHtml).toContain('connect Claude or ChatGPT in 2 minutes');
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

describe('catalog: Spanish (es-AR)', () => {
  const es = { ...ctx, locale: 'es' as const };

  it('builds the invite in voseo with the connect line and no claim code', () => {
    const b = buildEmail('workspace_invite', { workspaceName: 'Acme', inviterName: 'Leo', claimCode: 'ABC-123', claimTtlDays: 7 }, es)!;
    expect(b.subject).toBe('Te invitaron a Acme en ShareOut');
    expect(b.bodyHtml).toContain('Después de entrar, conectá Claude o ChatGPT en 2 minutos');
    expect(b.bodyHtml).toContain('https://shareout.site/home?view=connect');
    expect(b.bodyHtml).not.toContain('ABC-123');
    expect(b.cta?.href).toBe('https://shareout.site/invite/ABC-123');
    expect(b.footerNote).toContain('7 días');
  });

  it('uses the mention/reply reason for comments', () => {
    const d = { fromName: 'Beto', verb: 'replied to your comment', title: 'Q3', snippet: 'ok', url: 'https://x/', reason: 'reply' };
    expect(buildEmail('comment_notify', d, es)!.subject).toBe('Beto respondió tu comentario en Q3');
    expect(buildEmail('comment_notify', { ...d, reason: 'mention' }, es)!.subject).toBe('Beto te mencionó en un comentario en Q3');
  });

  it('falls back to English for types without Spanish copy, and in English by default', () => {
    expect(EMAILS_ES.win_back).toBeUndefined();
    expect(buildEmail('win_back', {}, es)!.subject).toContain('still live');
    expect(buildEmail('otp', { code: '1' }, ctx)!.subject).toBe('1 is your ShareOut code');
    expect(buildEmail('otp', { code: '1' }, es)!.subject).toBe('1 es tu código de ShareOut');
  });

  it('localizes the shell (lang + footer)', () => {
    const html = renderEmailLayout({ heading: 'Hola', bodyHtml: '', managePreferencesUrl: 'https://x/', locale: 'es' });
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Enviado por ShareOut');
    expect(html).toContain('Elegí qué mails recibís');
    expect(renderEmailLayout({ heading: 'Hi', bodyHtml: '' })).toContain('<html lang="en">');
  });

  it('every Spanish template avoids tuteo', () => {
    const samples: Record<string, Record<string, unknown>> = {
      otp: { code: '1' }, welcome: {}, workspace_invite: { workspaceName: 'A', inviterName: 'B', claimCode: 'C', claimTtlDays: 7 },
      added_to_workspace: { workspaceName: 'A', inviterName: 'B' }, workspace_welcome: { workspaceName: 'A', inviterName: 'B', role: 'a member' },
      invite_accepted: { memberName: 'A', workspaceName: 'B' }, member_joined: { memberName: 'A', workspaceName: 'B' },
      comment_notify: { fromName: 'A', verb: '', title: 'T', snippet: 's', url: 'u' },
      action_item_assigned: { fromName: 'A', title: 'T', snippet: 's', url: 'u', dueAt: '2026-10-09T00:00:00.000Z' },
      action_item_resolved: { fromName: 'A', title: 'T', snippet: 's', url: 'u' },
      artifact_share: { artifactName: 'A', viewUrl: 'u', thumbnailUrl: 't', role: 'editor' },
      access_request: { requesterEmail: 'a@b.c', pageName: 'P', url: 'u' }, access_approved: { pageName: 'P', url: 'u' },
      access_declined: { pageName: 'P' }, publish_approval: { kind: 'request' }, job_failed: { jobName: 'J', error: 'e' },
      support_resolved: { subject: 'S' }, asset_delivery: { collectionName: 'C', downloadUrl: 'u', fileCount: 2 },
    };
    for (const [type, data] of Object.entries(samples)) {
      const b = buildEmail(type as any, data, es)!;
      const all = [b.subject, b.heading, b.bodyHtml, b.bodyText, b.footerNote, b.cta?.label].join(' ');
      expect(all, type).not.toMatch(/\b(tú|tienes|puedes|quieres|elige|haz|ingresa|abre)\b/i);
    }
  });
});

describe('workspace_invite personal message', () => {
  const base = { workspaceName: 'Acme', inviterName: 'Leo', claimCode: 'C', claimTtlDays: 7 };
  const c = { env: {} as never, baseUrl: 'https://example.com' };

  it('quotes the inviter’s note, escaped, in both languages', () => {
    const en = buildEmail('workspace_invite', { ...base, personalMessage: 'Hi <b>team</b>' }, c)!;
    expect(en.bodyHtml).toContain('Leo added a note:');
    expect(en.bodyHtml).toContain('<blockquote');
    expect(en.bodyHtml).toContain('Hi &lt;b&gt;team&lt;/b&gt;');
    expect(en.bodyText).toContain('"Hi <b>team</b>"');
    const es = buildEmail('workspace_invite', { ...base, personalMessage: 'Hola' }, { ...c, locale: 'es' })!;
    expect(es.bodyHtml).toContain('Leo te dejó un mensaje:');
  });

  it('omits the block when the note is empty', () => {
    const b = buildEmail('workspace_invite', { ...base, personalMessage: '  ' }, c)!;
    expect(b.bodyHtml).not.toContain('<blockquote');
    expect(b.bodyHtml).not.toContain('added a note');
  });
});
