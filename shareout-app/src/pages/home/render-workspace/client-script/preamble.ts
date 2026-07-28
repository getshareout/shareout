/** Shared browser utilities. */
export const workspace_client_preamble_JS = `
(function () {
  var ws = document.getElementById('wsx');
  if (!ws) return;
  // Surface artifact-viewer loading diagnostics in the top-frame console so a stuck
  // gray overlay is easy to catch without switching DevTools frames. See loading.ts.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || d.type !== 'shareout:loading-diag') return;
    var stuck = d.reason && d.reason.indexOf('stuck') === 0;
    (stuck ? console.warn : console.log)('[wsx so-loading] ' + d.reason + ' ' + (d.ms | 0) + 'ms', d);
  });
  var t = window.__SO_HOME_T || function (k) { return k; };
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function i18nEmpty(k) { return '<div class="wsx-empty">' + esc(t(k)) + '</div>'; }
  // Error state (a failed load, not a genuine empty) — carries a Retry that re-runs the
  // active lens loader (wired in lens-routing). Use for catch handlers, not empty data.
  function i18nError(k) { return '<div class="wsx-empty">' + esc(t(k)) + ' <button class="wsx-link" type="button" data-empty-retry>' + esc(t('common.retry')) + '</button></div>'; }
  function i18nLoad() { return i18nEmpty('common.loading'); }
  function i18nSpin() { return '<div class="wsx-loading"><span class="wsx-spin"></span>' + esc(t('common.loading')) + '</div>'; }
  var KIND_ICON = { comment: '\\uD83D\\uDCAC', reply: '\\u21A9', share: '\\uD83D\\uDD17', run: '\\u2699', alert: '\\u25B2', view: '\\uD83D\\uDC41', access: '\\uD83D\\uDD11', test: '\\u2713', file: '\\uD83D\\uDCCE', publish: '\\u2191', create: '\\u2728', favorite: '\\u2605', connection: '\\uD83D\\uDD0C', skill: '\\uD83E\\uDDE9', member: '\\uD83D\\uDC64', agent: '\\u2699', metric_watch: '\\uD83D\\uDCC8', unused_artifacts: '\\uD83E\\uDDF9' };
  // Per-kind line icon (path) + accent color for notification chips. Design-system SVG language, not emoji.
  var KIND_META = {
    comment: { c: 'var(--color-primary)', i: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    reply: { c: 'var(--color-primary)', i: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>' },
    mention: { c: 'var(--color-warning)', i: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>' },
    share: { c: 'var(--color-text-secondary)', i: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>' },
    run: { c: 'var(--color-success)', i: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
    agent: { c: 'var(--color-success)', i: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
    alert: { c: 'var(--color-error)', i: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
    view: { c: 'var(--color-text-tertiary)', i: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>' },
    access: { c: 'var(--color-warning)', i: '<circle cx="8" cy="15" r="4"/><line x1="10.85" y1="12.15" x2="19" y2="4"/><line x1="18" y1="5" x2="20" y2="7"/><line x1="15" y1="8" x2="17" y2="10"/>' },
    stale_data: { c: 'var(--color-warning)', i: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
    metric_watch: { c: 'var(--color-primary)', i: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
    unused_artifacts: { c: 'var(--color-text-secondary)', i: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' },
    test: { c: 'var(--color-success)', i: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
    file: { c: 'var(--color-text-secondary)', i: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>' },
    publish: { c: 'var(--color-primary)', i: '<circle cx="12" cy="12" r="10"/><path d="M8 12l4-4 4 4"/><line x1="12" y1="16" x2="12" y2="8"/>' },
    create: { c: 'var(--color-success)', i: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>' },
    favorite: { c: 'var(--color-warning)', i: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
    connection: { c: 'var(--color-text-secondary)', i: '<path d="M6 8h12v2a6 6 0 0 1-12 0z"/><path d="M9 2v6M15 2v6M12 16v6"/>' },
    skill: { c: 'var(--color-primary)', i: '<path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.2 2.2 0 0 1 0 4.4H2V19a2 2 0 0 0 2 2h3.8v-1.5a2.2 2.2 0 0 1 4.4 0V21H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/>' },
    member: { c: 'var(--color-success)', i: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
    _: { c: 'var(--color-text-secondary)', i: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>' }
  };
  // Icon chip for an event: actor avatar if present, else the kind's tinted line icon.
  function iconChip(e, cls) {
    if (e.actor_picture) return '<span class="' + cls + '"><img src="' + esc(e.actor_picture) + '" alt=""></span>';
    var m = KIND_META[e.kind] || KIND_META._;
    return '<span class="' + cls + '" style="color:' + m.c + ';background:color-mix(in srgb,' + m.c + ' 14%,transparent)">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + m.i + '</svg></span>';
  }
  function timeAgo(ts) {
    var ms = ts < 1e12 ? ts * 1000 : ts;
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return t('time.now'); if (m < 60) return m + t('time.m');
    var h = Math.floor(m / 60); if (h < 24) return h + t('time.h');
    return Math.floor(h / 24) + t('time.d');
  }
  function adRelDate(iso) {
    if (!iso) return '\\u2014';
    var d = new Date(iso); if (isNaN(d.getTime())) return '\\u2014';
    var diff = Date.now() - d.getTime(); var abs = Math.abs(diff); var past = diff >= 0;
    if (abs < 60000) return t('time.justNow');
    if (abs < 3600000) { var mins = Math.round(abs / 60000); return past ? t('time.minutesAgo').replace('{n}', String(mins)) : t('time.inMinutes').replace('{n}', String(mins)); }
    if (abs < 86400000) { var hrs = Math.round(abs / 3600000); return past ? t('time.hoursAgo').replace('{n}', String(hrs)) : t('time.inHours').replace('{n}', String(hrs)); }
    var days = Math.round(abs / 86400000); return past ? t('time.daysAgo').replace('{n}', String(days)) : t('time.inDays').replace('{n}', String(days));
  }

`;
