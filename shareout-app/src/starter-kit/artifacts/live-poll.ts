import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const body = `
<div class="so-card">
  <h2>What should we build next?</h2>
  <div id="options" style="display:grid;gap:10px"></div>
</div>
<div class="so-card" style="margin-top:16px">
  <h2>Results</h2>
  <div id="results" style="display:grid;gap:14px"></div>
  <p id="total" class="so-muted" style="margin-top:14px">No votes yet.</p>
</div>
<p class="so-muted" style="margin-top:16px">
  Tallies live in one <code>so.json</code> key and increment atomically, so results update
  live for everyone the moment a vote lands. The same pattern powers reactions, star
  ratings, and surveys.
</p>`;

const script = `
  const OPTIONS = ['Mobile app', 'Dark mode', 'API access', 'Team workspaces'];
  const TALLY_KEY = 'poll-tallies';
  const VOTED_FLAG = 'live-poll-voted';

  const optionsEl = document.getElementById('options');
  const resultsEl = document.getElementById('results');
  const totalEl = document.getElementById('total');

  let voted = localStorage.getItem(VOTED_FLAG) || null;

  function renderButtons(){
    optionsEl.innerHTML = '';
    OPTIONS.forEach(function(opt){
      const btn = document.createElement('button');
      btn.className = voted ? 'so-btn ghost' : 'so-btn';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.textContent = voted === opt ? opt + ' — your pick' : opt;
      btn.disabled = !!voted;
      btn.addEventListener('click', function(){ vote(opt); });
      optionsEl.appendChild(btn);
    });
  }

  function renderResults(tallies){
    const total = OPTIONS.reduce(function(sum, opt){ return sum + (tallies[opt] || 0); }, 0);
    resultsEl.innerHTML = '';
    OPTIONS.forEach(function(opt){
      const count = tallies[opt] || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;

      const row = document.createElement('div');

      const label = document.createElement('div');
      label.style.display = 'flex';
      label.style.justifyContent = 'space-between';
      label.style.fontSize = '13.5px';
      label.style.marginBottom = '5px';
      const name = document.createElement('span');
      name.style.fontWeight = '600';
      name.textContent = opt;
      const stat = document.createElement('span');
      stat.className = 'so-muted';
      stat.textContent = count + ' (' + pct + '%)';
      label.appendChild(name);
      label.appendChild(stat);

      const track = document.createElement('div');
      track.style.height = '12px';
      track.style.background = 'var(--so-blue-light)';
      track.style.borderRadius = '999px';
      track.style.overflow = 'hidden';
      const fill = document.createElement('div');
      fill.style.height = '100%';
      fill.style.width = pct + '%';
      fill.style.background = 'var(--so-blue)';
      fill.style.borderRadius = '999px';
      fill.style.transition = 'width .4s ease';
      track.appendChild(fill);

      row.appendChild(label);
      row.appendChild(track);
      resultsEl.appendChild(row);
    });
    totalEl.textContent = total === 1 ? '1 vote so far.' : total + ' votes so far.';
  }

  async function load(){
    const tallies = (await so.json.get(TALLY_KEY)) || {};
    renderResults(tallies);
  }

  async function vote(opt){
    if(voted) return;
    voted = opt;
    localStorage.setItem(VOTED_FLAG, opt);
    renderButtons();

    const tallies = await so.json.update(TALLY_KEY, function(current){
      const next = current || {};
      next[opt] = (next[opt] || 0) + 1;
      return next;
    });
    renderResults(tallies);
  }

  renderButtons();
  await load();`;

export const livePoll: StarterArtifact = {
  slug: 'live-poll',
  name: 'Live poll',
  description: 'A one-question poll with live bar-chart results — vote and watch it move.',
  feature: 'realtime votes',
  tier: 'personal',
  html: frame({
    title: 'Live poll',
    feature: 'realtime votes',
    description: 'Vote on one question and see results update live as a bar chart.',
    body,
    script,
  }),
};
