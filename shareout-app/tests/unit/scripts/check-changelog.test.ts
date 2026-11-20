import { describe, expect, it } from 'vitest';

// @ts-expect-error plain ESM tooling script without types
import { addedLineNumbers, branchProblems } from '../../../../tooling/scripts/check-changelog.mjs';

const CHANGELOG = [
  '# Changelog', //                         1
  '', //                                    2
  '## Release notes', //                    3
  '', //                                    4
  '### 2026-11-19', //                      5
  '- **New thing.** Plain words.', //       6
  '  - es: **Algo nuevo.** Palabras.', //   7
  '', //                                    8
  '## [Unreleased]', //                     9
  '', //                                   10
  '### Added', //                          11
  '', //                                   12
  '- **New thing:** `GET /v1/thing`.', //  13
  '', //                                   14
].join('\n');

const API = 'shareout-app/src/router/api/things.ts';
const COPY = 'shareout-app/src/pages/home/home-i18n/copy/things.ts';
const EN = 'docs-site/src/content/docs/teams/things.md';
const ES = 'docs-site/src/content/docs/es/teams/things.md';
const SKILL = 'skills/ShareOutSkill/team/things.md';
const complete = { changelog: CHANGELOG, added: [6, 7, 13] };

const kinds = (problems: string[]) =>
  problems.map((p) =>
    p.includes('not CHANGELOG.md') ? 'changelog'
    : p.includes('"## Release notes"') ? 'release-notes'
    : p.includes('"## [Unreleased]"') ? 'unreleased'
    : p.includes('no docs-site page') ? 'docs'
    : p.includes('not the skill') ? 'skill'
    : p.includes('one language only') ? 'en-es'
    : p,
  );

describe('check:changelog branch rules', () => {
  it('a user-visible API change with its words everywhere passes', () => {
    expect(branchProblems({ changed: [API, 'CHANGELOG.md', EN, ES, SKILL], ...complete })).toEqual([]);
  });

  it('asks for every missing piece, by name', () => {
    expect(kinds(branchProblems({ changed: [API] }))).toEqual(['changelog', 'docs', 'skill']);
  });

  it('a CHANGELOG change needs both the Release notes line and the Unreleased entry', () => {
    const base = { changed: [API, 'CHANGELOG.md', EN, ES, SKILL], changelog: CHANGELOG };
    expect(kinds(branchProblems({ ...base, added: [6, 7] }))).toEqual(['unreleased']);
    expect(kinds(branchProblems({ ...base, added: [13] }))).toEqual(['release-notes']);
    // blank lines alone do not count
    expect(kinds(branchProblems({ ...base, added: [4, 12] }))).toEqual(['release-notes', 'unreleased']);
  });

  it('UI copy needs the changelog and docs but not the skill', () => {
    expect(kinds(branchProblems({ changed: [COPY, 'CHANGELOG.md'], ...complete }))).toEqual(['docs']);
    expect(branchProblems({ changed: [COPY, 'CHANGELOG.md', EN, ES], ...complete })).toEqual([]);
  });

  it('assistant tools count as an agent surface', () => {
    const tool = 'shareout-app/src/chat-agent/tools/things.ts';
    expect(kinds(branchProblems({ changed: [tool, 'CHANGELOG.md', EN, ES], ...complete }))).toEqual(['skill']);
  });

  it('a docs page changed in one language only fails, either way', () => {
    expect(kinds(branchProblems({ changed: [EN] }))).toEqual(['en-es']);
    expect(kinds(branchProblems({ changed: [ES] }))).toEqual(['en-es']);
    expect(branchProblems({ changed: [EN, ES] })).toEqual([]);
    // assets next to the pages are not pages
    expect(branchProblems({ changed: ['docs-site/src/content/docs/teams/things.png'] })).toEqual([]);
  });

  it('opt-outs in a commit message: Docs: none, Skill: none, Changelog: none', () => {
    const changed = [API, 'CHANGELOG.md'];
    expect(kinds(branchProblems({ changed, ...complete, messages: 'feat: x\n\nDocs: none\nSkill: none' }))).toEqual([]);
    expect(kinds(branchProblems({ changed, ...complete, messages: 'feat: x\n\nSkill: none' }))).toEqual(['docs']);
    expect(branchProblems({ changed: [API], messages: 'refactor: y\n\nChangelog: none' })).toEqual([]);
    // Changelog: none never skips the en/es rule
    expect(kinds(branchProblems({ changed: [API, EN], messages: 'Changelog: none' }))).toEqual(['en-es']);
  });

  it('tests, tooling and internals are not user-visible', () => {
    expect(
      branchProblems({
        changed: ['shareout-app/tests/unit/router/api/things.test.ts', 'tooling/scripts/x.mjs', 'shareout-app/src/messages/store.ts'],
      }),
    ).toEqual([]);
  });
});

describe('addedLineNumbers', () => {
  it('reads the new-file lines of each -U0 hunk', () => {
    const diff = [
      'diff --git a/CHANGELOG.md b/CHANGELOG.md',
      '@@ -5,0 +6,2 @@ ## Release notes',
      '+- **New thing.** Plain words.',
      '+  - es: **Algo nuevo.** Palabras.',
      '@@ -12 +14 @@ ### Added',
      '-old',
      '+new',
      '@@ -20,3 +22,0 @@',
    ].join('\n');
    expect(addedLineNumbers(diff)).toEqual([6, 7, 14]);
  });
});
