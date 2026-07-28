export interface SlideThemeColors {
  background: string;
  text: string;
  secondaryText: string;
  accent: string;
  surface: string;
  border: string;
  codeBackground: string;
}

export interface SlideThemeFonts {
  heading: string;
  body: string;
  mono: string;
}

export interface SlideTheme {
  colors: SlideThemeColors;
  fonts: SlideThemeFonts;
  radius: string;
  pad: string;
}

const THEMES: Record<string, SlideTheme> = {
  'dark-professional': {
    colors: {
      background: '#0f172a',
      text: '#f8fafc',
      secondaryText: '#94a3b8',
      accent: '#3b82f6',
      surface: '#1e293b',
      border: '#334155',
      codeBackground: '#1e293b',
    },
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '12px',
    pad: '64px',
  },
  'light-minimal': {
    colors: {
      background: '#ffffff',
      text: '#0f172a',
      secondaryText: '#64748b',
      accent: '#2563eb',
      surface: '#f1f5f9',
      border: '#e2e8f0',
      codeBackground: '#0f172a',
    },
    fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '12px',
    pad: '64px',
  },
  'pitch-deck': {
    colors: {
      background: '#0c0a09',
      text: '#fafaf9',
      secondaryText: '#a8a29e',
      accent: '#f97316',
      surface: '#1c1917',
      border: '#292524',
      codeBackground: '#1c1917',
    },
    fonts: { heading: 'Space Grotesk', body: 'Inter', mono: 'JetBrains Mono' },
    radius: '16px',
    pad: '72px',
  },
};

const DEFAULT_THEME = THEMES['dark-professional'];

export type SlideThemeInput = keyof typeof THEMES | string | Partial<SlideTheme>;

function resolveTheme(input?: SlideThemeInput): SlideTheme {
  if (!input) return DEFAULT_THEME;
  if (typeof input === 'string') return THEMES[input] || DEFAULT_THEME;
  return {
    colors: { ...DEFAULT_THEME.colors, ...input.colors },
    fonts: { ...DEFAULT_THEME.fonts, ...input.fonts },
    radius: input.radius || DEFAULT_THEME.radius,
    pad: input.pad || DEFAULT_THEME.pad,
  };
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  data: ChartPoint[];
  title?: string;
}

export type SlideSpec =
  | { html: string; notes?: string; hidden?: boolean }
  | ({ layout: keyof LayoutHelpers; notes?: string; hidden?: boolean } & Record<string, unknown>);

export class SlideHelpers {
  readonly theme: SlideTheme;
  readonly layout: LayoutHelpers;

  constructor(theme?: SlideTheme) {
    this.theme = theme || DEFAULT_THEME;
    this.layout = new LayoutHelpers(this.theme, this);
  }

  withTheme(input: SlideThemeInput): SlideHelpers {
    return new SlideHelpers(resolveTheme(input));
  }

  textBlock(content: string, style?: Partial<CSSStyleDeclaration>): string {
    const styleStr = style ? Object.entries(style).map(([k, v]) => `${this.camelToKebab(k)}:${v}`).join(';') : '';
    return `<div style="${styleStr}">${this.escapeHtml(content)}</div>`;
  }

  heading(text: string, level: 1 | 2 | 3 = 1): string {
    const sizes = { 1: '64px', 2: '48px', 3: '36px' };
    return `<h${level} style="font-size:${sizes[level]};font-weight:700;margin-bottom:24px">${this.escapeHtml(text)}</h${level}>`;
  }

  bulletList(items: string[]): string {
    return `<ul style="font-size:24px;line-height:1.8;list-style:disc;padding-left:32px">${items.map(i => `<li>${this.escapeHtml(i)}</li>`).join('')}</ul>`;
  }

  image(src: string, options?: { width?: string; height?: string; alt?: string }): string {
    const width = options?.width || '100%';
    const alt = options?.alt || '';
    return `<img src="${src}" alt="${alt}" style="width:${width};border-radius:12px;box-shadow:0 25px 50px rgba(0,0,0,0.3)">`;
  }

