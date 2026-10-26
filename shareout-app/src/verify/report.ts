// Raw render signals + source findings → the issues an agent acts on, a status, and
// the short text summary the MCP tool returns. Pure: no I/O, so it is unit-tested
// with hand-written signals.
import type {
  CheckKind, DesignReport, PageSignals, ScreenshotInfo, Severity, VerifyIssue, VerifyResult, Viewport, ViewportReport,
} from './types';
import { VIEWPORTS } from './types';

export const VIEWPORT_LABEL: Record<Viewport, string> = { desktop: 'desktop', mobile: 'phone' };

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const CHECK_RANK: Record<CheckKind, number> = {
  render: 0, console: 1, network: 2, layout: 3, a11y: 4, source: 5, performance: 6, design: 7,
};
const MAX_ISSUES = 60;
const MAX_SUMMARY_LINES = 40;

const STORAGE_HINT = 'Viewers open the page in a sandbox where localStorage, sessionStorage, cookies and IndexedDB throw SecurityError. Keep state in memory, or persist it with the SDK (sdk.json / sdk.table).';

const kb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const firstLine = (s: string, max = 220) => String(s).split('\n')[0].trim().slice(0, max);

class Issues {
  private byKey = new Map<string, VerifyIssue>();

  add(issue: VerifyIssue, viewport?: Viewport): void {
    const key = `${issue.check}|${issue.rule}|${issue.message}|${issue.where ?? ''}`;
    const prev = this.byKey.get(key);
    if (!prev) {
      this.byKey.set(key, { ...issue, ...(viewport ? { viewports: [viewport] } : {}) });
      return;
    }
    if (viewport && !prev.viewports?.includes(viewport)) prev.viewports = [...(prev.viewports ?? []), viewport];
    if (issue.count && issue.count > (prev.count ?? 1)) prev.count = issue.count;
  }

  list(): VerifyIssue[] {
    return [...this.byKey.values()]
      .map((i, n) => ({ i, n }))
      .sort((a, b) => SEVERITY_RANK[a.i.severity] - SEVERITY_RANK[b.i.severity]
        || CHECK_RANK[a.i.check] - CHECK_RANK[b.i.check]
        || a.n - b.n)
      .map(({ i }) => i);
  }
}

// Reads the SDK turns into an empty value (json.get → null): normal on a first visit.
const SDK_EMPTY_READS = new Set(['KEY_NOT_FOUND', 'ROW_NOT_FOUND']);
// The render is read-only, so a write the page makes on load is refused by design.
const READ_ONLY_REFUSAL = /read-only test run/i;

function requestIssue(r: PageSignals['requests'][number]): VerifyIssue {
  const outcome = r.status ? `${r.status}` : r.failure ?? 'failed';
  const api = r.url.startsWith('/v1/');
  const resource = ['document', 'script', 'stylesheet', 'font', 'image'].includes(r.type);
  const outsidePage = r.url.startsWith('/') && !api;
  const message = `${r.method} ${r.url} → ${outcome}${r.code ? ` ${r.code}` : ''}`;
  if (api && r.method === 'GET' && r.status === 404 && r.code && SDK_EMPTY_READS.has(r.code)) {
    return {
      check: 'network',
      rule: 'api_empty_read',
      severity: 'info',
      message: `${message} — the SDK reads this as empty; declare a default in the manifest if the page needs one`,
      count: r.count,
    };
  }
  let hint: string | undefined;
  if (r.hint) hint = r.hint;
  else if (outsidePage) hint = 'This path resolves outside the page\'s own folder — reference the file with a relative path ("styles.css", not "/styles.css").';
  else if (api) hint = 'A ShareOut API call failed while the page loaded; use the SDK and check the store / connection name.';
  else if (r.status === 404) hint = 'Check the file path (relative to the page) and that the file was included in the publish.';
  return {
    check: 'network',
    rule: api ? 'api_error' : 'request_failed',
    severity: api || resource ? 'error' : 'warning',
    message,
    hint,
    count: r.count,
  };
}

