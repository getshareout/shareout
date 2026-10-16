import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { pageLinksIn, telegramPlainText } from '../../../src/chat-platforms/telegram/format';
import { htmlSections, chunkSections } from '../../../src/knowledge/corpus/sections';
import { artifactLink } from '../../../src/artifacts/page-links';
import { loginPage } from '../../../src/auth/pages';

const env = { SHAREOUT_BASE_URL: 'https://shareout.test' } as Env;

describe('Telegram reply text', () => {
  it('flattens Markdown links and bold so Telegram auto-links the bare URL', () => {
    expect(telegramPlainText('See [Waste management](https://shareout.test/a/p/?page=w.html) and **3.2**'))
      .toBe('See Waste management: https://shareout.test/a/p/?page=w.html and 3.2');
    expect(telegramPlainText('<https://shareout.test/a/p/>')).toBe('https://shareout.test/a/p/');
    expect(telegramPlainText('[https://x.test/](https://x.test/)')).toBe('https://x.test/');
  });

  it('finds this instance\'s page links with a label, ignoring other sites', () => {
    const links = pageLinksIn(env, '1. Waste management — https://shareout.test/a/p/?page=w.html&section=s3.\nDocs: https://example.com/a/x/');
    expect(links).toEqual([{ label: 'Waste management', url: 'https://shareout.test/a/p/?page=w.html&section=s3' }]);
  });
});

describe('artifact links', () => {
  it('are absolute, encode the sub-page and drop unsafe parts', () => {
    expect(artifactLink(env, 'p', { page: 'procedures/waste.html', section: 'sec-3' })).toBe('https://shareout.test/a/p/?page=procedures/waste.html&section=sec-3');
    expect(artifactLink(env, 'p', { page: 'index.html', entrypoint: 'index.html' })).toBe('https://shareout.test/a/p/');
    expect(artifactLink(env, 'p', { page: '../x.html', section: '"><script>' })).toBe('https://shareout.test/a/p/');
  });
});

describe('htmlSections', () => {
  it('splits by heading, keeps numbered headings and their ids', () => {
    const p = htmlSections('<title>Waste</title><body><h1>Waste</h1><p>Intro.</p><section id="s3"><h2>3. Classification</h2><p>3.1 Classify it.</p></section></body>');
    expect(p.title).toBe('Waste');
    expect(p.sections.map((s) => [s.heading, s.anchor])).toEqual([['Waste', 'h-waste'], ['3. Classification', 's3']]);
    const chunks = chunkSections(p, { startOrd: 0, page: 'w.html', max: 10 });
    expect(chunks[1]).toMatchObject({ locator: 'Waste › 3. Classification', page: 'w.html', anchor: 's3' });
    expect(chunks[1].text).toContain('3. Classification');
  });
});

describe('sign-in gate', () => {
  it('returns to the exact gated URL (sub-page deep link), never off-site', async () => {
    const html = await loginPage('p', undefined, undefined, undefined, undefined, false, '/a/p/?page=w.html&section=s3').text();
    expect(html).toContain('"/a/p/?page=w.html&section=s3"');
    const off = await loginPage('p', undefined, undefined, undefined, undefined, false, '//evil.example.com/').text();
    expect(off).not.toContain('evil.example.com');
  });
});
