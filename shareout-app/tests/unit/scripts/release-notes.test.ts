import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module without types, shared by the docs site and the local gate
import { inlineHtml, parseReleaseNotes } from '../../../../docs-site/src/lib/release-notes.mjs';

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
        const found = ['.md', '.mdx'].some((ext) => existsSync(join(docs, slug + ext)));
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
