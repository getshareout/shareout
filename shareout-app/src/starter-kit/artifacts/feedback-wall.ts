import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const body = `
<div class="so-card">
  <h2>Leave a note</h2>
  <div style="display:grid;gap:10px">
    <input class="so-input" id="name" placeholder="Your name" maxlength="60">
    <textarea class="so-input" id="msg" placeholder="Say something nice…" rows="3" maxlength="280"></textarea>
    <div><button class="so-btn" id="send">Post note</button></div>
  </div>
</div>
<h2 style="margin:24px 0 12px">Wall</h2>
<div id="wall" style="display:grid;gap:10px"></div>
<p class="so-muted" style="margin-top:16px">
  Every note is a row in a <code>so.table</code> — a real database, no setup. Anyone who can
  open this page can post, and the wall updates for everyone. Forms, signups, guestbooks,
  RSVPs all work this way.
</p>`;

const script = `
  const messages = so.table('messages');
  const wall = document.getElementById('wall');

  function render(rows){
    if(!rows.length){ wall.innerHTML = '<p class="so-muted">No notes yet — be the first.</p>'; return; }
    wall.innerHTML = '';
    rows.forEach(function(r){
      const card = document.createElement('div');
      card.className = 'so-card';
      card.style.padding = '14px 16px';
      const who = document.createElement('div');
      who.style.fontWeight = '650';
      who.style.fontSize = '14px';
      who.textContent = r.name || 'Anonymous';
      const txt = document.createElement('div');
      txt.className = 'so-muted';
      txt.style.marginTop = '2px';
      txt.textContent = r.message;
      card.appendChild(who); card.appendChild(txt);
      wall.appendChild(card);
    });
  }

  async function load(){
    const rows = await messages.find().sort('created_at','desc').limit(50).exec();
    render(rows);
  }

  document.getElementById('send').addEventListener('click', async function(){
    const name = document.getElementById('name').value.trim();
    const message = document.getElementById('msg').value.trim();
    if(!message) return;
    await messages.insert({ name: name, message: message, created_at: Date.now() });
    document.getElementById('msg').value = '';
    await load();
  });

  await load();`;

export const feedbackWall: StarterArtifact = {
  slug: 'feedback-wall',
  name: 'Feedback wall',
  description: 'A public note wall — every post is a row in a real database.',
  feature: 'so.table',
  tier: 'personal',
  html: frame({
    title: 'Feedback wall',
    feature: 'so.table',
    description: 'Collect and list submissions with a database that needs no setup.',
    body,
    script,
  }),
};
