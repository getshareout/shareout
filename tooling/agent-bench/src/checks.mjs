/**
 * Functional checks: does the artifact do what the brief asked, as a user would try it.
 *
 * Steps are deliberately generic (agents choose their own labels and layouts): locate by
 * visible text / label / placeholder with broad regexes, act, then assert on visible text
 * or on the instance's REST API. A failed step is recorded and the run continues; the
 * score is passed / scored steps (steps marked `optional` count only when they pass).
 */
import { contentFrame, newViewerContext, openArtifact } from './render.mjs';
import { log, sleep } from './lib.mjs';

const rx = (s) => new RegExp(s, 'i');

function expand(v, vars) {
  return typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)) : v;
}

async function bodyText(frame) {
  return frame.evaluate(() => [document.body ? document.body.innerText : '', ...[...document.querySelectorAll('textarea')].map((t) => t.value)].join('\n'));
}

async function waitText(frame, re, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await bodyText(frame).catch(() => '');
    if (re.test(last)) return true;
    await sleep(400);
  }
  return false;
}

/** Visible clickable whose text / aria-label / title / value matches. Marks it for Playwright. */
async function markClickable(frame, pattern, roles) {
  return frame.evaluate(
    ({ pattern, roles }) => {
      const re = new RegExp(pattern, 'i');
      document.querySelectorAll('[data-bench-hit]').forEach((e) => e.removeAttribute('data-bench-hit'));
      const sel = roles === 'any'
        ? 'button,a,[role=button],[role=tab],[role=link],[role=menuitem],[role=radio],[role=checkbox],label,input[type=submit],input[type=button],input[type=radio],input[type=checkbox],summary,[onclick],li,[tabindex]'
        : 'button,a,[role=button],[role=tab],[role=link],[role=menuitem],label,input[type=submit],input[type=button],summary,[onclick]';
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const label = (el) => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.value, el.getAttribute('data-tooltip')].filter(Boolean).join(' ').trim();
      const hits = [...document.querySelectorAll(sel)].filter((el) => vis(el) && re.test(label(el)));
      hits.sort((a, b) => label(a).length - label(b).length);
      if (!hits.length) return null;
      hits[0].setAttribute('data-bench-hit', '1');
      return label(hits[0]).slice(0, 60);
    },
    { pattern, roles }
  );
}

/** A visible text field: by label/placeholder/name/aria-label pattern, else the first empty one. */
async function markField(frame, pattern, kinds = 'input') {
  return frame.evaluate(
    ({ pattern, kinds }) => {
      const re = pattern ? new RegExp(pattern, 'i') : null;
      document.querySelectorAll('[data-bench-field]').forEach((e) => e.removeAttribute('data-bench-field'));
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const textual = 'input:not([type]),input[type=text],input[type=search],input[type=email],input[type=tel],input[type=url],input[type=number],textarea';
      const sel = kinds === 'editor' ? 'textarea,[contenteditable=""],[contenteditable=true],.ProseMirror,.ql-editor,.cm-content' : textual;
      const describe = (el) => {
        const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        return [el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('aria-label'), el.id, id && id.innerText, el.closest('label') && el.closest('label').innerText].filter(Boolean).join(' ');
      };
      const all = [...document.querySelectorAll(sel)].filter((el) => vis(el) && !el.disabled && !el.readOnly);
      const pick = re ? all.find((el) => re.test(describe(el))) : all.find((el) => !el.value && !/search|buscar|filter|filtr/i.test(describe(el))) || all[0];
      if (!pick) return null;
      pick.setAttribute('data-bench-field', '1');
      return describe(pick).slice(0, 60) || pick.tagName;
    },
    { pattern, kinds }
  );
}

