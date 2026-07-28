import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const body = `
<div class="so-card" style="text-align:center">
  <div class="so-muted" style="text-transform:uppercase;letter-spacing:.08em;font-size:11px;font-weight:600">Visits so far</div>
  <div id="count" style="font-size:64px;font-weight:700;letter-spacing:-.03em;margin:8px 0 4px">—</div>
  <p class="so-muted" id="hint">Counting…</p>
  <button class="so-btn ghost" id="reset">Reset to zero</button>
</div>
<p class="so-muted" style="margin-top:16px">
  The number lives in <code>so.json</code> — a tiny key/value store saved on the server.
  Reload the page, or open it on another device: the count is the same for everyone.
  That's the difference between a static HTML file and a ShareOut artifact.
</p>`;

const script = `
  const el = document.getElementById('count');
  const hint = document.getElementById('hint');
  // update() reads the current value and writes the new one atomically.
  const count = await so.json.update('visits', function(n){ return (n || 0) + 1; });
  el.textContent = String(count);
  hint.textContent = count === 1 ? 'You are the first visitor.' : 'Includes your visit just now.';
  document.getElementById('reset').addEventListener('click', async function(){
    await so.json.set('visits', 0);
    el.textContent = '0';
    hint.textContent = 'Back to zero.';
  });`;

export const visitorCounter: StarterArtifact = {
  slug: 'visitor-counter',
  name: 'Visitor counter',
  description: 'A number that remembers itself across reloads and visitors.',
  feature: 'so.json',
  tier: 'personal',
  html: frame({
    title: 'Visitor counter',
    feature: 'so.json',
    description: 'Stores one value on the server — the simplest kind of ShareOut data.',
    body,
    script,
  }),
};
