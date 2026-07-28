import { bootEditor } from './boot';
import { registerSidecars } from './register-sidecars';

const log = (msg: string, detail?: unknown) => {
  if (detail !== undefined) console.log(msg, detail);
  else console.log(msg);
};

// DEBUG: Expose diagnostic function on window
(window as unknown as { diagnoseEditor: () => void }).diagnoseEditor = () => {
  const iframe = document.getElementById('canvas-frame') as HTMLIFrameElement | null;
  const canvas = document.getElementById('canvas');
  const selectionOverlay = document.getElementById('selection-overlay');

  console.group('=== EDITOR DIAGNOSTIC ===');

  console.log('1. DOM Elements:');
  console.log('   - canvas-frame:', iframe);
  console.log('   - canvas:', canvas);
  console.log('   - selection-overlay:', selectionOverlay);

  if (iframe) {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    console.log('2. Iframe Access:');
    console.log('   - contentDocument:', doc);
    console.log('   - contentWindow:', win);
    console.log('   - sandbox:', iframe.sandbox.toString());
    console.log('   - src:', iframe.src);

    if (doc) {
      console.log('3. Iframe Document:');
      console.log('   - readyState:', doc.readyState);
      console.log('   - body:', doc.body);
      console.log('   - body.childElementCount:', doc.body?.childElementCount);
      console.log('   - documentElement:', doc.documentElement);

      if (doc.body) {
        const bodyStyle = win?.getComputedStyle(doc.body);
        console.log('4. Body Computed Styles:');
        console.log('   - pointerEvents:', bodyStyle?.pointerEvents);
        console.log('   - display:', bodyStyle?.display);
        console.log('   - visibility:', bodyStyle?.visibility);
        console.log('   - position:', bodyStyle?.position);
        console.log('   - zIndex:', bodyStyle?.zIndex);

        // List first 5 children
        console.log('5. Body Children (first 5):');
        Array.from(doc.body.children).slice(0, 5).forEach((child, i) => {
          const el = child as HTMLElement;
          const style = win?.getComputedStyle(el);
          console.log(`   [${i}] ${el.tagName}#${el.id || '(no id)'} - pointerEvents: ${style?.pointerEvents}, display: ${style?.display}`);
        });

        // Check for any element with pointer-events: none covering the whole body
        console.log('6. Looking for blocking overlays...');
        const allElements = doc.body.querySelectorAll('*');
        let blockingElements: Element[] = [];
        allElements.forEach((el) => {
          const style = win?.getComputedStyle(el as HTMLElement);
          if (style?.pointerEvents === 'none') return; // pointer-events none is OK (pass-through)
          if (style?.position === 'fixed' || style?.position === 'absolute') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 500 && rect.height > 500) {
              blockingElements.push(el);
            }
          }
        });
        if (blockingElements.length > 0) {
          console.warn('   Found potential blocking elements:', blockingElements);
        } else {
          console.log('   No blocking overlays found');
        }

        // Test adding a click listener directly
        console.log('7. Testing direct event listener...');
        const testHandler = (e: Event) => {
          console.log('[TEST] Direct body click received!', {
            target: (e.target as Element)?.tagName,
            phase: e.eventPhase,
          });
        };
        doc.body.addEventListener('click', testHandler);
        console.log('   Added test click listener. Click inside the canvas and check for [TEST] message.');
      }
    }
  }

  // Check iframe rect vs canvas rect
  if (iframe && canvas) {
    const iframeRect = iframe.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    console.log('8. Element Rects:');
    console.log('   - iframe:', iframeRect);
    console.log('   - canvas:', canvasRect);
    console.log('   - iframe covers canvas:',
      iframeRect.left <= canvasRect.left &&
      iframeRect.right >= canvasRect.right &&
      iframeRect.top <= canvasRect.top &&
      iframeRect.bottom >= canvasRect.bottom
    );
  }

  console.groupEnd();
  console.log('Run diagnoseEditor() again after clicking in the canvas to see test results.');
};

log('[Editor] Script starting...');
log('[Editor] TIP: Run diagnoseEditor() in console for diagnostics');

try {
  log('[Editor] Step 1: register sidecars');
  registerSidecars();
  log('[Editor] Step 2: bootEditor');
  bootEditor();
  log('[Editor] Step 3: bootEditor returned (init runs async)');
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