function addPageSignals(out: Issues, s: PageSignals, ctx: { isPublic: boolean; lockCsp: boolean }): void {
  const vp = s.viewport;
  if (s.renderError) {
    out.add({ check: 'render', rule: 'render_failed', severity: 'error', message: s.renderError }, vp);
    return;
  }

  const storageErrors = new Set<string>();
  let refusalsSeenByPage = 0;
  for (const e of s.pageErrors) {
    if (READ_ONLY_REFUSAL.test(e.message)) {
      refusalsSeenByPage += e.count;
      continue;
    }
    const security = /SecurityError|allow-same-origin|access to the Indexed Database API is denied/.test(e.message);
    if (security) {
      for (const k of ['localStorage', 'sessionStorage', 'cookie', 'ServiceWorker']) if (e.message.includes(k)) storageErrors.add(k);
      if (/IDBFactory|Indexed Database/.test(e.message)) storageErrors.add('indexedDB');
    }
    // Chrome prints a sandbox denial as "DOMException: …"; its name is SecurityError.
    const text = security ? firstLine(e.message).replace(/^((?:\(in promise\) )?)DOMException: /, '$1SecurityError: ') : firstLine(e.message);
    out.add({
      check: 'console',
      rule: security ? 'storage_blocked' : 'js_error',
      severity: 'error',
      message: `Uncaught ${text}`,
      where: e.where,
      hint: security ? STORAGE_HINT : 'An uncaught exception stops the rest of that script — fix it at the line shown, and wrap async work in try/catch.',
      count: e.count,
    }, vp);
  }
  for (const kind of s.storage) {
    const label = kind === 'serviceWorker' ? 'ServiceWorker' : kind;
    if (storageErrors.has(label)) continue;
    out.add({
      check: 'console',
      rule: 'storage_blocked',
      severity: 'warning',
      message: `Uses ${label}, which throws SecurityError for viewers (the page caught it, so nothing it stores persists)`,
      hint: STORAGE_HINT,
    }, vp);
  }
  for (const c of s.console) {
    if (READ_ONLY_REFUSAL.test(c.text)) {
      refusalsSeenByPage += c.count;
      continue;
    }
    out.add({
      check: 'console',
      rule: c.level === 'error' ? 'console_error' : 'console_warning',
      severity: c.level === 'error' ? 'warning' : 'info',
      message: `console.${c.level === 'error' ? 'error' : 'warn'}: ${firstLine(c.text)}`,
      where: c.where,
      count: c.count,
    }, vp);
  }
  for (const d of s.dialogs) {
    out.add({
      check: 'console',
      rule: 'native_dialog',
      severity: 'warning',
      message: `${d.type}("${firstLine(d.message, 80)}") blocked the page while loading`,
      hint: 'Native dialogs block the page and break screenshots and scheduled renders. Show an inline message instead.',
      count: d.count,
    }, vp);
  }
  if (s.popups) {
    out.add({ check: 'console', rule: 'popup', severity: 'info', message: `Tried to open ${s.popups} popup window(s) while loading — browsers block popups that no click started` }, vp);
  }

  const writes = s.requests.filter((r) => r.readOnlySkip);
  if (writes.length) {
    out.add({
      check: 'network',
      rule: 'write_skipped',
      severity: 'info',
      message: `${writes.reduce((n, r) => n + r.count, 0)} write(s) on load were skipped — verify renders read-only (${writes.slice(0, 2).map((w) => `${w.method} ${w.url}`).join(', ')})`
        + (refusalsSeenByPage ? '; the page\'s own error handling saw the refusal, which real viewers do not get' : ''),
    }, vp);
  }
  for (const r of s.requests) if (!r.readOnlySkip) out.add(requestIssue(r), vp);
  for (const b of s.blocked) {
    if (b.reason === 'csp') {
      out.add({
        check: 'network',
        rule: 'csp_blocked',
        severity: 'error',
        message: `Blocked for viewers: ${b.type} from ${b.url} (Content-Security-Policy ${b.directive})`,
        hint: ctx.lockCsp
          ? 'This page uses MCP connections, so it may only reach its own origin and ShareOut — load assets from the page itself or /vendor/.'
          : ctx.isPublic
            ? 'Public pages load scripts, styles and fonts only from the CDN allowlist. Use this instance\'s /vendor/<package>@<version>/… copy or an allowlisted CDN, or keep the page private.'
            : 'Viewers\' browsers refuse this resource under the page\'s Content-Security-Policy; load it over https from an allowed host.',
        count: b.count,
      }, vp);
    } else if (b.reason === 'navigation') {
      out.add({ check: 'network', rule: 'navigation_blocked', severity: 'warning', message: `The page tried to navigate to ${b.url} while loading; verify kept it on the page`, count: b.count }, vp);
    } else {
      out.add({ check: 'network', rule: 'private_network_blocked', severity: 'warning', message: `Request to ${b.url} was blocked (private or non-web address)`, count: b.count }, vp);
    }
  }

  const l = s.layout;
  if (l) {
    const spec = VIEWPORTS[vp];
    if (spec.mobile && l.viewportWidth > spec.width + 1) {
      out.add({
        check: 'layout',
        rule: 'no_viewport_meta',
        severity: 'error',
        message: `Lays out ${l.viewportWidth}px wide on a ${spec.width}px phone and is shown zoomed out`,
        hint: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
      }, vp);
    }
    if (l.overflow.length) {
      const px = Math.max(l.scrollWidth - l.viewportWidth, ...l.overflow.map((o) => o.px));
      out.add({
        check: 'layout',
        rule: 'horizontal_overflow',
        severity: 'error',
        message: `Page is ${px}px wider than the ${VIEWPORT_LABEL[vp]} screen (${l.viewportWidth}px) — widest: ${l.overflow.map((o) => `${o.selector} (+${o.px}px)`).join(', ')}`,
        where: l.overflow[0].selector,
        hint: 'Let it reflow at narrow widths: max-width:100% on media, flex-wrap / grid auto-fit for rows, and wrap wide tables or code in a container with overflow-x:auto.',
      }, vp);
    }
    if (l.smallTargets.count) {
      const e = l.smallTargets.examples;
      out.add({
        check: 'layout',
        rule: 'small_tap_targets',
        severity: 'warning',
        message: `${l.smallTargets.count} tap target(s) smaller than 44×44 px — e.g. ${e.slice(0, 3).map((t) => `${t.selector} (${t.width}×${t.height})`).join(', ')}`,
        where: e[0]?.selector,
        hint: 'On phones give buttons and links at least 44×44 px (padding, min-height / min-width).',
      }, vp);
    }
    if (l.brokenImages.length) {
      out.add({
        check: 'layout',
        rule: 'broken_image',
        severity: 'error',
        message: `${l.brokenImages.length} image(s) failed to load — e.g. ${l.brokenImages[0].selector} (${l.brokenImages[0].src})`,
        where: l.brokenImages[0].selector,
        hint: 'Check the image path (relative to the page) and that the file is in the publish payload; add alt text.',
      }, vp);
    }
    if (!l.textLength && !l.visibleMedia) {
      out.add({
        check: 'render',
        rule: 'blank_page',
        severity: 'error',
        message: 'The page shows nothing (no text, images or charts) after loading',
        hint: 'Usually a script error before the first render (see the errors above), or content that only appears after data the page never loaded.',
      }, vp);
    }
    if (l.readyFlag === false) {
      out.add({
        check: 'render',
        rule: 'ready_flag_not_set',
        severity: 'warning',
        message: 'The page uses window.__shareoutReady but did not set it to true within 8 s',
        hint: 'Set window.__shareoutReady = true once the data has rendered, in every code path (success, empty and error) — renders wait for it.',
      }, vp);
    }
  }

  if (s.axe && 'error' in s.axe) {
    out.add({ check: 'a11y', rule: 'a11y_not_run', severity: 'info', message: `Accessibility check did not run: ${s.axe.error}` }, vp);
  } else if (s.axe) {
    for (const v of s.axe.violations) {
      out.add({
        check: 'a11y',
        rule: v.id,
        severity: v.impact === 'critical' || v.impact === 'serious' ? 'error' : v.impact === 'moderate' ? 'warning' : 'info',
        message: `${v.help} (${v.impact ?? 'unrated'}, ${v.nodes} element${v.nodes === 1 ? '' : 's'})`,
        where: v.targets.join(', ') || undefined,
        hint: v.helpUrl ? `How to fix: ${v.helpUrl.replace(/\?.*$/, '')}` : undefined,
        count: v.nodes,
      }, vp);
    }
  }

  const m = s.metrics;
  const where = VIEWPORT_LABEL[vp];
  if (m.lcpMs !== null && m.lcpMs > 2500) {
    out.add({
      check: 'performance',
      rule: 'slow_lcp',
      severity: m.lcpMs > 4000 ? 'warning' : 'info',
      message: `Main content took ${secs(m.lcpMs)} to appear on ${where} (LCP)`,
      hint: 'Paint a skeleton or cached snapshot first, defer heavy libraries, and size images to their slot.',
    }, vp);
  }
  if (m.cls !== null && m.cls > 0.1) {
    out.add({
      check: 'performance',
      rule: 'layout_shift',
      severity: m.cls > 0.25 ? 'warning' : 'info',
      message: `Content jumps while loading on ${where} (CLS ${m.cls.toFixed(2)})`,
      hint: 'Reserve space for images, charts and late data (width/height, aspect-ratio, min-height skeletons).',
    }, vp);
  }
  if (m.bytes !== null && m.bytes > 5_000_000) {
    out.add({
      check: 'performance',
      rule: 'heavy_page',
      severity: 'warning',
      message: `Downloads ${kb(m.bytes)} in ${m.requests} requests on ${where}`,
      hint: 'Move large media to sdk.blobs or lazy-load it, and load one chart library from /vendor/.',
    }, vp);
  }
}

