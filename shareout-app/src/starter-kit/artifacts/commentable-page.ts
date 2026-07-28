import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const body = `
<article class="so-card">
  <h2 style="font-size:20px;margin-bottom:6px">What's new in v2.4</h2>
  <p class="so-muted" style="margin-bottom:14px">Posted June 23, 2026 · Product update</p>
  <p style="margin-bottom:12px">
    Pages now load faster and stay in sync across devices. We rebuilt the data
    layer so changes show up the moment they happen — no refresh, no waiting.
  </p>
  <p>
    We also cleaned up the editor: fewer clicks to publish, clearer error messages,
    and a tidier toolbar. Tell us what you think below — we read everything.
  </p>
</article>

<div class="so-card" style="margin-top:24px">
  <h2>Comments</h2>
  <div style="display:grid;gap:10px;margin-bottom:18px">
    <input class="so-input" id="who" placeholder="Your name (optional)" maxlength="60">
    <textarea class="so-input" id="text" placeholder="Add a comment…" rows="3" maxlength="500"></textarea>
    <div><button class="so-btn" id="post">Post comment</button></div>
  </div>
  <div id="thread" style="display:grid;gap:14px"></div>
</div>

<p class="so-muted" style="margin-top:16px">
  You can bolt a threaded comments section onto any page with <code>so.comments</code> —
  handy for feedback, approvals, and reviews.
</p>`;

const script = `
  const thread = document.getElementById('thread');

  function ago(iso){
    if(!iso) return '';
    const then = new Date(iso).getTime();
    if(isNaN(then)) return '';
    const secs = Math.round((Date.now() - then) / 1000);
    if(secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if(mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if(hrs < 24) return hrs + 'h ago';
    return new Date(iso).toLocaleDateString();
  }

  function render(rows){
    thread.innerHTML = '';
    if(!rows.length){
      const empty = document.createElement('p');
      empty.className = 'so-muted';
      empty.textContent = 'No comments yet — start the conversation.';
      thread.appendChild(empty);
      return;
    }
    rows.forEach(function(c){
      const item = document.createElement('div');
      const head = document.createElement('div');
      head.style.display = 'flex';
      head.style.gap = '8px';
      head.style.alignItems = 'baseline';
      const who = document.createElement('span');
      who.style.fontWeight = '650';
      who.style.fontSize = '14px';
      who.textContent = c.authorName || 'Anonymous';
      const when = document.createElement('span');
      when.className = 'so-muted';
      when.style.fontSize = '12px';
      when.textContent = ago(c.createdAt);
      head.appendChild(who);
      head.appendChild(when);
      const text = document.createElement('div');
      text.className = 'so-muted';
      text.style.marginTop = '2px';
      text.textContent = c.content;
      item.appendChild(head);
      item.appendChild(text);
      thread.appendChild(item);
    });
  }

  async function load(){
    const rows = await so.comments.find().exec();
    render(rows);
  }

  document.getElementById('post').addEventListener('click', async function(){
    const authorName = document.getElementById('who').value.trim();
    const content = document.getElementById('text').value.trim();
    if(!content) return;
    await so.comments.add({ content: content, authorName: authorName || undefined });
    document.getElementById('text').value = '';
    await load();
  });

  await load();`;

export const commentablePage: StarterArtifact = {
  slug: 'commentable-page',
  name: 'Commentable page',
  description: 'A published page with a threaded comments section underneath.',
  feature: 'so.comments',
  tier: 'personal',
  html: frame({
    title: 'Commentable page',
    feature: 'so.comments',
    description: 'Add a comments thread to any page — post, read, and reply.',
    body,
    script,
  }),
};