  codeBlock(code: string, language?: string): string {
    return `<pre style="background:#1e293b;padding:24px;border-radius:8px;overflow-x:auto"><code class="language-${language || 'plaintext'}">${this.escapeHtml(code)}</code></pre>`;
  }

  bigNumber(value: string, label: string): string {
    return `<div style="text-align:center"><span style="font-size:144px;font-weight:700;color:var(--accent);line-height:1">${this.escapeHtml(value)}</span><p style="font-size:24px;color:var(--text-secondary);margin-top:24px">${this.escapeHtml(label)}</p></div>`;
  }

  quote(text: string, author?: string): string {
    let html = `<blockquote style="font-size:36px;font-style:italic;line-height:1.6;max-width:800px;margin:0 auto">"${this.escapeHtml(text)}"</blockquote>`;
    if (author) {
      html += `<cite style="display:block;font-size:18px;color:var(--text-secondary);margin-top:32px;text-align:center">— ${this.escapeHtml(author)}</cite>`;
    }
    return html;
  }

  twoColumn(left: string, right: string): string {
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;height:100%;align-items:center">${left}${right}</div>`;
  }

  centered(content: string): string {
    return `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;text-align:center">${content}</div>`;
  }

  table(rows: string[][], opts?: { header?: boolean }): string {
    const t = this.theme;
    const renderRow = (cells: string[], head: boolean) =>
      `<tr>${cells
        .map(
          (c) =>
            `<${head ? 'th' : 'td'} style="padding:14px 20px;text-align:left;border-bottom:1px solid ${t.colors.border};${head ? `font-weight:600;color:${t.colors.text}` : `color:${t.colors.secondaryText}`}">${this.escapeHtml(c)}</${head ? 'th' : 'td'}>`
        )
        .join('')}</tr>`;
    const [first, ...rest] = rows;
    const body = opts?.header
      ? renderRow(first || [], true) + rest.map((r) => renderRow(r, false)).join('')
      : rows.map((r) => renderRow(r, false)).join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:22px;font-family:${t.fonts.body}">${body}</table>`;
  }

  metric(value: string, label: string, delta?: { value: string; dir: 'up' | 'down' }): string {
    const t = this.theme;
    const deltaHtml = delta
      ? `<span style="font-size:20px;font-weight:600;color:${delta.dir === 'up' ? '#22c55e' : '#ef4444'};margin-left:12px">${delta.dir === 'up' ? '▲' : '▼'} ${this.escapeHtml(delta.value)}</span>`
      : '';
    return `<div><div style="font-size:64px;font-weight:700;color:${t.colors.text};line-height:1.1">${this.escapeHtml(value)}${deltaHtml}</div><div style="font-size:20px;color:${t.colors.secondaryText};margin-top:8px">${this.escapeHtml(label)}</div></div>`;
  }

  embed(url: string, opts?: { aspect?: string }): string {
    const aspect = opts?.aspect || '16 / 9';
    return `<div style="aspect-ratio:${aspect};width:100%;border-radius:${this.theme.radius};overflow:hidden"><iframe src="${url}" style="width:100%;height:100%;border:none" allowfullscreen></iframe></div>`;
  }