const FORM_FILL = `(({ token, prefs }) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const set = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const describe = (el) => [el.getAttribute('placeholder'), el.getAttribute('name'), el.getAttribute('aria-label'), el.id, el.labels && el.labels[0] && el.labels[0].innerText].filter(Boolean).join(' ');
  let filled = 0;
  const radiosDone = new Set();
  const fields = [...document.querySelectorAll('input,textarea,select')].filter((el) => vis(el) || (el.type === 'radio' || el.type === 'checkbox'));
  for (const el of fields) {
    if (el.disabled || el.readOnly || el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
    const d = describe(el);
    if (/search|buscar|filtr/i.test(d)) continue;
    const pref = Object.entries(prefs || {}).find(([k]) => new RegExp(k, 'i').test(d));
    const t = el.type;
    if (el.tagName === 'SELECT') {
      const opts = [...el.options].filter((o) => o.value && !o.disabled);
      const o = pref ? opts.find((x) => new RegExp(pref[1], 'i').test(x.text)) : opts[Math.min(1, opts.length - 1)];
      if (o) { set(el, o.value); filled++; }
    } else if (t === 'radio') {
      if (radiosDone.has(el.name)) continue;
      const group = [...document.querySelectorAll('input[type=radio]')].filter((r) => r.name === el.name);
      const choice = pref ? group.find((r) => new RegExp(pref[1], 'i').test(describe(r) + ' ' + r.value)) || group[0] : group[0];
      choice.click(); radiosDone.add(el.name); filled++;
    } else if (t === 'checkbox') {
      if (el.required && !el.checked) { el.click(); filled++; }
    } else if (t === 'email' || /e-?mail|correo/i.test(d)) { set(el, 'bench+' + token.toLowerCase() + '@example.com'); filled++; }
    else if (t === 'number' || t === 'range') { set(el, pref ? pref[1] : String(Math.max(Number(el.min || 0), Math.min(Number(el.max || 3), 3)))); filled++; }
    else if (t === 'date') { set(el, '2026-11-20'); filled++; }
    else if (t === 'datetime-local') { set(el, '2026-11-20T18:00'); filled++; }
    else if (t === 'time') { set(el, '18:00'); filled++; }
    else if (t === 'tel' || /phone|tel[eé]fono|celular/i.test(d)) { set(el, '+54 11 5555 0101'); filled++; }
    else if (t === 'url') { set(el, 'https://example.com'); filled++; }
    else if (/amount|monto|price|precio|importe/i.test(d)) { set(el, '12500'); filled++; }
    else if (pref) { set(el, pref[1]); filled++; }
    else if (!el.value) { set(el, el.tagName === 'TEXTAREA' ? 'Bench note ' + token : token); filled++; }
  }
  return filled;
})`;

