import type { EditorContext } from '../editor/context';

export function showShortcutsHelp(_ctx: EditorContext): void {
  const shortcuts = [
    ['Cmd/Ctrl + Z', 'Undo'],
    ['Cmd/Ctrl + Shift + Z', 'Redo'],
    ['Cmd/Ctrl + S', 'Save draft'],
    ['Cmd/Ctrl + P', 'Preview'],
    ['Cmd/Ctrl + Shift + Enter', 'Publish'],
    ['Cmd/Ctrl + B', 'Bold'],
    ['Cmd/Ctrl + I', 'Italic'],
    ['Cmd/Ctrl + U', 'Underline'],
    ['Cmd/Ctrl + D', 'Duplicate'],
    ['V / Escape', 'Select tool'],
    ['L', 'Lasso tool'],
    ['Delete', 'Delete selected'],
    ['Arrow keys', 'Nudge element'],
    ['Shift + Arrow', 'Nudge 10px'],
    ['Alt + ↑/↓', 'Resize element'],
    ['Alt + Shift + ↑/↓', 'Resize 5x'],
    ['/', 'Open chat'],
    ['?', 'This help'],
  ];

  const modal = document.createElement('div');
  modal.className = 'shortcuts-modal';
  modal.innerHTML = `
    <div class="shortcuts-dialog" role="dialog" aria-labelledby="shortcuts-title">
      <div class="shortcuts-head">
        <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
        <button type="button" class="shortcuts-close" aria-label="Close">&times;</button>
      </div>
      <table class="shortcuts-table">
        ${shortcuts
          .map(
            ([key, desc]) => `
          <tr>
            <td>${key}</td>
            <td>${desc}</td>
          </tr>`
          )
          .join('')}
      </table>
    </div>
  `;

  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target as HTMLElement).closest('.shortcuts-close')) {
      modal.remove();
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(modal);
}
