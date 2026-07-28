import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `
<style>
  .wa-grid{display:grid;gap:16px}
  .wa-tag{display:inline-block;font-size:11px;font-weight:600;color:var(--so-blue);
    background:var(--so-blue-light);border-radius:999px;padding:3px 10px;margin-bottom:10px}
  .wa-card h2{font-size:16px;margin:0 0 6px}
  .wa-list{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
  .wa-list li{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;color:var(--so-ink-2)}
  .wa-list li b{color:var(--so-ink);font-weight:600}
  .wa-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--so-blue);margin-top:7px}
  .wa-bridge{display:flex;gap:14px;align-items:center;background:var(--so-blue-light);
    border:1px solid #dbeafe;border-radius:var(--so-radius);padding:16px 18px;margin:16px 0}
  .wa-bridge .wa-ico{flex:0 0 auto;width:30px;height:30px;border-radius:8px;background:#fff;
    color:var(--so-blue);display:grid;place-items:center;font-weight:700}
  .wa-bridge p{margin:0;font-size:13.5px;color:var(--so-ink)}
  @media(min-width:620px){.wa-grid{grid-template-columns:1fr 1fr}}
</style>`;

const body = `
<div class="wa-grid">
  <div class="so-card wa-card">
    <span class="wa-tag">Workspace assistant</span>
    <h2>An AI that knows your team</h2>
    <p class="so-muted" style="margin:0">A chat helper on your workspace home. It has your house
      style and your pages in context, so it can answer for the whole team and build on-brand from
      a prompt — no blank page.</p>
    <ul class="wa-list">
      <li><span class="wa-dot"></span><span><b>Orientation</b> — lists your pages, connectors, and members.</span></li>
      <li><span class="wa-dot"></span><span><b>Read-only answers</b> — runs SELECT queries on connectors you've opened to it.</span></li>
      <li><span class="wa-dot"></span><span><b>Proposes, then confirms</b> — suggests a schedule or build, waits for your yes.</span></li>
    </ul>
  </div>

  <div class="so-card wa-card">
    <span class="wa-tag">Skill marketplace</span>
    <h2>Playbooks you publish once</h2>
    <p class="so-muted" style="margin:0">Reusable skills — short markdown playbooks for how your
      team does things. Publish one, then attach it to any artifact so the authoring agent follows
      your conventions instead of guessing.</p>
    <ul class="wa-list">
      <li><span class="wa-dot"></span><span><b>Write it down</b> — "how we brand dashboards", "our chart rules".</span></li>
      <li><span class="wa-dot"></span><span><b>Browse and save</b> — the team catalog lives in Skill Market.</span></li>
      <li><span class="wa-dot"></span><span><b>Attach per artifact</b> — the editing agent reads it while it works.</span></li>
    </ul>
  </div>
</div>

<div class="wa-bridge">
  <div class="wa-ico">+</div>
  <p><b>How they work together:</b> the assistant pulls in your skills and house style, so what it
    produces already follows your team's conventions — on-brand, the first time.</p>
</div>

<p class="so-muted">
  Both are Teams features. Together they mean every teammate — not just your best builder — turns
  out work that looks and behaves like it came from your team, instead of starting from a blank
  page. Available on request: ask ShareOut to turn them on for your workspace.
</p>`;

export const workspaceAssistant: StarterArtifact = {
  slug: 'workspace-assistant',
  name: 'Workspace assistant + skills',
  description: 'A workspace AI that knows your house style, plus reusable skills your team attaches to artifacts.',
  feature: 'workspace AI + skills',
  tier: 'team',
  html: frame({
    title: 'Workspace assistant + skills',
    feature: 'workspace AI + skills',
    description: 'Two Teams features that make every teammate produce on-brand work.',
    head,
    body,
    script: '',
  }),
};