export async function runChecks(browser, inst, artifact, brief, vars, outDir) {
  const steps = brief.functional || [];
  const results = [];
  const ctxs = {};
  const frames = {};
  const pages = {};
  const open = async (who, as) => {
    const ctx = await newViewerContext(browser, inst);
    ctxs[who] = ctx;
    pages[who] = await ctx.newPage();
    frames[who] = await openArtifact(pages[who], inst, artifact.slug, { settleMs: 2000 });
  };
  const frame = async (who) => {
    frames[who] = await contentFrame(pages[who], artifact.slug, 5000);
    return frames[who];
  };

  try {
    await open('a');
    for (const raw of steps) {
      const step = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, expand(v, vars)]));
      const who = step.in || 'a';
      const started = Date.now();
      let ok = false;
      let detail = '';
      try {
        if (!pages[who] && step.do !== 'open_second') throw new Error(`viewer ${who} not open`);
        const f = step.do === 'open_second' || step.do === 'rest' || step.do === 'live_update' ? null : await frame(who);
        switch (step.do) {
          case 'expect_text':
            ok = await waitText(f, rx(step.text), step.timeout ?? 8000);
            detail = ok ? '' : `no /${step.text}/`;
            break;
          case 'expect_no_text':
            await sleep(500);
            ok = !rx(step.text).test(await bodyText(f));
            break;
          case 'expect_selector': {
            const deadline = Date.now() + (step.timeout ?? 8000);
            let n = 0;
            while (Date.now() < deadline) {
              n = await f.evaluate((s) => document.querySelectorAll(s).length, step.selector);
              if (n >= (step.min ?? 1)) break;
              await sleep(400);
            }
            ok = n >= (step.min ?? 1);
            detail = `${n} × ${step.selector}`;
            break;
          }
          case 'click': {
            const hit = await markClickable(f, step.name, step.roles || 'any');
            if (!hit) { detail = `nothing matches /${step.name}/`; break; }
            await f.locator('[data-bench-hit]').first().click({ timeout: 5000 });
            await sleep(step.wait ?? 1000);
            ok = true;
            detail = hit;
            break;
          }
          case 'press':
            await f.locator('body').press(step.key);
            await sleep(step.wait ?? 700);
            ok = true;
            break;
          case 'fill': {
            const hit = await markField(f, step.field);
            if (!hit) { detail = `no field /${step.field || 'any'}/`; break; }
            const loc = f.locator('[data-bench-field]').first();
            await loc.fill(String(step.value));
            if (step.enter !== false) await loc.press('Enter').catch(() => {});
            await sleep(step.wait ?? 1200);
            ok = true;
            detail = hit;
            break;
          }
          case 'type': {
            const hit = await markField(f, step.field, 'editor');
            if (!hit) { detail = 'no editor'; break; }
            const loc = f.locator('[data-bench-field]').first();
            await loc.click();
            await pages[who].keyboard.type(` ${step.value} `, { delay: 15 });
            await sleep(step.wait ?? 1500);
            ok = true;
            detail = hit;
            break;
          }
          case 'add_item': {
            if (step.open) {
              const opener = await markClickable(f, step.open, 'buttons');
              if (opener) { await f.locator('[data-bench-hit]').first().click({ timeout: 5000 }); await sleep(800); }
            }
            const ff = await frame(who);
            const field = await markField(ff, step.field);
            if (!field) { detail = 'no input for the new item'; break; }
            const loc = ff.locator('[data-bench-field]').first();
            await loc.fill(String(step.value));
            await loc.press('Enter').catch(() => {});
            await sleep(1200);
            if (!(await waitText(ff, rx(String(step.value)), 1500))) {
              const sub = await markClickable(ff, step.submit || '^(add|save|create|\\+|ok|agregar|guardar|crear|añadir)', 'buttons');
              if (sub) { await ff.locator('[data-bench-hit]').first().click({ timeout: 5000 }); await sleep(1500); }
            }
            ok = await waitText(await frame(who), rx(String(step.value)), 6000);
            detail = ok ? field : `"${step.value}" not visible after adding`;
            break;
          }
          case 'fill_form': {
            const n = await f.evaluate(`${FORM_FILL}(${JSON.stringify({ token: vars.token, prefs: step.prefs || {} })})`);
            if (!n) { detail = 'no form fields'; break; }
            const sub = await markClickable(f, step.submit || '(submit|send|save|register|sign ?up|subscribe|join|book|reserve|confirm|check ?out|request|vote|enviar|guardar|registr|inscrib|anot|suscrib|reserv|confirm|pedir|solicit|votar|cargar)', 'buttons');
            if (sub) await f.locator('[data-bench-hit]').first().click({ timeout: 5000 });
            else await f.locator('input:visible,textarea:visible').last().press('Enter').catch(() => {});
            await sleep(step.wait ?? 2500);
            ok = true;
            detail = `${n} fields${sub ? `, clicked "${sub}"` : ', pressed Enter'}`;
            break;
          }
          case 'goto_page': {
            const hit = await markClickable(f, step.name, 'buttons');
            if (!hit) { detail = `no link /${step.name}/`; break; }
            await f.locator('[data-bench-hit]').first().click({ timeout: 5000 });
            await sleep(2000);
            ok = true;
            detail = hit;
            break;
          }
          case 'reload':
            await pages[who].reload({ waitUntil: 'load' });
            await frame(who);
            await sleep(2500);
            ok = true;
            break;
          case 'open_second':
            await open(step.as || 'b');
            ok = true;
            break;
          case 'eval':
            ok = !!(await f.evaluate(step.js));
            break;
          case 'rest':
            ({ ok, detail } = await restCheck(inst, artifact, step));
            break;
          case 'live_update':
            ({ ok, detail } = await liveUpdate(inst, artifact, step, pages, frame));
            break;
          default:
            detail = `unknown step ${step.do}`;
        }
      } catch (e) {
        detail = String(e.message || e).split('\n')[0].slice(0, 200);
      }
      results.push({ step: raw.label || raw.do, do: step.do, in: who, ok, optional: !!step.optional, detail, ms: Date.now() - started });
    }
    if (pages.a) await pages.a.screenshot({ path: `${outDir}/after-checks.png` }).catch(() => {});
  } finally {
    for (const c of Object.values(ctxs)) await c.close().catch(() => {});
  }
  const scored = results.filter((r) => !r.optional || r.ok);
  const passed = scored.filter((r) => r.ok).length;
  const score = scored.length ? passed / scored.length : 1;
  log(`checks ${brief.id}: ${passed}/${scored.length}`);
  return { score, passed, total: scored.length, steps: results };
}

async function json(res) {
  try { return await res.json(); } catch { return null; }
}

export async function tableRowCount(inst, id) {
  const list = await json(await inst.api(`/v1/data/${id}/tables`));
  const tables = list?.data?.tables || [];
  let rows = 0;
  for (const t of tables) {
    const name = typeof t === 'string' ? t : t.name;
    if (typeof t === 'object' && typeof t.row_count === 'number') { rows += t.row_count; continue; }
    const c = await json(await inst.api(`/v1/data/${id}/tables/${encodeURIComponent(name)}/count`, { method: 'POST', body: '{}' }));
    rows += Number(c?.data?.count ?? c?.count ?? 0);
  }
  return { tables: tables.length, rows };
}

