import { describe, expect, it } from 'vitest';
import { SlideHelpers } from '../../src/presentation/slide-helpers';

describe('SlideHelpers', () => {
  const slides = new SlideHelpers();

  it('escapes HTML in text blocks', () => {
    const html = slides.textBlock('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('applies inline styles to text blocks', () => {
    const html = slides.textBlock('Hello', { fontSize: '24px', color: 'red' });
    expect(html).toContain('font-size:24px');
    expect(html).toContain('color:red');
  });

  it('renders headings with level-specific sizes', () => {
    expect(slides.heading('Title', 1)).toContain('<h1');
    expect(slides.heading('Subtitle', 2)).toContain('font-size:48px');
    expect(slides.heading('Section', 3)).toContain('<h3');
  });

  it('renders bullet lists with escaped items', () => {
    const html = slides.bulletList(['One', 'Two & three']);
    expect(html).toContain('<ul');
    expect(html).toContain('<li>Two &amp; three</li>');
  });

  it('renders images with defaults and options', () => {
    expect(slides.image('photo.png')).toContain('width:100%');
    expect(slides.image('photo.png', { width: '50%', alt: 'Photo' })).toContain('alt="Photo"');
  });

  it('renders code blocks with escaped content', () => {
    const html = slides.codeBlock('const x = 1;', 'typescript');
    expect(html).toContain('language-typescript');
    expect(html).toContain('const x = 1;');
  });

  it('renders big numbers and quotes', () => {
    expect(slides.bigNumber('42', 'Answer')).toContain('42');
    expect(slides.quote('Hello', 'Author')).toContain('— Author');
    expect(slides.quote('Solo')).not.toContain('<cite');
  });

  it('wraps content in layout helpers', () => {
    expect(slides.twoColumn('<div>A</div>', '<div>B</div>')).toContain('grid-template-columns:1fr 1fr');
    expect(slides.centered('<span>Center</span>')).toContain('text-align:center');
  });

  it('renders tables with optional header row', () => {
    const html = slides.table([['Name', 'Value'], ['A', '1']], { header: true });
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('Name');
  });

  it('renders metrics with direction-colored delta', () => {
    const up = slides.metric('1.2M', 'Revenue', { value: '12%', dir: 'up' });
    expect(up).toContain('1.2M');
    expect(up).toContain('▲');
    expect(slides.metric('99%', 'Uptime', { value: '1%', dir: 'down' })).toContain('▼');
  });

  it('renders charts as inline SVG per type', () => {
    const data = [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 20 }];
    expect(slides.chart({ type: 'bar', data })).toContain('<rect');
    expect(slides.chart({ type: 'line', data })).toContain('<polyline');
    expect(slides.chart({ type: 'pie', data, title: 'Split' })).toContain('<path');
    expect(slides.chart({ type: 'pie', data, title: 'Split' })).toContain('Split');
  });

  it('escapes user text in components', () => {
    expect(slides.metric('<b>x</b>', 'l')).toContain('&lt;b&gt;');
    expect(slides.table([['<i>']], {})).toContain('&lt;i&gt;');
  });
});

describe('SlideHelpers themes', () => {
  it('applies named theme colors to layouts', () => {
    const dark = new SlideHelpers().withTheme('dark-professional');
    const pitch = new SlideHelpers().withTheme('pitch-deck');
    expect(dark.layout.title({ title: 'X' })).toContain('#0f172a');
    expect(pitch.layout.bigStat({ value: '1', label: 'n' })).toContain('#f97316');
  });

  it('merges a custom partial theme over defaults', () => {
    const custom = new SlideHelpers().withTheme({ colors: { accent: '#ff0000' } as never });
    expect(custom.layout.bigStat({ value: '42', label: 'n' })).toContain('#ff0000');
  });

  it('falls back to default for unknown theme', () => {
    const t = new SlideHelpers().withTheme('does-not-exist');
    expect(t.layout.title({ title: 'X' })).toContain('#0f172a');
  });
});

describe('SlideHelpers layouts', () => {
  const h = new SlideHelpers();

  it('renders each layout as a full positioned slide', () => {
    expect(h.layout.title({ title: 'T', subtitle: 'S', eyebrow: 'E' })).toContain('T');
    expect(h.layout.section({ number: 1, title: 'Intro' })).toContain('Intro');
    expect(h.layout.titleContent({ title: 'T', body: '<p>b</p>' })).toContain('<p>b</p>');
    expect(h.layout.twoCol({ left: 'L', right: 'R' })).toContain('grid-template-columns:1fr 1fr');
    expect(h.layout.cards({ cards: [{ title: 'a', body: 'b' }, { title: 'c', body: 'd' }] })).toContain('repeat(2,1fr)');
    expect(h.layout.quote({ text: 'q', author: 'me', role: 'CEO' })).toContain('me, CEO');
    expect(h.layout.bigStat({ value: '99%', label: 'up' })).toContain('99%');
  });
});

describe('SlideHelpers spec + deck + markdown', () => {
  const h = new SlideHelpers();

  it('resolves a spec by layout name', () => {
    expect(h.spec({ layout: 'title', title: 'Hi' })).toContain('Hi');
  });

  it('passes through raw html and strings', () => {
    expect(h.spec({ html: '<x/>' })).toBe('<x/>');
    expect(h.spec('<y/>')).toBe('<y/>');
  });

  it('throws on unknown layout', () => {
    expect(() => h.spec({ layout: 'nope' as never })).toThrow(/Unknown layout/);
  });

  it('resolves a deck of mixed specs', () => {
    const out = h.deck([{ layout: 'title', title: 'A' }, '<raw/>']);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('<raw/>');
  });

  it('parses markdown outline into specs', () => {
    const specs = h.fromMarkdown('# Title\n\n---\n\n## Agenda\n- one\n- two');
    expect(specs).toHaveLength(2);
    expect(h.spec(specs[0])).toContain('Title');
    expect(h.spec(specs[1])).toContain('<li>one</li>');
  });
});
