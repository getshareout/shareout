import { frame } from '../frame';
import type { StarterArtifact } from '../types';

const head = `<style>
.pa-grid{display:grid;gap:14px}
.pa-steps{display:grid;gap:10px;margin:4px 0 0}
@media(min-width:620px){.pa-steps{grid-template-columns:repeat(4,1fr);align-items:stretch}}
.pa-step{position:relative;background:var(--so-bg);border:1px solid var(--so-border);
  border-radius:12px;padding:14px 14px 16px}
.pa-step .pa-n{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;
  background:var(--so-blue-light);color:var(--so-blue);font-weight:700;font-size:13px;margin-bottom:8px}
.pa-step h3{margin:0 0 4px;font-size:13.5px;letter-spacing:-.01em}
.pa-step p{margin:0;color:var(--so-ink-2);font-size:12.5px;line-height:1.45}
.pa-tag{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px;margin-top:8px}
.pa-tag.team{background:#fef3c7;color:#92400e}
.pa-tag.live{background:#dcfce7;color:#166534}
.pa-mode{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--so-border);
  border-radius:12px;background:var(--so-surface)}
.pa-mode .pa-key{flex:0 0 auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12px;font-weight:600;color:var(--so-blue);background:var(--so-blue-light);
  border-radius:7px;padding:4px 8px}
.pa-mode h3{margin:0 0 3px;font-size:14px}
.pa-mode p{margin:0;color:var(--so-ink-2);font-size:13px}
.pa-path{font-size:13px;color:var(--so-ink-2)}
.pa-path code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
  background:var(--so-bg);border:1px solid var(--so-border);border-radius:6px;padding:1px 6px}
</style>`;

const body = `
<div class="so-card">
  <h2>Approve before it goes public</h2>
  <p class="so-muted" style="margin:0">
    On a Teams workspace, an admin can require teammate sign-off before any member
    takes an artifact public. Until it's approved, the artifact stays
    visible to your workspace only — nobody outside the team can open it.
  </p>
</div>

<h2 style="margin:24px 0 12px">How a publish flows</h2>
<div class="pa-steps">
  <div class="pa-step">
    <div class="pa-n">1</div>
    <h3>Member publishes</h3>
    <p>A teammate sets visibility to public.</p>
  </div>
  <div class="pa-step">
    <div class="pa-n">2</div>
    <h3>Held + request sent</h3>
    <p>The gate keeps it workspace-only and asks the chosen approvers to review.</p>
    <span class="pa-tag team">workspace only</span>
  </div>
  <div class="pa-step">
    <div class="pa-n">3</div>
    <h3>Teammates approve</h3>
    <p>Every nominated approver has to approve. One rejection ends the request.</p>
  </div>
  <div class="pa-step">
    <div class="pa-n">4</div>
    <h3>Goes public</h3>
    <p>The artifact flips to the requested visibility and the live link works for the world.</p>
    <span class="pa-tag live">public</span>
  </div>
</div>
<p class="so-muted" style="margin:12px 0 0">
  Approval is tied to the content — re-publishing an unchanged artifact stays approved.
  Owners and admins skip the gate; personal artifacts (outside a workspace) are never gated.
</p>

<h2 style="margin:24px 0 12px">Where admins turn it on</h2>
<div class="pa-grid">
  <p class="pa-path" style="margin:0">
    <strong>Admin &rarr; Publishing</strong> in your workspace settings. Pick one policy:
  </p>
  <div class="pa-mode">
    <div class="pa-key">prohibit</div>
    <div>
      <h3>Keep everything internal</h3>
      <p>Members can't make workspace artifacts public at all — visibility is held to the workspace.</p>
    </div>
  </div>
  <div class="pa-mode">
    <div class="pa-key">require_approval</div>
    <div>
      <h3>Require N approvals</h3>
      <p>Set how many teammates must sign off (1&ndash;10). The publisher nominates exactly that many approvers, and all of them have to approve.</p>
    </div>
  </div>
  <p class="pa-path" style="margin:0">
    The default is <code>allow</code>: no team gate, though ShareOut's own safety review
    still runs the first time something goes public.
  </p>
</div>

<p class="so-muted" style="margin-top:24px">
  This keeps the team in control of what represents them in public — a public link always
  passed through someone — without slowing down everyday internal sharing, which stays
  one click for everyone.
</p>`;

export const publishApprovals: StarterArtifact = {
  slug: 'publish-approvals',
  name: 'Publish approvals',
  description: 'Require teammate sign-off before a workspace artifact goes public.',
  feature: 'publish governance',
  tier: 'team',
  html: frame({
    title: 'Publish approvals',
    feature: 'publish governance',
    description: 'How Teams workspaces gate public publishing behind teammate approval.',
    head,
    body,
    script: '',
  }),
};