async function restCheck(inst, artifact, step) {
  const id = artifact.id;
  const min = step.min ?? 1;
  switch (step.check) {
    case 'rows': {
      const { rows, tables } = await tableRowCount(inst, id);
      return { ok: rows >= min, detail: `${rows} rows in ${tables} tables` };
    }
    case 'json_keys': {
      const j = await json(await inst.api(`/v1/data/${id}/json`));
      const n = j?.data?.count ?? (j?.data?.keys || []).length;
      return { ok: n >= min, detail: `${n} keys` };
    }
    case 'data': {
      const j = await json(await inst.api(`/v1/data/${id}/json`));
      const keys = j?.data?.count ?? 0;
      const { rows } = await tableRowCount(inst, id);
      return { ok: keys + rows >= min, detail: `${keys} json keys, ${rows} rows` };
    }
    case 'jobs': {
      const j = await json(await inst.api(`/v1/jobs?artifact_id=${id}`));
      const jobs = j?.jobs || j?.data?.jobs || (Array.isArray(j) ? j : []);
      return { ok: jobs.length >= min, detail: `${jobs.length} jobs${jobs[0] ? ` (${jobs[0].schedule || jobs[0].cron || ''})` : ''}` };
    }
    case 'versions': {
      const j = await json(await inst.api(`/v1/artifacts/${id}/versions`));
      const v = j?.versions || j?.data?.versions || [];
      return { ok: v.length >= min, detail: `${v.length} versions` };
    }
    case 'html_pages': {
      const j = await json(await inst.api(`/v1/artifacts/${id}`));
      const pages = j?.pages || j?.artifact?.pages || [];
      return { ok: pages.length >= min, detail: `${pages.length} pages` };
    }
    case 'visibility': {
      const j = await json(await inst.api(`/v1/artifacts/${id}`));
      const v = j?.visibility || j?.artifact?.visibility;
      return { ok: new RegExp(`^(${step.equals})$`).test(v || ''), detail: `visibility ${v}` };
    }
    case 'pwa_manifest': {
      const r = await fetch(`${inst.origin}/a/${artifact.slug}/manifest.json`, { headers: { cookie: inst.cookie } });
      const body = await json(r);
      return { ok: r.ok && !!body?.name, detail: `manifest ${r.status}` };
    }
    case 'email_sent': {
      const sent = inst.state.requests.filter((r) => r.phase === 'checks' && /\/email\//.test(r.path) && r.method === 'POST' && r.status < 300);
      return { ok: sent.length >= min, detail: `${sent.length} email calls succeeded during the checks` };
    }
    case 'source': {
      const src = artifact.source || '';
      const ok = rx(step.pattern).test(src);
      return { ok, detail: ok ? 'found' : `source lacks /${step.pattern}/` };
    }
    default:
      return { ok: false, detail: `unknown rest check ${step.check}` };
  }
}

/** Change a stored number through the API and expect the open page to show it after a reload. */
async function liveUpdate(inst, artifact, step, pages, frame) {
  const id = artifact.id;
  const from = Number(step.find);
  const to = Number(step.replace);
  const swap = (v) => {
    let hit = false;
    const walk = (x) => {
      if (typeof x === 'number' && x === from) { hit = true; return to; }
      if (typeof x === 'string' && x === String(from)) { hit = true; return String(to); }
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
      return x;
    };
    return { value: walk(v), hit };
  };
  let where = null;
  const keys = (await json(await inst.api(`/v1/data/${id}/json`)))?.data?.keys || [];
  for (const k of keys) {
    const cur = await json(await inst.api(`/v1/data/${id}/json/${encodeURIComponent(k)}`));
    const { value, hit } = swap(cur?.data?.value ?? cur?.value);
    if (hit) {
      await inst.api(`/v1/data/${id}/json/${encodeURIComponent(k)}`, { method: 'PUT', body: JSON.stringify(value) });
      where = `json:${k}`;
      break;
    }
  }
  if (!where) {
    const tables = (await json(await inst.api(`/v1/data/${id}/tables`)))?.data?.tables || [];
    for (const t of tables) {
      const name = typeof t === 'string' ? t : t.name;
      const q = await json(await inst.api(`/v1/data/${id}/tables/${encodeURIComponent(name)}/query`, { method: 'POST', body: JSON.stringify({ limit: 500 }) }));
      const rows = q?.data?.rows || q?.rows || q?.data || [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const { value, hit } = swap(row);
        if (!hit) continue;
        const changes = Object.fromEntries(Object.entries(value).filter(([k, v]) => k !== 'id' && JSON.stringify(v) !== JSON.stringify(row[k])));
        await inst.api(`/v1/data/${id}/tables/${encodeURIComponent(name)}/${row.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
        where = `table:${name}`;
        break;
      }
      if (where) break;
    }
  }
  if (!where) return { ok: false, detail: `${from} is not in any data store (baked into the HTML?)` };
  await pages.a.reload({ waitUntil: 'load' });
  const f = await frame('a');
  await sleep(2500);
  const ok = await waitText(f, rx(step.expect), 8000);
  return { ok, detail: `updated ${where}; ${ok ? 'page shows new value' : 'page did not show the new value'}` };
}
