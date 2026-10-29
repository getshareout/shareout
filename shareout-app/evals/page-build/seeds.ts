/** Small pages the edit items start from. Generic on purpose. */
import type { SeedFile } from './types';

const manifest = (tables: Record<string, Record<string, string>>) =>
  `<script type="shareout/manifest">${JSON.stringify({ sources: { tables } })}</script>`;

export const TASKS_SEED: SeedFile[] = [{
  path: 'index.html',
  content: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Team tasks</title>
${manifest({ tasks: { title: 'text', owner: 'text', done: 'boolean' } })}
<script src="/sdk/shareout.js"></script></head><body>
<h1>Team tasks</h1>
<form id="f"><input name="title" placeholder="Task" required><input name="owner" placeholder="Owner"><button>Add</button></form>
<ul id="list"></ul>
<script>
const tasks = shareout.table('tasks');
async function load() { const rows = await tasks.list(); list.innerHTML = rows.map((r) => '<li>' + r.title + ' (' + r.owner + ')</li>').join(''); }
f.addEventListener('submit', async (e) => { e.preventDefault(); await tasks.insert({ title: f.title.value, owner: f.owner.value, done: false }); f.reset(); load(); });
load();
</script></body></html>`,
}];

export const SALES_SEED: SeedFile[] = [{
  path: 'index.html',
  content: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monthly sales</title>
${manifest({ sales: { month: 'text', amount: 'number' } })}
<script src="/sdk/shareout.js"></script></head><body>
<h1>Monthly sales</h1>
<table id="t"><thead><tr><th>Month</th><th>Amount</th></tr></thead><tbody></tbody></table>
<script>
const sales = shareout.table('sales');
sales.list().then((rows) => { t.tBodies[0].innerHTML = rows.map((r) => '<tr><td>' + r.month + '</td><td>' + r.amount + '</td></tr>').join(''); });
</script></body></html>`,
}];

export const LANDING_SEED: SeedFile[] = [{
  path: 'index.html',
  content: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio</title>
<style>body{font-family:system-ui;margin:0}header,section{padding:48px 24px;max-width:720px;margin:auto}</style></head><body>
<header><h1>Studio</h1><p>We design simple, useful tools for small teams.</p></header>
<section><h2>What we do</h2><p>Planning boards, shared notes and weekly reports, made to fit the way your team already works.</p></section>
<section><h2>Contact</h2><p>Write to us and we will answer within one business day.</p></section>
</body></html>`,
}];
