import { generateViewerShell, type ViewerContext } from './viewer-shell';
import { colors } from '../design-system/tokens';
import { parseMarkdown, MARKDOWN_VIEWER_STYLES } from './markdown-viewer';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Skill viewer: the markdown body plus a marketplace chrome bar (summary, category,
// tags, version, install/upvote with live counts). Action buttons are shown only to
// workspace members (skillMetrics.canAct); everyone else sees read-only counts.
export function renderSkillViewer(ctx: ViewerContext): string {
  const meta = ctx.typeMetadata.skill;
  const m = ctx.skillMetrics;
  const html = parseMarkdown(ctx.content);

  const chips = [
    meta?.category ? `<span class="sk-chip">${escapeHtml(meta.category)}</span>` : '',
    meta?.version ? `<span class="sk-chip">v${escapeHtml(meta.version)}</span>` : '',
    ...(meta?.tags ?? []).map(t => `<span class="sk-chip sk-tag">${escapeHtml(t)}</span>`),
  ].join('');

  const canAct = !!m?.canAct;
  const metricsBar = m ? `
    <div class="sk-metrics">
      <button class="sk-btn sk-vote${m.voted ? ' active' : ''}" id="sk-vote"${canAct ? '' : ' disabled'} onclick="skVote()" title="Upvote">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${m.voted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>
        <span id="sk-vote-n">${m.upvotes}</span>
      </button>
      <button class="sk-btn sk-install${m.installed ? ' active' : ''}" id="sk-install"${canAct ? '' : ' disabled'} onclick="skInstall()" title="${m.installed ? 'Saved to My Skills' : 'Save to My Skills'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${m.installed ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        <span id="sk-install-label">${m.installed ? 'Saved' : 'Save'}</span>
      </button>
      <span class="sk-stat" title="Attached to artifacts">⚲ ${m.attaches}</span>
      <span class="sk-stat" title="Uses by agents">↻ ${m.uses}</span>
    </div>` : '';

  const bodyContent = `
    <div class="skill-viewer">
      <div class="sk-head">
        <h1 class="sk-title">${escapeHtml(ctx.artifactName)}</h1>
        ${meta?.summary ? `<p class="sk-summary">${escapeHtml(meta.summary)}</p>` : ''}
        ${chips ? `<div class="sk-chips">${chips}</div>` : ''}
        ${metricsBar}
      </div>
      <article class="content">${html}</article>
    </div>
  `;

  const extraStyles = `
    ${MARKDOWN_VIEWER_STYLES}
    .skill-viewer { max-width: 860px; margin: 0 auto; }
    .sk-head {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .sk-title { font: 700 24px var(--font-display); margin: 0 0 8px; }
    .sk-summary { color: var(--text-muted); margin: 0 0 14px; }
    .sk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
    .sk-chip {
      font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 999px;
      background: var(--code-bg); color: var(--text-muted);
    }
    .sk-chip.sk-tag { background: transparent; border: 1px solid var(--border); }
    .sk-metrics { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .sk-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px;
      border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--bg); color: var(--text); font: 500 13px var(--font-body); cursor: pointer;
      transition: all .15s;
    }
    .sk-btn:hover:not(:disabled) { border-color: var(--text-muted); }
    .sk-btn:disabled { opacity: .55; cursor: default; }
    .sk-btn.sk-vote.active { color: var(--primary); border-color: var(--primary); }
    .sk-btn.sk-install.active { color: ${colors.success}; border-color: ${colors.success}; }
    .sk-stat { font-size: 13px; color: var(--text-muted); padding: 0 4px; }
    .content { background: var(--surface); padding: 32px; border-radius: 12px; border: 1px solid var(--border); }
  `;

  const extraHead = m && m.canAct ? `<script>
    var SK_ID = ${JSON.stringify(ctx.artifactId)};
    var SK_BASE = ${JSON.stringify(ctx.baseUrl)};
    function skVote() {
      var b = document.getElementById('sk-vote'); if (!b || b.disabled) return;
      var on = b.classList.contains('active'); b.disabled = true;
      fetch(SK_BASE + '/v1/artifacts/' + SK_ID + '/skill/vote', { method: on ? 'DELETE' : 'POST', credentials: 'include' })
        .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
        .then(function(d){ b.classList.toggle('active', !on); var n = document.getElementById('sk-vote-n'); if (n) n.textContent = d.upvotes;
          var svg = b.querySelector('svg'); if (svg) svg.setAttribute('fill', !on ? 'currentColor' : 'none'); })
        .catch(function(){}).finally(function(){ b.disabled = false; });
    }
    function skInstall() {
      var b = document.getElementById('sk-install'); if (!b || b.disabled) return;
      var on = b.classList.contains('active'); b.disabled = true;
      fetch(SK_BASE + '/v1/artifacts/' + SK_ID + '/skill/install', { method: on ? 'DELETE' : 'POST', credentials: 'include' })
        .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
        .then(function(){ b.classList.toggle('active', !on);
          var svg = b.querySelector('svg'); if (svg) svg.setAttribute('fill', !on ? 'currentColor' : 'none');
          var lbl = document.getElementById('sk-install-label'); if (lbl) lbl.textContent = !on ? 'Saved' : 'Save'; })
        .catch(function(){}).finally(function(){ b.disabled = false; });
    }
  </script>` : undefined;

  return generateViewerShell(ctx, bodyContent, extraHead, extraStyles);
}