function addDesign(out: Issues, s: PageSignals): DesignReport | null {
  const d = s.design;
  if (!d) return null;
  const mono = /mono|courier|consolas|menlo/i;
  const families = d.fonts.filter((f) => f.share >= 0.02 && !mono.test(f.family));
  if (families.length > 2) {
    out.add({
      check: 'design',
      rule: 'too_many_fonts',
      severity: 'warning',
      message: `Uses ${families.length} font families (${families.map((f) => f.family).join(', ')})`,
      hint: 'Pick one font system: one family for text, optionally one for headings.',
    });
  }
  for (const font of d.failedFonts) {
    out.add({ check: 'design', rule: 'font_failed', severity: 'warning', message: `Web font "${font}" failed to load — text falls back to a default font` });
  }
  if (d.accents.length > 3) {
    out.add({
      check: 'design',
      rule: 'too_many_accents',
      severity: 'warning',
      message: `Uses ${d.accents.length} accent colors (${d.accents.slice(0, 5).join(', ')})`,
      hint: 'One accent color (plus red/green for status) reads as designed; map the others to neutrals or the accent.',
    });
  }
  if (d.longestLine && d.longestLine.chars > 100) {
    out.add({
      check: 'design',
      rule: 'long_lines',
      severity: 'warning',
      message: `Lines run to ~${d.longestLine.chars} characters (${d.longestLine.selector})`,
      where: d.longestLine.selector,
      hint: 'Cap text width (max-width: 70ch); 60–80 characters per line reads best.',
    });
  }
  const missing = [
    ...(!d.title || /^(document|untitled|index|new tab)$/i.test(d.title) ? ['<title>'] : []),
    ...(!d.hasDescription ? ['meta description'] : []),
    ...(!d.hasOgImage ? ['og:image'] : []),
    ...(!d.hasFavicon ? ['favicon'] : []),
  ];
  if (missing.length) {
    out.add({
      check: 'design',
      rule: 'missing_meta',
      severity: 'info',
      message: `No ${missing.join(', ')} (used when the page is shared or bookmarked)`,
    });
  }
  return {
    fonts: d.fonts.slice(0, 6),
    accents: d.accents.slice(0, 6),
    longest_line_chars: d.longestLine?.chars ?? null,
    title: d.title,
    missing,
  };
}

