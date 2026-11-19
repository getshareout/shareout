import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types, shared by the docs site and the local gate
import { atomFeed, headline, inlineHtml, parseReleaseNotes, withAnchors } from '../../../../docs-site/src/lib/release-notes.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const docs = join(repo, 'docs-site', 'src', 'content', 'docs');

type Entry = { en: string; es: string; guide: string; guia: string; tech: string; line: number };
type Day = { date: string; entries: Entry[] };

describe('CHANGELOG.md release notes (What\'s new / Novedades source)', () => {
  const { days, errors } = parseReleaseNotes(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')) as { days: Day[]; errors: string[] };

  it('parses with no format errors, newest date first', () => {
    expect(errors).toEqual([]);
    expect(days.length).toBeGreaterThan(0);
    const dates = days.map((d) => d.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('every entry has its Spanish line, and Spanish says "artefacto", never "artifact"', () => {
    for (const e of days.flatMap((d) => d.entries)) {
      expect(e.es, `line ${e.line}`).not.toBe('');
      expect(e.es, `line ${e.line}`).not.toMatch(/\bartifacts?\b/i);
    }
  });

  it('every guide link points at a docs page that exists', () => {
    for (const e of days.flatMap((d) => d.entries)) {
      for (const link of [e.guide, e.guia].filter(Boolean)) {
        const slug = link.split('#')[0].replace(/^\/|\/$/g, '');
        // "/" and "/es/" are the docs home (index.mdx).
        const found = [slug, slug ? `${slug}/index` : 'index'].some((f) => ['.md', '.mdx'].some((ext) => existsSync(join(docs, f + ext))));
        expect(found, `line ${e.line}: ${link}`).toBe(true);
      }
    }
  });
});

describe('parseReleaseNotes', () => {
  it('reports a missing Spanish line, a bad date heading and dates out of order', () => {
    const md = [
      '## Release notes',
      '### 2026-11-01',
      '- **Old.** Text.',
      '  - es: **Viejo.** Texto.',
      '### 2026-11-02',
      '- **Newer, below.** No Spanish.',
      '### Nov 3',
      '## [Unreleased]',
    ].join('\n');
    const { errors } = parseReleaseNotes(md) as { errors: string[] };
    expect(errors.join('\n')).toMatch(/newest first/);
    expect(errors.join('\n')).toMatch(/no "es:" line/);
    expect(errors.join('\n')).toMatch(/YYYY-MM-DD/);
  });

  it('joins continuation lines and stops at the next ## section', () => {
    const md = '## Release notes\n### 2026-11-18\n- **A.** one\n  two\n  - es: **A.** uno\n    dos\n  - Integrators: `x` (#12)\n## [Unreleased]\n- not a note\n';
    const { days, errors } = parseReleaseNotes(md) as { days: Day[]; errors: string[] };
    expect(errors).toEqual([]);
    expect(days).toHaveLength(1);
    expect(days[0].entries[0]).toMatchObject({ en: '**A.** one two', es: '**A.** uno dos', tech: '`x` (#12)' });
  });

  it('has no section → one error, no days', () => {
    expect(parseReleaseNotes('# Changelog\n')).toEqual({ days: [], errors: ['CHANGELOG.md has no "## Release notes" section'] });
  });
});

describe('inlineHtml', () => {
  it('escapes markup and renders code, bold, links and PR refs', () => {
    expect(inlineHtml('**Bold** <b>x</b> `a<b>` [d](/x/) (#316)')).toBe(
      '<strong>Bold</strong> &lt;b&gt;x&lt;/b&gt; <code>a&lt;b&gt;</code> <a href="/x/">d</a> (<a href="https://github.com/getshareout/shareout/pull/316">#316</a>)',
    );
  });
});

describe('What\'s new links and feed', () => {
  const md = [
    '## Release notes',
    '### 2026-11-19',
    '- **Keep a table up to date by email.** Email the file.',
    '  - es: **Mantené una tabla al día por email.** Mandá el archivo.',
    '  - Guide: /everyone/inbox/',
    '  - Guía: /es/everyone/inbox/',
    '  - Integrators: `email_sheet_sync` (#316)',
    '- **Keep a table up to date by email.** Same headline, same day.',
    '  - es: **Otra.** Texto.',
    '### 2026-11-18',
    '- **Árbol & <niño>: sí.** Accents and marks.',
    '  - es: **Árbol.** Texto.',
  ].join('\n');
  const { days } = parseReleaseNotes(md) as { days: Day[] };

  it('headline is the bold lead without the stars or the final period', () => {
    expect(headline('**Keep a table up to date by email.** Email the file.')).toBe('Keep a table up to date by email');
    expect(headline('No bold here. Second sentence.')).toBe('No bold here');
  });

  it('every entry gets a stable date + English-headline anchor, unique on its day', () => {
    const anchors = (withAnchors(days) as Array<Day & { entries: Array<Entry & { anchor: string }> }>).flatMap((d) => d.entries.map((e) => e.anchor));
    expect(anchors).toEqual([
      '2026-11-19-keep-a-table-up-to-date-by-email',
      '2026-11-19-keep-a-table-up-to-date-by-email-2',
      '2026-11-18-arbol-nino-si',
    ]);
  });

  it('the real changelog has unique anchors of a readable length', () => {
    const real = parseReleaseNotes(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')) as { days: Day[] };
    const anchors = (withAnchors(real.days) as Array<{ entries: Array<{ anchor: string }> }>).flatMap((d) => d.entries.map((e) => e.anchor));
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,72}$/);
  });

  it('builds an Atom feed per language that links each entry on its own page', () => {
    const opts = { site: 'https://docs.example.test', repo: 'https://github.com/acme/app' };
    const en = atomFeed(days, { ...opts, lang: 'en' }) as string;
    const es = atomFeed(days, { ...opts, lang: 'es' }) as string;
    expect(en).toMatch(/^<\?xml version="1.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www.w3.org\/2005\/Atom" xml:lang="en">/);
    expect(en.match(/<entry>/g)).toHaveLength(3);
    expect(en).toContain('<link rel="self" href="https://docs.example.test/whats-new.xml"/>');
    expect(en).toContain('<updated>2026-11-19T12:00:00Z</updated>');
    expect(en).toContain('<title>Keep a table up to date by email</title>');
    expect(en).toContain('<link rel="alternate" href="https://docs.example.test/whats-new/#2026-11-19-keep-a-table-up-to-date-by-email"/>');
    expect(es).toContain('<link rel="self" href="https://docs.example.test/es/whats-new.xml"/>');
    expect(es).toContain('<title>Mantené una tabla al día por email</title>');
    expect(es).toContain('https://docs.example.test/es/whats-new/#2026-11-19-keep-a-table-up-to-date-by-email');
    expect(es).toContain('href=&quot;https://docs.example.test/es/everyone/inbox/&quot;');
    // Markup in a headline is escaped, never raw XML.
    expect(en).toContain('<title>Árbol &amp; &lt;niño&gt;: sí</title>');
    expect(en).not.toContain('<niño>');
  });
});
