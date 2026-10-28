/** Pieces both detail pages use (automation: 'jobdetail' chunk; AI task: 'crew' chunk):
 *  schedule <-> form fields, info rows and the run-history list. Included in both lazy
 *  chunks rather than the boot shell, which has a size budget. */
export const workspace_client_home_views_autoDetailShared_JS = `  // The reverse of afCron: a stored UTC cron → the local { freq, time, day } the form
  // fields show, or null when the cron is not one the simple fields can express.
  function afParseCron(cron, tz, at) {
    var p = String(cron || '').trim().split(/\\s+/), num = /^\\d+$/;
    if (p.length !== 5 || p[3] !== '*') return null;
    if (p.join(' ') === '0 * * * *') return { freq: 'hourly', time: '09:00', day: '1' };
    if (!num.test(p[0]) || !num.test(p[1])) return null;
    var x = +p[1] * 60 + +p[0] + tzOffset(tz, at || new Date());
    var shift = x < 0 ? -1 : x >= 1440 ? 1 : 0; x = ((x % 1440) + 1440) % 1440;
    var time = hhmm(String(Math.floor(x / 60)), String(x % 60));
    if (p[2] === '*' && p[4] === '*') return { freq: 'daily', time: time, day: '1' };
    if (p[2] === '*') {
      var set = dowSet(p[4]); if (!set) return null;
      set = set.map(function (d) { return (d + shift + 7) % 7; }).sort();
      if (set.join(',') === '1,2,3,4,5') return { freq: 'weekdays', time: time, day: '1' };
      return set.length === 1 ? { freq: 'weekly', time: time, day: String(set[0]) } : null;
    }
    if (num.test(p[2]) && p[4] === '*') { var d = +p[2] + shift; return d >= 1 && d <= 28 ? { freq: 'monthly', time: time, day: String(d) } : null; }
    return null;
  }
  // Schedule fields for an edit form, prefilled from a stored cron. Ids are prefixed (p)
  // so two forms never clash; 'custom' keeps any cron the simple fields cannot show.
  function afScheduleFields(p, cron) {
    var tz = viewerTz(), cur = afParseCron(cron, tz) || { freq: 'custom', time: '09:00', day: '1' };
    var lbl = { hourly: 'autof.freqHourly', daily: 'autof.freqDaily', weekdays: 'autof.freqWeekdays', weekly: 'autof.freqWeekly', monthly: 'autof.freqMonthly', custom: 'adet.freqCustom' };
    var freq = ['hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'].map(function (k) { return afOpt(k, t(lbl[k]), k === cur.freq); }).join('');
    return '<div class="wsx-cform__row">' + afSel(t('autof.frequency'), p + '_freq', freq).replace('<select ', '<select data-v="' + cur.freq + '" ')
      + afSel(t(cur.freq === 'monthly' ? 'autof.monthDay' : 'autof.weekday'), p + '_day', afDayOptions(cur.freq === 'monthly' ? 'monthly' : 'weekly')).replace('<select ', '<select data-v="' + esc(cur.day) + '" ') + '</div>'
      + '<div class="wsx-cform__row"><label class="wsx-field" data-af="' + p + '_time"><span class="wsx-field__lbl">' + esc(t('autof.time')) + '</span><input class="wsx-field__in" id="' + p + '_time" type="time" value="' + esc(cur.time) + '"></label>'
      + afSel(t('autof.timezone'), p + '_tz', afTzOptions()).replace('<select ', '<select data-v="' + esc(tz) + '" ') + '</div>'
      + '<label class="wsx-field" data-af="' + p + '_cron"><span class="wsx-field__lbl">' + esc(t('adet.cron')) + '</span><input class="wsx-field__in" id="' + p + '_cron" type="text" spellcheck="false" autocomplete="off" value="' + esc(cron || '') + '"><span class="wsx-field__note">' + esc(t('adet.cronNote')) + '</span></label>';
  }
  function afWireSchedule(root, p) {
    var f = root.querySelector('#' + p + '_freq');
    f.value = f.getAttribute('data-v');
    function sync() {
      var v = f.value, dayF = root.querySelector('[data-af="' + p + '_day"]'), sel = root.querySelector('#' + p + '_day');
      var showDay = v === 'weekly' || v === 'monthly', custom = v === 'custom';
      if (showDay && sel.getAttribute('data-for') !== v) {
        var keep = sel.value; sel.innerHTML = afDayOptions(v); sel.setAttribute('data-for', v);
        if (sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
        dayF.querySelector('.wsx-field__lbl').textContent = t(v === 'monthly' ? 'autof.monthDay' : 'autof.weekday');
      }
      dayF.hidden = !showDay;
      root.querySelector('[data-af="' + p + '_time"]').hidden = v === 'hourly' || custom;
      root.querySelector('[data-af="' + p + '_tz"]').hidden = v === 'hourly' || custom;
      root.querySelector('[data-af="' + p + '_cron"]').hidden = !custom;
    }
    var daySel = root.querySelector('#' + p + '_day'), tzSel = root.querySelector('#' + p + '_tz');
    daySel.setAttribute('data-for', f.value === 'monthly' ? 'monthly' : 'weekly');
    // Prefilled day and zone are set as values too, not only as selected attributes.
    daySel.value = daySel.getAttribute('data-v'); tzSel.value = tzSel.getAttribute('data-v');
    f.addEventListener('change', sync); sync();
  }
  function afReadSchedule(root, p) {
    var v = root.querySelector('#' + p + '_freq').value;
    if (v === 'custom') { var c = root.querySelector('#' + p + '_cron').value.trim(); return c ? { cron: c } : { err: 'adet.errCron' }; }
    return afCron(v, root.querySelector('#' + p + '_time').value, root.querySelector('#' + p + '_day').value, root.querySelector('#' + p + '_tz').value);
  }
  // ----- Shared by the automation and AI task detail pages -----
  function adetDate(v) {
    if (!v) return ''; var d = new Date(v); if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString(locTag() || undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toISOString(); }
  }
  // Past: date + "2h ago". Future (next run): the date alone; timeAgo only counts backwards.
  function adetWhen(v) { var a = adetDate(v); if (!a) return '—'; return Date.parse(v) > Date.now() + 60000 ? a : a + ' (' + whenAgo(v) + ')'; }
  function adetRow(label, html) { return '<div class="wsx-adet__row"><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>'; }
  function adetSec(title, inner) { return '<section class="wsx-adet__sec"><h4 class="wsx-adet__h">' + esc(title) + '</h4>' + inner + '</section>'; }
  // rows: [{ id, surface, status, at, dur, note }], newest first. A row opens the run's
  // steps and output in the Run Inspector drawer (workspace-scoped, like the run bars).
  function adetRuns(rows) {
    if (!rows.length) return '<p class="wsx-sched__noruns">' + esc(t('sched.noRuns')) + '</p>';
    var click = !!window.WSX_WS;
    return '<div class="wsx-adet__runs">' + rows.map(function (r) {
      var c = runCls(r.status), open = click && r.id;
      return '<div class="wsx-adet__run' + (open ? ' is-click" role="button" tabindex="0" data-run-surface="' + esc(r.surface) + '" data-run-id="' + esc(r.id) : '') + '">'
        + '<span class="wsx-adet__pill is-' + c + '">' + esc(t('adet.st.' + c)) + '</span>'
        + '<span class="wsx-adet__at">' + esc(adetDate(r.at)) + '</span>'
        + '<span class="wsx-adet__dur">' + esc(r.dur || '') + '</span>'
        + '<span class="wsx-adet__note" title="' + esc(r.note || '') + '">' + esc(r.note || '') + '</span></div>';
    }).join('') + '</div>';
  }
  function adetWireRuns(host) {
    host.querySelectorAll('[data-run-id]').forEach(function (b) {
      var go = function () { if (window.SO_openRunDrawer) window.SO_openRunDrawer(b.getAttribute('data-run-surface'), b.getAttribute('data-run-id')); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
`;
