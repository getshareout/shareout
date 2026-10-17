import { describe, expect, it } from 'vitest';
import { dropLinks, resolveTokens, tokenizeLinks } from '../../../src/templates/links';
import { maskEmail, redactSecrets, scanText } from '../../../src/templates/scan';

const items = [
  { key: 'a1', id: 'art_aaaaaaaaaaaaaaaaaaaaaaaa', slug: 'hub-x1', displaySlug: 'hub' },
  { key: 'a2', id: 'art_bbbbbbbbbbbbbbbbbbbbbbbb', slug: 'detail', displaySlug: 'detail' },
];
const ctx = { items, workspaceId: 'wsp_src', workspaceSlug: 'acme', hosts: ['shareout.test'] };

describe('tokenizeLinks / resolveTokens', () => {
  it('turns every link form to a template item into a token and back to the new slug', () => {
    const src = [
      '<a href="/a/detail/?page=x.html">', '<a href="https://shareout.test/a/hub-x1/">',
      '<a href="/@acme/folder/detail/">', '<a href="https://acme.shareout.test/folder/hub/">',
      '<a href="https://github.com/a/detail/">', 'id=art_bbbbbbbbbbbbbbbbbbbbbbbb ws=wsp_src',
    ].join('\n');
    const t = tokenizeLinks(src, ctx);
    expect(t.text).not.toMatch(/\/a\/detail\/\?|hub-x1|@acme|acme\.shareout/);
    expect(t.text).toContain('https://github.com/a/detail/');
    expect(t.needsIds).toBe(true);
    const out = resolveTokens(t.text, { a1: { slug: 'hub-2', id: 'art_new1' }, a2: { slug: 'detail-2', id: 'art_new2' } }, 'https://x.test', 'wsp_dst');
    expect(out).toContain('href="/a/detail-2/?page=x.html"');
    expect(out).toContain('href="https://x.test/a/hub-2/"');
    expect(out).toContain('href="/a/detail-2/"');
    expect(out).toContain('id=art_new2 ws=wsp_dst');
  });

  it('reports unknown slugs and drops local ones', () => {
    const t = tokenizeLinks('<a href="/a/other/">x</a> <a href="/@acme/gone/">y</a>', ctx);
    expect(t.unknownSlugs).toEqual(['other']);
    expect(t.removedLinks).toBe(1);
    expect(dropLinks(t.text, ['other'], ['shareout.test']).text).toBe('<a href="#">x</a> <a href="#">y</a>');
  });
});

describe('scan', () => {
  it('redacts credentials', () => {
    const r = redactSecrets('k="so_abcdefghijklmnop12345" h="Bearer abcdefghijklmnopqrstuvwxyz"');
    expect(r.count).toBe(2);
    expect(r.text).toBe('k="[REDACTED]" h="Bearer [REDACTED]"');
  });

  it('flags emails, phones, the workspace name and members, masked', () => {
    const f = scanText('Call +54 11 4567 8901 or mail ana.perez@cliente.com — Acme Corp, ask Ana Perez. a@example.com', {
      workspaceNames: ['Acme Corp'], memberNames: ['Ana Perez'], memberEmails: [],
    }, 'a1', 'index.html');
    const kinds = f.map((x) => x.kind).sort();
    expect(kinds).toEqual(['email', 'member', 'phone', 'workspace_name']);
    expect(f.find((x) => x.kind === 'email')!.sample).toBe(maskEmail('ana.perez@cliente.com'));
    expect(JSON.stringify(f)).not.toContain('ana.perez@');
  });
});