  video(src: string, opts?: { poster?: string; autoplay?: boolean; loop?: boolean }): string {
    const attrs = [
      'controls',
      'playsinline',
      `style="width:100%;border-radius:${this.theme.radius}"`,
      opts?.poster ? `poster="${opts.poster}"` : '',
      opts?.autoplay ? 'autoplay muted' : '',
      opts?.loop ? 'loop' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<video ${attrs}><source src="${src}"></video>`;
  }

  chart(spec: ChartSpec): string {
    const t = this.theme;
    const title = spec.title
      ? `<div style="font-size:24px;font-weight:600;color:${t.colors.text};margin-bottom:24px">${this.escapeHtml(spec.title)}</div>`
      : '';
    return `<div style="font-family:${t.fonts.body}">${title}${this.renderChartSvg(spec)}</div>`;
  }

  private renderChartSvg(spec: ChartSpec): string {
    const t = this.theme;
    const W = 800;
    const H = 360;
    const data = spec.data.length ? spec.data : [{ label: '', value: 0 }];
    const max = Math.max(...data.map((d) => d.value), 1);

    if (spec.type === 'pie') {
      const total = data.reduce((s, d) => s + d.value, 0) || 1;
      const cx = 180;
      const cy = H / 2;
      const r = 140;
      let angle = -Math.PI / 2;
      const palette = this.palette(data.length);
      const slices = data
        .map((d, i) => {
          const frac = d.value / total;
          const next = angle + frac * Math.PI * 2;
          const large = frac > 0.5 ? 1 : 0;
          const x1 = cx + r * Math.cos(angle);
          const y1 = cy + r * Math.sin(angle);
          const x2 = cx + r * Math.cos(next);
          const y2 = cy + r * Math.sin(next);
          angle = next;
          return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${palette[i]}"/>`;
        })
        .join('');
      const legend = data
        .map(
          (d, i) =>
            `<div style="display:flex;align-items:center;gap:8px;font-size:18px;color:${t.colors.secondaryText}"><span style="width:14px;height:14px;border-radius:3px;background:${palette[i]}"></span>${this.escapeHtml(d.label)}</div>`
        )
        .join('');
      return `<div style="display:flex;align-items:center;gap:32px"><svg viewBox="0 0 ${cx * 2} ${H}" style="width:55%;max-width:400px">${slices}</svg><div style="display:flex;flex-direction:column;gap:10px">${legend}</div></div>`;
    }

    const pad = 40;
    const chartW = W - pad * 2;
    const chartH = H - pad * 2;
    const baseY = H - pad;

    if (spec.type === 'line') {
      const step = data.length > 1 ? chartW / (data.length - 1) : 0;
      const points = data.map((d, i) => `${pad + i * step},${(baseY - (d.value / max) * chartH).toFixed(1)}`);
      const labels = data
        .map((d, i) => `<text x="${pad + i * step}" y="${H - 8}" fill="${t.colors.secondaryText}" font-size="14" text-anchor="middle">${this.escapeHtml(d.label)}</text>`)
        .join('');
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%"><polyline points="${points.join(' ')}" fill="none" stroke="${t.colors.accent}" stroke-width="3"/>${points
        .map((p) => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="4" fill="${t.colors.accent}"/>`; })
        .join('')}${labels}</svg>`;
    }

    // bar
    const gap = 16;
    const barW = (chartW - gap * (data.length - 1)) / data.length;
    const bars = data
      .map((d, i) => {
        const h = (d.value / max) * chartH;
        const x = pad + i * (barW + gap);
        const y = baseY - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="6" fill="${t.colors.accent}"/><text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" fill="${t.colors.secondaryText}" font-size="14" text-anchor="middle">${this.escapeHtml(d.label)}</text>`;
      })
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${bars}</svg>`;
  }

  private palette(n: number): string[] {
    const base = [this.theme.colors.accent, '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#eab308', '#ec4899'];
    return Array.from({ length: n }, (_, i) => base[i % base.length]);
  }

  /** Resolve a SlideSpec (or raw html) to a slide HTML string. */
  spec(s: SlideSpec | string): string {
    if (typeof s === 'string') return s;
    if ('layout' in s) {
      const { layout, notes, hidden, ...slots } = s;
      const fn = this.layout[layout] as ((opts: Record<string, unknown>) => string) | undefined;
      if (typeof fn !== 'function') throw new Error(`Unknown layout: ${String(layout)}`);
      return fn.call(this.layout, slots);
    }
    return s.html;
  }

  /** Resolve many specs to HTML strings. */
  deck(specs: (SlideSpec | string)[]): string[] {
    return specs.map((s) => this.spec(s));
  }

  /** Parse a markdown outline into slide specs. `---` separates slides; `#`/`##` become titles. */
  fromMarkdown(md: string): SlideSpec[] {
    return md
      .split(/^---$/m)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const lines = block.split('\n');
        const titleLine = lines.find((l) => /^#{1,2}\s/.test(l));
        const title = titleLine ? titleLine.replace(/^#{1,2}\s+/, '').trim() : '';
        const bullets = lines.filter((l) => /^[-*]\s/.test(l)).map((l) => l.replace(/^[-*]\s+/, '').trim());
        const body = lines
          .filter((l) => l.trim() && l !== titleLine && !/^[-*]\s/.test(l))
          .join(' ')
          .trim();
        if (bullets.length) {
          return { layout: 'titleContent', title, body: this.bulletList(bullets) } as SlideSpec;
        }
        if (!body) {
          return { layout: 'title', title } as SlideSpec;
        }
        return { layout: 'titleContent', title, body: `<p style="font-size:24px;line-height:1.7">${this.escapeHtml(body)}</p>` } as SlideSpec;
      });
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private camelToKebab(str: string): string {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase();
  }
}

/** Full-slide layout helpers. Each returns a complete, positioned slide body. */
export class LayoutHelpers {
  constructor(private theme: SlideTheme, private h: SlideHelpers) {}

  private esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private frame(inner: string, opts?: { center?: boolean; pad?: string }): string {
    const t = this.theme;
    const justify = opts?.center ? 'center' : 'flex-start';
    const align = opts?.center ? 'center' : 'stretch';
    const textAlign = opts?.center ? 'center' : 'left';
    return `<div style="box-sizing:border-box;width:100%;height:100%;padding:${opts?.pad || t.pad};background:${t.colors.background};color:${t.colors.text};font-family:${t.fonts.body};display:flex;flex-direction:column;justify-content:${justify};align-items:${align};text-align:${textAlign};gap:24px">${inner}</div>`;
  }

  private titleEl(text: string, size = '56px'): string {
    return `<h1 style="font-size:${size};font-weight:700;font-family:${this.theme.fonts.heading};line-height:1.1;margin:0">${this.esc(text)}</h1>`;
  }

  private eyebrowEl(text: string): string {
    return `<div style="font-size:18px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${this.theme.colors.accent}">${this.esc(text)}</div>`;
  }

  title(opts: { title: string; subtitle?: string; eyebrow?: string }): string {
    const parts = [
      opts.eyebrow ? this.eyebrowEl(opts.eyebrow) : '',
      this.titleEl(opts.title, '72px'),
      opts.subtitle ? `<p style="font-size:28px;color:${this.theme.colors.secondaryText};margin:0">${this.esc(opts.subtitle)}</p>` : '',
    ].join('');
    return this.frame(parts, { center: true });
  }

  section(opts: { number?: string | number; title: string; subtitle?: string }): string {
    const num = opts.number != null ? `<div style="font-size:120px;font-weight:800;color:${this.theme.colors.accent};line-height:1;opacity:0.9">${this.esc(String(opts.number))}</div>` : '';
    const sub = opts.subtitle ? `<p style="font-size:24px;color:${this.theme.colors.secondaryText};margin:0">${this.esc(opts.subtitle)}</p>` : '';
    return this.frame(`${num}${this.titleEl(opts.title, '56px')}${sub}`, { center: true });
  }

  titleContent(opts: { title: string; body: string }): string {
    return this.frame(`${this.titleEl(opts.title, '48px')}<div style="font-size:24px;line-height:1.7;flex:1">${opts.body}</div>`);
  }

  twoCol(opts: { title?: string; left: string; right: string }): string {
    const head = opts.title ? this.titleEl(opts.title, '44px') : '';
    return this.frame(`${head}<div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;flex:1;align-items:center">${opts.left}${opts.right}</div>`);
  }

  imageText(opts: { image: string; title: string; body: string; side?: 'left' | 'right' }): string {
    const img = `<img src="${opts.image}" style="width:100%;border-radius:${this.theme.radius};object-fit:cover">`;
    const text = `<div>${this.titleEl(opts.title, '44px')}<div style="font-size:23px;line-height:1.7;color:${this.theme.colors.secondaryText};margin-top:16px">${opts.body}</div></div>`;
    const cols = opts.side === 'right' ? `${text}${img}` : `${img}${text}`;
    return this.frame(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:56px;flex:1;align-items:center">${cols}</div>`);
  }

  fullImage(opts: { src: string; caption?: string }): string {
    const cap = opts.caption ? `<div style="position:absolute;bottom:0;left:0;right:0;padding:24px 32px;background:linear-gradient(transparent,rgba(0,0,0,0.7));font-size:20px">${this.esc(opts.caption)}</div>` : '';
    return `<div style="position:relative;width:100%;height:100%;background:${this.theme.colors.background}"><img src="${opts.src}" style="width:100%;height:100%;object-fit:cover">${cap}</div>`;
  }

  bigStat(opts: { value: string; label: string; context?: string }): string {
    const ctx = opts.context ? `<p style="font-size:22px;color:${this.theme.colors.secondaryText};max-width:600px;margin:16px 0 0">${this.esc(opts.context)}</p>` : '';
    return this.frame(`<div style="font-size:160px;font-weight:800;color:${this.theme.colors.accent};line-height:1">${this.esc(opts.value)}</div><div style="font-size:28px;font-weight:600">${this.esc(opts.label)}</div>${ctx}`, { center: true });
  }

  quote(opts: { text: string; author?: string; role?: string }): string {
    const who = opts.author
      ? `<cite style="display:block;font-size:20px;font-style:normal;color:${this.theme.colors.secondaryText};margin-top:32px">— ${this.esc(opts.author)}${opts.role ? `, ${this.esc(opts.role)}` : ''}</cite>`
      : '';
    return this.frame(`<blockquote style="font-size:40px;font-weight:500;font-style:italic;line-height:1.5;max-width:900px;margin:0">"${this.esc(opts.text)}"</blockquote>${who}`, { center: true });
  }

  cards(opts: { title?: string; cards: { icon?: string; title: string; body: string }[] }): string {
    const head = opts.title ? this.titleEl(opts.title, '44px') : '';
    const cols = Math.min(opts.cards.length || 1, 4);
    const items = opts.cards
      .map(
        (c) =>
          `<div style="background:${this.theme.colors.surface};border:1px solid ${this.theme.colors.border};border-radius:${this.theme.radius};padding:32px">${c.icon ? `<div style="font-size:40px;margin-bottom:16px">${c.icon}</div>` : ''}<div style="font-size:24px;font-weight:600;margin-bottom:12px">${this.esc(c.title)}</div><div style="font-size:19px;line-height:1.6;color:${this.theme.colors.secondaryText}">${this.esc(c.body)}</div></div>`
      )
      .join('');
    return this.frame(`${head}<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:24px;flex:1;align-items:stretch">${items}</div>`);
  }

  chart(opts: { title?: string; chart: ChartSpec; insight?: string }): string {
    const insight = opts.insight ? `<p style="font-size:22px;color:${this.theme.colors.secondaryText};margin:24px 0 0">${this.esc(opts.insight)}</p>` : '';
    const head = opts.title ? this.titleEl(opts.title, '44px') : '';
    return this.frame(`${head}<div style="flex:1;display:flex;flex-direction:column;justify-content:center">${this.h.chart(opts.chart)}${insight}</div>`);
  }

  blank(opts: { html: string } | string): string {
    return typeof opts === 'string' ? opts : opts.html;
  }
}
