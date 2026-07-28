import type { EditorContext } from '../editor/context';
import type { ViewportMode } from '../editor/types';
import { activateLasso } from '../lasso/lasso';
import { openPreview, publish } from '../persistence/draft';
import { openRailPanel } from '../rail/rail-panels';
import { openAssetsPicker } from '../workspace/assets-picker';

function toggleViewport(ctx: EditorContext): void {
  const btn = document.getElementById('btn-viewport');
  if (!btn) return;

  const current = ctx.state.viewport;
  const next: ViewportMode = current === 'desktop' ? 'mobile' : 'desktop';
  ctx.state.viewport = next;

  btn.dataset.viewport = next;

  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.classList.toggle('canvas-mobile', next === 'mobile');
  }
}

export function setupToolbarEvents(ctx: EditorContext): void {
  document.querySelectorAll<HTMLElement>('.toolbar-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.state.tool = btn.dataset.tool as typeof ctx.state.tool;
      document.querySelectorAll('.toolbar-btn[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      if (btn.dataset.tool === 'lasso') {
        activateLasso(ctx);
      }
    });
  });

  document.getElementById('btn-undo')?.addEventListener('click', () => ctx.undo());
  document.getElementById('btn-redo')?.addEventListener('click', () => ctx.redo());
  document.getElementById('btn-preview')?.addEventListener('click', () => openPreview(ctx));
  document.getElementById('btn-history')?.addEventListener('click', () => openRailPanel(ctx, 'history'));
  document.getElementById('btn-publish')?.addEventListener('click', () => publish(ctx));
  document.getElementById('btn-info')?.addEventListener('click', () => openRailPanel(ctx, 'details'));
  document.getElementById('btn-outline')?.addEventListener('click', () => openRailPanel(ctx, 'outline'));
  document.getElementById('btn-validation')?.addEventListener('click', () => openRailPanel(ctx, 'validation'));
  document.getElementById('btn-share')?.addEventListener('click', () => openRailPanel(ctx, 'share'));
  document.getElementById('btn-metrics')?.addEventListener('click', () => openRailPanel(ctx, 'metrics'));
  document.getElementById('btn-inbox')?.addEventListener('click', () => openRailPanel(ctx, 'inbox'));
  document.getElementById('btn-viewport')?.addEventListener('click', () => toggleViewport(ctx));
  document.getElementById('btn-assets')?.addEventListener('click', () => openAssetsPicker(ctx));

  document.getElementById('btn-favorite')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const on = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!on));
    btn.classList.toggle('active', !on);
    btn.dataset.fav = on ? '0' : '1';
  });
}