export interface ReportInput {
  id: string;
  artifactId: string;
  versionNo: number;
  versionId: string;
  live: boolean;
  /** null when no browser ran (see partialReason). */
  signals: PageSignals[] | null;
  partialReason?: 'no_browser' | 'render_failed';
  sourceIssues: VerifyIssue[];
  screenshots: Partial<Record<Viewport, ScreenshotInfo>>;
  thumbnailRefreshed: boolean;
  isPublic: boolean;
  lockCsp: boolean;
  startedAt: number;
  now?: number;
}

export function buildResult(input: ReportInput): VerifyResult {
  const out = new Issues();
  let design: DesignReport | null = null;
  for (const s of input.signals ?? []) {
    addPageSignals(out, s, input);
    design = design ?? addDesign(out, s);
  }
  for (const i of input.sourceIssues) out.add(i);
  const all = out.list();
  const issues = all.slice(0, MAX_ISSUES);

  const rendered = (input.signals ?? []).filter((s) => !s.renderError);
  const partialReason = input.partialReason ?? (input.signals && !rendered.length ? 'render_failed' : undefined);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of all) counts[i.severity]++;
  const status = partialReason ? 'partial' : counts.error ? 'fail' : counts.warning ? 'warn' : 'pass';

  const viewports: ViewportReport[] = (input.signals ?? []).map((s) => {
    const spec = VIEWPORTS[s.viewport];
    return {
      viewport: s.viewport,
      entrypoint: s.entrypoint,
      width: spec.width,
      height: spec.height,
      dpr: spec.dpr,
      screenshot: input.screenshots[s.viewport] ?? null,
      metrics: s.renderError ? null : {
        load_ms: s.loadMs,
        lcp_ms: s.metrics.lcpMs,
        cls: s.metrics.cls,
        bytes: s.metrics.bytes,
        requests: s.metrics.requests,
      },
    };
  });

  const tally = [
    counts.error ? `${counts.error} error${counts.error === 1 ? '' : 's'}` : '',
    counts.warning ? `${counts.warning} warning${counts.warning === 1 ? '' : 's'}` : '',
    counts.info ? `${counts.info} note${counts.info === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ') || 'no problems found';
  const summary = partialReason === 'no_browser'
    ? `partial — source checks only (this instance has no Browser Rendering): ${tally}`
    : partialReason === 'render_failed'
      ? `partial — the page could not be rendered, source checks only: ${tally}`
      : `${status} — ${tally}`;

  return {
    id: input.id,
    artifact_id: input.artifactId,
    version: input.versionNo,
    version_id: input.versionId,
    live: input.live,
    status,
    ...(partialReason ? { partial_reason: partialReason } : {}),
    summary,
    counts,
    issues,
    viewports,
    design,
    thumbnail_refreshed: input.thumbnailRefreshed,
    duration_ms: (input.now ?? Date.now()) - input.startedAt,
    created_at: new Date(input.now ?? Date.now()).toISOString(),
  };
}

function seenOn(i: VerifyIssue): string {
  if (!i.viewports?.length) return '';
  return i.viewports.length > 1 ? '[both] ' : `[${VIEWPORT_LABEL[i.viewports[0]]}] `;
}

/** ≤ 40-line plain-text report for an agent (the MCP tool's text content). */
export function agentSummary(r: VerifyResult, name: string): string {
  const lines: string[] = [];
  const title = `Checked "${name}" v${r.version}${r.live ? ' (live)' : ' (not the live version)'}`;
  lines.push(`${title} — ${r.status.toUpperCase()}: ${r.summary.replace(/^[a-z]+ — /, '')}`);
  const vps = r.viewports.filter((v) => v.metrics);
  if (vps.length) {
    lines.push(`Viewed as ${vps.map((v) => `${VIEWPORT_LABEL[v.viewport]} ${v.width}×${v.height}`).join(' and ')}: ` +
      vps.map((v) => {
        const m = v.metrics!;
        return `${VIEWPORT_LABEL[v.viewport]} LCP ${m.lcp_ms === null ? 'n/a' : secs(m.lcp_ms)}, CLS ${m.cls === null ? 'n/a' : m.cls.toFixed(2)}${m.bytes === null ? '' : `, ${kb(m.bytes)}`}`;
      }).join(' · '));
  }
  if (r.partial_reason === 'render_failed') lines.push('Rendering failed this time (no screenshots); try again in a minute.');

  const bySeverity = (s: Severity) => r.issues.filter((i) => i.severity === s);
  const errors = bySeverity('error');
  const warnings = bySeverity('warning');
  const notes = bySeverity('info');
  const reserve = 2;
  let room = MAX_SUMMARY_LINES - lines.length - reserve;
  const take = (text: string) => {
    if (room <= 0) return false;
    lines.push(text);
    room--;
    return true;
  };
  let shown = 0;
  if (errors.length) take('Errors:');
  for (const [n, i] of errors.entries()) {
    if (!take(`${n + 1}. ${seenOn(i)}${i.message}${i.where && !i.message.includes(i.where) ? ` — ${i.where}` : ''}`)) break;
    shown++;
    if (i.hint && room > errors.length - n) take(`   → ${i.hint}`);
  }
  if (warnings.length) take('Warnings:');
  for (const i of warnings) {
    if (!take(`- ${seenOn(i)}${i.message}`)) break;
    shown++;
  }
  if (notes.length && take(`Notes: ${notes.slice(0, 4).map((i) => i.rule).join(', ')}${notes.length > 4 ? ` +${notes.length - 4}` : ''}`)) shown += notes.length;
  const hidden = r.counts.error + r.counts.warning + r.counts.info - shown;
  room += reserve;
  if (hidden > 0) take(`(${hidden} more in the full report: GET /v1/artifacts/${r.artifact_id}/verify/latest)`);
  take(r.status === 'pass'
    ? 'Looks good. Screenshots follow: desktop, then phone.'
    : r.status === 'partial'
      ? 'Fix any errors above, update the page, then verify again.'
      : 'Fix the errors (then warnings), update the page, and verify again. Screenshots follow: desktop, then phone.');
  return lines.slice(0, MAX_SUMMARY_LINES).join('\n');
}
