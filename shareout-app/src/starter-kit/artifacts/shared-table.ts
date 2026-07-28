import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const body = `
<div class="so-card">
  <h2>Add to the roster</h2>
  <div style="display:grid;gap:10px">
    <input class="so-input" id="name" placeholder="Name" maxlength="60">
    <input class="so-input" id="role" placeholder="Role — e.g. Designer" maxlength="60">
    <div><button class="so-btn" id="add">Add person</button></div>
    <p class="so-muted" id="status" style="margin:0"></p>
  </div>
</div>
<h2 style="margin:24px 0 12px">Team directory</h2>
<div id="list" style="display:grid;gap:10px"></div>
<p class="so-muted" style="margin-top:20px">
  This roster lives in a <strong>workspace-shared table</strong>. In a Teams workspace a table
  can be shared so several artifacts read and write the same rows — one source of truth across
  your team's tools. The intake form here and a dashboard somewhere else see the same list.
  Share a table in one line from the artifact that owns it:
</p>
<pre class="so-card" style="margin-top:10px;overflow:auto;font-size:13px"><code>await so.workspace.shareTable('team_directory', { access: 'readwrite' });
// any other artifact: so.workspace.table('team_directory')</code></pre>`;

const script = `
  const SHARED = 'team_directory';
  const listEl = document.getElementById('list');
  const statusEl = document.getElementById('status');

  // The owning artifact shares its table with the workspace, read/write, so
  // every artifact here reads and writes the same rows. The owner always has
  // access; this call is a no-op if the table is already shared.
  let dir;
  try {
    await so.workspace.shareTable(SHARED, { access: 'readwrite' });
    dir = so.workspace.table(SHARED);
  } catch (e) {
    // Not in a Teams workspace (or sharing unavailable) — fall back to a private
    // table so the example still runs. The explainer below is the real lesson.
    dir = so.table(SHARED);
  }

  function render(rows) {
    if (!rows.length) {
      listEl.innerHTML = '<p class="so-muted">No one yet — add the first person.</p>';
      return;
    }
    listEl.innerHTML = '';
    rows.forEach(function (r) {
      const card = document.createElement('div');
      card.className = 'so-card';
      card.style.padding = '14px 16px';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';
      card.style.gap = '12px';

      const left = document.createElement('div');
      const who = document.createElement('div');
      who.style.fontWeight = '650';
      who.style.fontSize = '14px';
      who.textContent = r.name || 'Unnamed';
      const role = document.createElement('div');
      role.className = 'so-muted';
      role.style.marginTop = '2px';
      role.textContent = r.role || '';
      left.appendChild(who);
      left.appendChild(role);

      const del = document.createElement('button');
      del.className = 'so-btn ghost';
      del.style.padding = '6px 10px';
      del.style.fontSize = '13px';
      del.textContent = 'Remove';
      del.addEventListener('click', async function () {
        await dir.deleteById(r.id);
        await load();
      });

      card.appendChild(left);
      card.appendChild(del);
      listEl.appendChild(card);
    });
  }

  async function load() {
    const rows = await dir.find().sort('created_at', 'asc').exec();
    render(rows);
  }

  async function seed() {
    if ((await dir.count()) > 0) return;
    const now = Date.now();
    await dir.insert({ name: 'Ada Lovelace', role: 'Engineering', created_at: now });
    await dir.insert({ name: 'Grace Hopper', role: 'Engineering', created_at: now + 1 });
    await dir.insert({ name: 'Maya Lin', role: 'Design', created_at: now + 2 });
  }

  document.getElementById('add').addEventListener('click', async function () {
    const name = document.getElementById('name').value.trim();
    const role = document.getElementById('role').value.trim();
    if (!name) { statusEl.textContent = 'Add a name first.'; return; }
    await dir.insert({ name: name, role: role, created_at: Date.now() });
    document.getElementById('name').value = '';
    document.getElementById('role').value = '';
    statusEl.textContent = 'Added ' + name + ' to the shared roster.';
    await load();
  });

  await seed();
  await load();`;

export const sharedTable: StarterArtifact = {
  slug: 'shared-table',
  name: 'Shared team directory',
  description: 'One roster, shared across the workspace so every artifact reads the same data.',
  feature: 'workspace.table',
  tier: 'team',
  html: frame({
    title: 'Shared team directory',
    feature: 'workspace.table',
    description: 'A roster every artifact in the workspace reads and writes — one source of truth.',
    body,
    script,
  }),
};
