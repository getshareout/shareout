import type { EditorContext } from '../editor/context';
import { renderSelectionHandles } from '../canvas/selection';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndo } from '../history/undo-redo';
import { setChatState } from '../chat/chat';
import { activateLasso } from '../lasso/lasso';
import { hideFloatingMenu } from '../canvas/selection';
import { markDirty, saveDraft } from '../persistence/draft';
import {
  toggleStyle,
  duplicateElement,
  nudgeElement,
  resizeElement,
} from '../elements/manipulation';
import { showShortcutsHelp } from './shortcuts-help';

export function setupKeyboardShortcuts(ctx: EditorContext): void {
  const isInputFocused = () => {
    const active = document.activeElement;
    return (
      active &&
      (active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        (active as HTMLElement).contentEditable === 'true')
    );
  };

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 'z':
          e.preventDefault();
          e.shiftKey ? ctx.redo() : ctx.undo();
          break;
        case 's':
          e.preventDefault();
          saveDraft(ctx);
          break;
        case 'p':
          e.preventDefault();
          document.getElementById('btn-preview')?.click();
          break;
        case 'Enter':
          if (e.shiftKey) {
            e.preventDefault();
            document.getElementById('btn-publish')?.click();
          }
          break;
        case 'b':
          if (!isInputFocused() && ctx.state.selectedElement) {
            e.preventDefault();
            toggleStyle(ctx, ctx.state.selectedElement as HTMLElement, 'fontWeight', 'bold', 'normal');
          }
          break;
        case 'i':
          if (!isInputFocused() && ctx.state.selectedElement) {
            e.preventDefault();
            toggleStyle(ctx, ctx.state.selectedElement as HTMLElement, 'fontStyle', 'italic', 'normal');
          }
          break;
        case 'u':
          if (!isInputFocused() && ctx.state.selectedElement) {
            e.preventDefault();
            toggleStyle(
              ctx,
              ctx.state.selectedElement as HTMLElement,
              'textDecoration',
              'underline',
              'none'
            );
          }
          break;
        case 'd':
          if (!isInputFocused() && ctx.state.selectedElement) {
            e.preventDefault();
            duplicateElement(ctx, ctx.state.selectedElement as HTMLElement);
          }
          break;
      }
      return;
    }

    if (isInputFocused()) return;

    switch (e.key) {
      case 'v':
      case 'Escape':
        ctx.state.tool = 'select';
        updateToolbarState(ctx);
        break;
      case 'l':
        activateLasso(ctx);
        break;
      case 'Delete':
      case 'Backspace':
        if (
          ctx.state.selectedElement &&
          ctx.state.selectedElement !== ctx.dom.canvasFrame?.contentDocument?.body
        ) {
          e.preventDefault();
          pushUndo(ctx.state);
          ctx.state.selectedElement.remove();
          ctx.state.selectedElement = null;
          renderSelectionHandles(null, ctx.dom);
          hideFloatingMenu(ctx.dom);
          markDirty(ctx);
          syncHtmlFromCanvas(ctx);
        }
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (ctx.state.selectedElement) {
          e.preventDefault();
          if (e.altKey) {
            resizeElement(ctx, ctx.state.selectedElement as HTMLElement, e.key === 'ArrowUp' ? 'up' : 'down', e.shiftKey ? 5 : 1);
          } else {
            nudgeElement(ctx, ctx.state.selectedElement as HTMLElement, e.key, e.shiftKey ? 10 : 1);
          }
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (ctx.state.selectedElement) {
          e.preventDefault();
          nudgeElement(ctx, ctx.state.selectedElement as HTMLElement, e.key, e.shiftKey ? 10 : 1);
        }
        break;
      case '/':
        e.preventDefault();
        setChatState(ctx, 'focused');
        ctx.dom.chatInput?.focus();
        break;
      case '?':
        if (e.shiftKey) {
          e.preventDefault();
          showShortcutsHelp(ctx);
        }
        break;
    }
  });
}

export function updateToolbarState(ctx: EditorContext): void {
  document.querySelectorAll<HTMLElement>('.toolbar-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === ctx.state.tool);
  });
}
