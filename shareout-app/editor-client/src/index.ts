import { bootEditor } from './boot';
import { registerSidecars } from './register-sidecars';

const DEBUG = false;

try {
  registerSidecars();

  if (DEBUG) {
    (window as unknown as { diagnoseEditor: () => void }).diagnoseEditor = () => {
      const iframe = document.getElementById('canvas-frame') as HTMLIFrameElement | null;
      const canvas = document.getElementById('canvas');
      const selectionOverlay = document.getElementById('selection-overlay');
      console.group('=== EDITOR DIAGNOSTIC ===');
      console.log('canvas-frame', iframe);
      console.log('canvas', canvas);
      console.log('selection-overlay', selectionOverlay);
      if (iframe?.contentDocument?.body && iframe.contentWindow) {
        const bodyStyle = iframe.contentWindow.getComputedStyle(iframe.contentDocument.body);
        console.log('body styles', {
          pointerEvents: bodyStyle?.pointerEvents,
          display: bodyStyle?.display,
          visibility: bodyStyle?.visibility,
        });
      }
      console.groupEnd();
    };
    console.log('[Editor] DEBUG enabled — run diagnoseEditor() in console');
  }

  bootEditor();
} catch (editorError) {
  const err = editorError as Error;
  console.error('[Editor] FATAL ERROR:', err);
  console.error('[Editor] Error stack:', err.stack);
  document.body.innerHTML =
    '<div style="padding:40px;color:red;font-family:monospace;">' +
    '<h2>Editor Error</h2><pre>' +
    err.message +
    '</pre><pre>' +
    (err.stack ?? '') +
    '</pre></div>';
}
