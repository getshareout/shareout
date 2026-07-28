import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `<style>
  .kb-board{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:4px}
  .kb-col{background:var(--so-bg);border:1px solid var(--so-border);border-radius:var(--so-radius);padding:12px}
  .kb-col h2{display:flex;justify-content:space-between;align-items:center;margin:0 0 10px}
  .kb-count{font-size:11px;font-weight:600;color:var(--so-ink-3);background:var(--so-surface);border:1px solid var(--so-border);border-radius:999px;padding:1px 8px}
  .kb-card{background:var(--so-surface);border:1px solid var(--so-border);border-radius:10px;padding:10px 12px;margin-bottom:8px}
  .kb-card-title{font-size:13.5px;line-height:1.35;word-break:break-word}
  .kb-card-actions{display:flex;gap:6px;margin-top:8px;align-items:center}
  .kb-iconbtn{appearance:none;border:1px solid var(--so-border);background:var(--so-surface);color:var(--so-ink-2);
    cursor:pointer;font:inherit;font-size:13px;line-height:1;border-radius:8px;padding:3px 8px}
  .kb-iconbtn:hover{color:var(--so-ink);border-color:var(--so-ink-3)}
  .kb-iconbtn:disabled{opacity:.35;cursor:default}
  .kb-iconbtn.del{margin-left:auto;color:var(--so-ink-3)}
  .kb-iconbtn.del:hover{color:#b91c1c;border-color:#fca5a5}
  .kb-empty{font-size:12.5px;color:var(--so-ink-3);padding:4px 2px}
  .kb-add{display:grid;grid-template-columns:1fr auto;gap:8px;margin:4px 0 18px}
  @media(max-width:640px){.kb-board{grid-template-columns:1fr}}
</style>`;

const body = `
<div class="kb-add">
  <input class="so-input" id="kb-title" placeholder="Add a card to To do…" maxlength="140">
  <button class="so-btn" id="kb-add">Add card</button>
</div>
<div class="kb-board">
  <div class="kb-col"><h2>To do <span class="kb-count" id="kb-count-todo">0</span></h2><div id="kb-col-todo"></div></div>
  <div class="kb-col"><h2>Doing <span class="kb-count" id="kb-count-doing">0</span></h2><div id="kb-col-doing"></div></div>
  <div class="kb-col"><h2>Done <span class="kb-count" id="kb-count-done">0</span></h2><div id="kb-col-done"></div></div>
</div>
<p class="so-muted" style="margin-top:6px">
  Each card is a row in <code>so.table('cards')</code> — a real database, no setup. And
  <code>so.realtime</code> keeps the board in sync for everyone viewing at once: move a card here and it
  moves on their screen too. That pair — a table for the data, realtime for the sync — is the foundation
  for any collaborative tool.
</p>`;

const script = `
  const cards = so.table('cards');
  const order = ['todo','doing','done'];
  const labels = { todo:'To do', doing:'Doing', done:'Done' };

  const sync = so.realtime('kanban-board');
  await sync.connect();
  const signal = sync.map('board');
  signal.observe(function(){ load(); });

  function broadcast(){
    try { signal.set('rev', Date.now()); } catch (e) {}
  }

  function render(rows){
    order.forEach(function(status){
      const col = document.getElementById('kb-col-' + status);
      const group = rows.filter(function(r){ return r.status === status; });
      document.getElementById('kb-count-' + status).textContent = String(group.length);
      col.innerHTML = '';
      if (!group.length){
        const empty = document.createElement('div');
        empty.className = 'kb-empty';
        empty.textContent = 'Nothing here yet.';
        col.appendChild(empty);
        return;
      }
      const idx = order.indexOf(status);
      group.forEach(function(r){
        const card = document.createElement('div');
        card.className = 'kb-card';

        const title = document.createElement('div');
        title.className = 'kb-card-title';
        title.textContent = r.title;
        card.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'kb-card-actions';

        const left = document.createElement('button');
        left.className = 'kb-iconbtn';
        left.type = 'button';
        left.textContent = '←';
        left.title = 'Move left';
        left.disabled = idx === 0;
        left.addEventListener('click', function(){ move(r.id, order[idx - 1]); });

        const right = document.createElement('button');
        right.className = 'kb-iconbtn';
        right.type = 'button';
        right.textContent = '→';
        right.title = 'Move right';
        right.disabled = idx === order.length - 1;
        right.addEventListener('click', function(){ move(r.id, order[idx + 1]); });

        const del = document.createElement('button');
        del.className = 'kb-iconbtn del';
        del.type = 'button';
        del.textContent = 'Delete';
        del.addEventListener('click', function(){ remove(r.id); });

        actions.appendChild(left);
        actions.appendChild(right);
        actions.appendChild(del);
        card.appendChild(actions);
        col.appendChild(card);
      });
    });
  }

  async function load(){
    const rows = await cards.find().sort('created_at','asc').exec();
    render(rows);
  }

  async function move(id, status){
    await cards.updateById(id, { status: status });
    broadcast();
    await load();
  }

  async function remove(id){
    await cards.deleteById(id);
    broadcast();
    await load();
  }

  async function add(){
    const input = document.getElementById('kb-title');
    const title = input.value.trim();
    if (!title) return;
    await cards.insert({ title: title, status: 'todo', created_at: Date.now() });
    input.value = '';
    broadcast();
    await load();
  }

  document.getElementById('kb-add').addEventListener('click', add);
  document.getElementById('kb-title').addEventListener('keydown', function(e){
    if (e.key === 'Enter') add();
  });

  const count = await cards.count();
  if (count === 0){
    const seed = [
      { title: 'Sketch the idea', status: 'todo' },
      { title: 'Share it with a friend', status: 'todo' },
      { title: 'Wire up the data', status: 'doing' },
      { title: 'Publish to ShareOut', status: 'done' }
    ];
    let t = Date.now();
    for (let i = 0; i < seed.length; i++){
      await cards.insert({ title: seed[i].title, status: seed[i].status, created_at: t + i });
    }
    broadcast();
  }

  await load();`;

export const kanbanBoard: StarterArtifact = {
  slug: 'kanban-board',
  name: 'Kanban board',
  description: 'A three-column board where every card is a row, kept in sync for everyone watching.',
  feature: 'so.table + so.realtime',
  tier: 'personal',
  html: frame({
    title: 'Kanban board',
    feature: 'so.table + so.realtime',
    description: 'Move cards across To do, Doing, and Done — synced live across every open tab.',
    head,
    body,
    script,
  }),
};
