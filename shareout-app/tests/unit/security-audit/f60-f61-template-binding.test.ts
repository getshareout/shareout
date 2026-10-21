import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { getTemplateForArtifact, previewTemplate } from '../../../src/scheduling/templates';
import { emailDestination } from '../../../src/delivery/destinations/email';

const A = 'usr_f60_a';
const B = 'usr_f60_b';
const ART_B = 'art_f60_b';
const ART_A = 'art_f60_a';

beforeAll(applyMigrations);
beforeEach(async () => {
  await e.DB.exec("DELETE FROM email_templates WHERE id LIKE 'tpl_f60%'");
  await e.DB.exec("DELETE FROM artifacts WHERE id IN ('art_f60_a','art_f60_b')");
  await e.DB.exec("DELETE FROM users WHERE id IN ('usr_f60_a','usr_f60_b')");
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(A, 'f60a@x.test'),
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(B, 'f60b@x.test'),
  ]);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'B art', 'f60-b', ?, 'private')").bind(ART_B, B),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, 'SECRET-NAME', 'secret-slug', ?, 'private')").bind(ART_A, A),
    e.DB.prepare("INSERT INTO email_templates (id, artifact_id, owner_id, name, subject, html) VALUES ('tpl_f60_acct_a', NULL, ?, 'a', 'S', 'MARKER-A')").bind(A),
    e.DB.prepare("INSERT INTO email_templates (id, artifact_id, owner_id, name, subject, html) VALUES ('tpl_f60_acct_b', NULL, ?, 'b', 'S', 'MARKER-B')").bind(B),
    e.DB.prepare("INSERT INTO email_templates (id, artifact_id, owner_id, name, subject, html) VALUES ('tpl_f60_art_b', ?, ?, 'c', 'S', 'MARKER-C')").bind(ART_B, B),
    e.DB.prepare("INSERT OR REPLACE INTO email_templates (id, artifact_id, owner_id, name, subject, html, is_system) VALUES ('tpl_f60_sys', NULL, ?, 'sys', 'S', 'SYS', 1)").bind(A),
  ]);
});

describe('f60 delivery template lookup', () => {
  it("blocks: another user's account-level template is not usable on my artifact", async () => {
    expect(await getTemplateForArtifact(e, 'tpl_f60_acct_a', ART_B)).toBeNull();
    expect(await emailDestination.validate(e, { artifactId: ART_B, createdBy: B } as never, { recipients: ['r@x.test'], template_id: 'tpl_f60_acct_a' } as never))
      .toContain('Template not found');
  });

  it('still resolves own account-level, artifact-level and system templates', async () => {
    expect((await getTemplateForArtifact(e, 'tpl_f60_acct_b', ART_B))?.html).toBe('MARKER-B');
    expect((await getTemplateForArtifact(e, 'tpl_f60_art_b', ART_B))?.html).toBe('MARKER-C');
    expect((await getTemplateForArtifact(e, 'tpl_f60_sys', ART_B))?.html).toBe('SYS');
  });
});

describe('f61 template preview access', () => {
  it("blocks: preview does not echo another user's private artifact metadata", async () => {
    const res = await previewTemplate(e, B, { artifact_id: ART_A, inline_subject: '{{artifact.name}}', inline_html: '{{artifact.slug}}' });
    expect(res.rendered).toBeUndefined();
    expect(res.error).toBe('Artifact not found');
  });

  it('still previews an artifact I own', async () => {
    const res = await previewTemplate(e, B, { artifact_id: ART_B, inline_subject: '{{artifact.name}}', inline_html: 'x' });
    expect(res.rendered?.subject).toBe('B art');
  });
});
