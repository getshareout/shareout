// @ts-nocheck
import type { EditorContext } from '../editor/context';
import { escapeHtml } from '../utils';
import { applyHtmlToCanvasFull, applyHtmlToCanvasIncremental } from '../canvas/apply-html';
import { resolveElementBySelector, stampEditorIdsOnBlocks } from '../dom/editor-ids';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndoImmediate } from '../history/undo-redo';
import { buildEnrichedContext, getOutlineSummary, getArtifactMetadata } from './context-builder';
import { markDirty } from '../persistence/draft';
import { clearLassoContext } from '../lasso/lasso';
import { executeAgentActions, actionLabel, type AgentAction } from '../agent/agent-actions';
import { extractStreamingReply } from './stream-reply';
import {
  readSSE,
  wireComposer,
  createChatView,
  createLiveAnnouncer,
  type ChatView,
  type LiveAnnouncer,
} from '@shareout/chat-core';

function renderAgentPlan(aiMsg: HTMLElement, actions: AgentAction[]): void {
  const plan = document.createElement('ol');
  plan.className = 'agent-plan';
  plan.innerHTML = actions
    .map((a, i) => `<li class="agent-step" data-step="${i}"><span class="agent-step-dot"></span>${escapeHtml(actionLabel(a))}</li>`)
    .join('');
  aiMsg.appendChild(plan);
}

const DEBUG = false; // EDIT-10 F2: off in prod (was logging full prompts/patches/HTML previews)

// Aborts the previous chat turn when a new message is sent before the last
// reply finished streaming, so a fast follow-up never races an older stream.
let currentChatAbort: AbortController | null = null;

function debugLog(category: string, message: string, data?: unknown) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const prefix = `%c[Chat ${timestamp}] %c${category}`;
  const styles = ['color: #6366f1; font-weight: bold', 'color: #059669; font-weight: bold'];
  if (data !== undefined) {
    console.log(prefix, ...styles, message, data);
  } else {
    console.log(prefix, ...styles, message);
  }
}

function debugError(category: string, message: string, error?: unknown) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  console.error(`[Chat ${timestamp}] ${category}:`, message, error);
}

function debugGroup(label: string) {
  if (!DEBUG) return;
  console.group(`🔍 ${label}`);
}

function debugGroupEnd() {
  if (!DEBUG) return;
  console.groupEnd();
}

// The rail owns its own collapse/expand; this now just keeps the panel visible
// and clears the welcome message once a conversation starts.
export function setChatState(ctx: EditorContext, state: 'collapsed' | 'focused' | 'expanded'): void {
  const rail = ctx.dom.studioRail;
  if (state !== 'collapsed') {
    if (rail) rail.dataset.collapsed = 'false';
    const peek = document.getElementById('rail-peek');
    if (peek) peek.hidden = true;
    removeWelcomeMessage(ctx);
  }
}

function removeWelcomeMessage(ctx: EditorContext): void {
  const welcome = ctx.dom.chatMessages?.querySelector('.chat-welcome');
  if (welcome && ctx.dom.chatMessages?.children.length > 1) {
    welcome.remove();
  }
}

// Memoized chat-core view over the rail's message list — shared add/scroll
// primitives, styled with the editor's existing chat-message classes. The scroller
// is `.rail-body` (the message list itself does not scroll), so the controller
// measures that while messages append to `#chat-messages`.
const chatViews = new WeakMap<EditorContext, ChatView>();
const announcers = new WeakMap<EditorContext, LiveAnnouncer>();
function chatView(ctx: EditorContext): ChatView | null {
  const container = ctx.dom.chatMessages;
  if (!container) return null;
  let v = chatViews.get(ctx);
  if (!v) {
    const viewport = (container.closest('.rail-body') as HTMLElement) || container;
    const jump = document.getElementById('chat-jump');
    const jumpCount = document.getElementById('chat-jump-count');
    jump?.addEventListener('click', () => chatViews.get(ctx)?.controller.jumpToLatest());
    v = createChatView(
      container,
      {
        userClass: 'chat-message chat-message-user',
        botClass: 'chat-message chat-message-ai',
        contentClass: 'chat-message-content',
      },
      {
        scrollViewport: viewport,
        onEdgeChange: (atEdge) => {
          if (jump) jump.hidden = atEdge;
        },
        onUnread: (n) => {
          if (jumpCount) jumpCount.textContent = n > 0 ? String(n) : '';
        },
      }
    );
    chatViews.set(ctx, v);
    announcers.set(ctx, createLiveAnnouncer({ mount: ctx.dom.studioRail ?? document.body }));
  }
  return v;
}

export function setupChatEvents(ctx: EditorContext) {
  const { chatInput } = ctx.dom;
  const aiEnabled = ctx.config.aiEnabled !== false;

  if (!aiEnabled) {
    applyAgentUnavailableUi(ctx);
    return;
  }

  if (chatInput) {
    chatInput.addEventListener('focus', () => {
      removeWelcomeMessage(ctx);
    });
  }

  // chat-core handles Enter-to-send, the send button, and textarea auto-resize.
  // sendChatMessage reads + clears the input itself, so don't clear on submit.
  wireComposer({
    input: chatInput,
    button: document.getElementById('chat-send'),
    autoResize: true,
    maxHeight: 120,
    clearOnSubmit: false,
    onSubmit: () => sendChatMessage(ctx),
  });
}

/** Agent tab empty state when the instance has no AI provider keys. */
function applyAgentUnavailableUi(ctx: EditorContext): void {
  const welcome = ctx.dom.chatMessages?.querySelector('.chat-welcome');
  if (welcome) {
    const text = welcome.querySelector('.welcome-text');
    const hint = welcome.querySelector('.welcome-hint');
    if (text) text.textContent = 'AI is not configured on this instance';
    if (hint) {
      hint.innerHTML =
        'Self-hosters set <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, or <code>VERCEL_AI_GATEWAY</code> on the Worker. Inspect and Data still work without AI.';
    }
  }
  if (ctx.dom.chatInput) {
    ctx.dom.chatInput.disabled = true;
    ctx.dom.chatInput.placeholder = 'AI not configured on this instance';
  }
  const send = document.getElementById('chat-send') as HTMLButtonElement | null;
  if (send) send.disabled = true;
  const suggestions = document.getElementById('rail-suggestions');
  if (suggestions) suggestions.hidden = true;
}

export async function sendChatMessage(ctx: EditorContext) {
  if (ctx.config.aiEnabled === false) return;
  const message = ctx.dom.chatInput?.value.trim();
  if (!message) return;

  if (currentChatAbort) currentChatAbort.abort();
  const chatAbort = new AbortController();
  currentChatAbort = chatAbort;

  debugGroup('Send Chat Message');
  debugLog('INPUT', 'User message:', message);

  setChatState(ctx, 'focused');

  const hasLasso = !!ctx.state.lassoContext;
  debugLog('MODE', hasLasso ? 'Lasso mode' : 'Normal mode');

  if (hasLasso) {
    debugLog('LASSO', 'Lasso context:', {
      bounds: ctx.state.lassoContext.bounds,
      elementsCount: ctx.state.lassoContext.elementsCount,
      htmlLength: ctx.state.lassoContext.elementsHtml?.length,
      imageSize: Math.round(ctx.state.lassoContext.imageData?.length / 1024) + 'KB',
    });
    addChatMessageWithImage(ctx, message, ctx.state.lassoContext.imageData);
  } else {
    addChatMessage(ctx, message, 'user');
  }

  ctx.dom.chatInput.value = '';
  ctx.dom.chatInput.style.height = 'auto';

  const aiMsg = document.createElement('div');
  aiMsg.className = 'chat-message chat-message-ai';
  aiMsg.innerHTML = '<div class="chat-message-content"><span class="typing">Thinking...</span></div>';
  ctx.dom.chatMessages?.appendChild(aiMsg);
  scrollToBottom(ctx);

  const startTime = performance.now();

  try {
    let response: Response;
    let endpoint: string;
    let requestBody: unknown;

    if (hasLasso) {
      const doc = ctx.dom.canvasFrame.contentDocument;
      const outline = doc ? getOutlineSummary(doc) : { nodes: [], totalPages: 0, totalSections: 0 };
      const artifact = getArtifactMetadata(ctx);

      endpoint = `/v1/artifacts/${ctx.config.artifactId}/editor/chat/lasso`;
      requestBody = {
        prompt: message,
        context: {
          documentHtml: ctx.state.html,
          lassoImage: ctx.state.lassoContext.imageData,
          lassoElementsHtml: ctx.state.lassoContext.elementsHtml,
          lassoElementsCount: ctx.state.lassoContext.elementsCount,
          lassoBounds: ctx.state.lassoContext.bounds,
          outline,
          artifact,
        }
      };

      debugLog('CONTEXT', 'Lasso context summary:', {
        artifact: artifact.name || artifact.slug,
        outlineNodes: outline.nodes?.length || 0,
        htmlLength: ctx.state.html?.length,
        lassoElementsCount: ctx.state.lassoContext.elementsCount,
      });

      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: chatAbort.signal,
      });

      clearLassoContext(ctx);
    } else {
      const enriched = buildEnrichedContext(ctx);
      const context = {
        documentHtml: enriched.html,
        selectedElements: enriched.selection ? [enriched.selection.selector] : [],
        artifact: enriched.artifact,
        outline: enriched.outline,
        selection: enriched.selection,
        htmlMode: enriched.htmlMode,
        manifest: enriched.manifest,
      };

      endpoint = `/v1/artifacts/${ctx.config.artifactId}/editor/chat/normal`;
      requestBody = { prompt: message, context };

      debugLog('CONTEXT', 'Enriched context:', {
        artifact: enriched.artifact?.name || enriched.artifact?.slug,
        htmlMode: enriched.htmlMode,
        htmlLength: enriched.html?.length,
        hasSelection: !!enriched.selection,
        selection: enriched.selection ? {
          selector: enriched.selection.selector,
          tagName: enriched.selection.tagName,
          textPreview: enriched.selection.textPreview?.slice(0, 50),
        } : null,
        outlineNodes: enriched.outline?.nodes?.length || 0,
      });

      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: chatAbort.signal,
      });
    }

    debugLog('REQUEST', `POST ${endpoint}`, {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
    });

    if (!response.ok) {
      const errorText = await response.text();
      debugError('RESPONSE', 'Request failed', { status: response.status, body: errorText });
      throw new Error(`Chat request failed: ${response.status}`);
    }

    let fullContent = '';
    let pendingResponse = null;

    debugLog('STREAM', 'Starting to read SSE stream...');

    // chat-core owns the SSE decode/split/parse loop; we react to each event.
    for await (const event of readSSE(response)) {
      if (event.type === 'content') {
        fullContent += event.content;
        const contentEl = aiMsg.querySelector('.chat-message-content');
        if (contentEl) {
          // The model streams a JSON object; show only the reply prose as it
          // arrives, never the raw JSON. Keep the "Thinking…" indicator until
          // the reply value starts.
          const reply = extractStreamingReply(fullContent);
          if (reply !== null) contentEl.textContent = reply;
        }
        scrollToBottom(ctx);
      }

      if (event.type === 'done') {
        const elapsed = Math.round(performance.now() - startTime);
        debugLog('DONE', `Response complete in ${elapsed}ms`, {
          changeId: event.changeId,
          responseType: event.response?.type,
          hasPatches: !!event.response?.patches?.length,
          patchCount: event.response?.patches?.length || 0,
          hasHtml: !!event.response?.html,
          message: event.response?.message?.slice(0, 100),
        });

        pendingResponse = event.response;
        ctx.state.pendingChangeId = event.changeId;

        if (pendingResponse?.patches?.length) {
          debugLog('PATCHES', 'Received patches:', pendingResponse.patches);
          pendingResponse.patches.forEach((p: unknown, i: number) => {
            debugLog('PATCH_DETAIL', `Patch ${i + 1}:`, {
              raw: JSON.stringify(p),
              selector: (p as Record<string, unknown>).selector,
              selectorType: typeof (p as Record<string, unknown>).selector,
              action: (p as Record<string, unknown>).action,
              keys: Object.keys(p as object),
            });
          });
        }
        if (pendingResponse?.html) {
          debugLog('HTML', 'Received full HTML replacement:', pendingResponse.html?.length + ' chars');
        }

        const contentEl = aiMsg.querySelector('.chat-message-content');
        if (contentEl) {
          contentEl.textContent = pendingResponse?.message || extractStreamingReply(fullContent) || 'Done!';
        }
        announcers.get(ctx)?.announce('Reply ready', { now: true });

        if (pendingResponse?.patches?.length || pendingResponse?.html || pendingResponse?.actions?.length) {
          ctx.state.pendingPatches = pendingResponse.patches;
          ctx.state.pendingHtml = pendingResponse.html;
          ctx.state.pendingActions = pendingResponse.actions || null;
          ctx.state.pendingAiMessage = aiMsg;

          // Show preview of affected elements
          showChangePreview(ctx, pendingResponse.patches);

          // Render the agent's plan (tool actions it will perform)
          if (pendingResponse.actions?.length) {
            renderAgentPlan(aiMsg, pendingResponse.actions);
          }

          // Create action buttons with proper event handlers
          const actions = document.createElement('div');
          actions.className = 'chat-message-actions';

          const applyBtn = document.createElement('button');
          applyBtn.className = 'so-c-btn so-c-btn--primary so-c-btn--sm';
          applyBtn.textContent = 'Apply Changes';
          applyBtn.addEventListener('click', () => handleApplyChanges(ctx, aiMsg));

          const rejectBtn = document.createElement('button');
          rejectBtn.className = 'so-c-btn so-c-btn--ghost so-c-btn--sm';
          rejectBtn.textContent = 'Reject';
          rejectBtn.addEventListener('click', () => handleRejectChanges(ctx, aiMsg));

          actions.appendChild(applyBtn);
          actions.appendChild(rejectBtn);
          aiMsg.appendChild(actions);
        }
      }

      if (event.type === 'error') {
        debugError('EVENT', 'Error event received', event);
        const contentEl = aiMsg.querySelector('.chat-message-content');
        if (contentEl) {
          contentEl.textContent = 'Error: ' + (event.error || 'Something went wrong');
        }
      }
    }
  } catch (error) {
    // Superseded by a newer message — drop this turn's bubble silently.
    if (error && (error as { name?: string }).name === 'AbortError') {
      aiMsg.remove();
    } else {
      debugError('ERROR', 'Chat failed', error);
      const contentEl = aiMsg.querySelector('.chat-message-content');
      if (contentEl) {
        contentEl.textContent = 'Sorry, something went wrong. Please try again.';
      }
    }
  } finally {
    if (currentChatAbort === chatAbort) currentChatAbort = null;
  }

  debugGroupEnd();
}

// Route every "keep up with the stream" call through the shared controller: it
// sticks to the edge only while the reader is following, holds a freshly anchored
// turn near the top, and never yanks a reader who scrolled away. [1,2,7]
function scrollToBottom(ctx: EditorContext): void {
  chatView(ctx)?.controller.stickToBottom();
}

export function clearPending(ctx: EditorContext) {
  clearChangePreview(ctx);
  ctx.state.pendingChangeId = null;
  ctx.state.pendingPatches = null;
  ctx.state.pendingHtml = null;
  ctx.state.pendingActions = null;
  ctx.state.pendingAiMessage = null;
}

function showChangePreview(ctx: EditorContext, patches: Array<Record<string, unknown>> | null) {
  if (!patches?.length) return;

  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return;

  debugLog('PREVIEW', `Highlighting ${patches.length} elements for preview`);

  // Add preview highlight styles if not already present
  let styleEl = doc.getElementById('ai-preview-styles');
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = 'ai-preview-styles';
    styleEl.textContent = `
      .ai-change-preview {
        outline: 2px dashed #8b5cf6 !important;
        outline-offset: 2px !important;
        background-color: rgba(139, 92, 246, 0.1) !important;
        transition: all 0.2s ease !important;
      }
      .ai-change-applied {
        outline: 2px solid #22c55e !important;
        outline-offset: 2px !important;
        background-color: rgba(34, 197, 94, 0.15) !important;
        animation: ai-flash 0.6s ease-out !important;
      }
      @keyframes ai-flash {
        0% { background-color: rgba(34, 197, 94, 0.4); }
        100% { background-color: rgba(34, 197, 94, 0.15); }
      }
    `;
    doc.head.appendChild(styleEl);
  }

  // Highlight each element that will be changed
  const allElements = doc.querySelectorAll('*');
  debugLog('PREVIEW', `Document has ${allElements.length} elements`, {
    h1Count: doc.querySelectorAll('h1').length,
    bodyHTML: doc.body?.innerHTML?.substring(0, 300),
  });

  patches.forEach(patch => {
    const selector = patch.selector as string;
    debugLog('PREVIEW', `Looking for selector: "${selector}"`, { type: typeof selector, patch: JSON.stringify(patch) });
    if (!selector) {
      debugError('PREVIEW', `No selector in patch:`, patch);
      return;
    }

    try {
      const el = resolveElementBySelector(doc, selector);
      if (el) {
        el.classList.add('ai-change-preview');
        debugLog('PREVIEW', `✓ Highlighted: ${selector}`, { tagName: el.tagName, textContent: el.textContent?.substring(0, 50) });
      } else {
        debugError('PREVIEW', `✗ NOT FOUND: "${selector}"`, {
          allH1s: doc.querySelectorAll('h1').length,
          bodyPreview: doc.body?.textContent?.substring(0, 100),
        });
      }
    } catch (e) {
      debugError('PREVIEW', `Invalid selector: ${selector}`, e);
    }
  });
}

function clearChangePreview(ctx: EditorContext) {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return;

  const previews = doc.querySelectorAll('.ai-change-preview, .ai-change-applied');
  previews.forEach(el => {
    el.classList.remove('ai-change-preview', 'ai-change-applied');
  });
  debugLog('PREVIEW', `Cleared ${previews.length} preview highlights`);
}

function showAppliedFeedback(ctx: EditorContext, patches: Array<Record<string, unknown>> | null) {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc || !patches?.length) return;

  patches.forEach(patch => {
    const selector = patch.selector as string;
    if (!selector) return;

    try {
      const el = resolveElementBySelector(doc, selector);
      if (el) {
        el.classList.remove('ai-change-preview');
        el.classList.add('ai-change-applied');

        // Remove highlight after animation
        setTimeout(() => {
          el.classList.remove('ai-change-applied');
        }, 2000);
      }
    } catch (e) {
      // Element may have been replaced, that's ok
    }
  });
}

async function handleApplyChanges(ctx: EditorContext, aiMsg: HTMLElement) {
  debugGroup('Apply Changes');

  const patches = ctx.state.pendingPatches;
  const pendingHtml = ctx.state.pendingHtml;
  const actions = ctx.state.pendingActions as AgentAction[] | null;

  if (patches?.length) {
    debugLog('APPLY', `Applying ${patches.length} patches`);
    pushUndoImmediate(ctx.state);
    applyPatches(ctx, patches);
    showAppliedFeedback(ctx, patches);
  } else if (pendingHtml) {
    debugLog('APPLY', 'Applying full HTML replacement');
    pushUndoImmediate(ctx.state);
    ctx.state.html = pendingHtml;
    // Prefer a targeted body swap so the iframe's document, SDK and listeners
    // survive; only rebind events when a full rewrite is unavoidable.
    const incremental = applyHtmlToCanvasIncremental(ctx.dom, pendingHtml);
    if (!incremental) {
      applyHtmlToCanvasFull(ctx.dom, pendingHtml);
      ctx.bindCanvasEvents();
    }
    syncHtmlFromCanvas(ctx);
    markDirty(ctx);
  }

  // Update UI - remove buttons, show confirmation inline
  const actionsEl = aiMsg.querySelector('.chat-message-actions');
  if (actionsEl) {
    actionsEl.innerHTML = '<span class="chat-action-result chat-action-applied">✓ Applied</span>';
  }

  // Run the agent's tool actions, lighting up each plan step as it completes
  if (actions?.length) {
    await executeAgentActions(ctx, actions, (index, status) => {
      const step = aiMsg.querySelector(`.agent-step[data-step="${index}"]`);
      step?.classList.remove('doing', 'done', 'error');
      step?.classList.add(status);
    });
  }

  if (actionsEl) setTimeout(() => actionsEl.remove(), 3000);

  // Notify server
  if (ctx.state.pendingChangeId) {
    fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/chat/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeId: ctx.state.pendingChangeId }),
    }).catch(e => debugError('APPLY', 'Failed to notify server', e));
  }

  clearPending(ctx);
  debugGroupEnd();
}

function handleRejectChanges(ctx: EditorContext, aiMsg: HTMLElement) {
  debugLog('REJECT', 'User rejected changes');

  // Notify server
  if (ctx.state.pendingChangeId) {
    fetch(`/v1/artifacts/${ctx.config.artifactId}/editor/chat/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeId: ctx.state.pendingChangeId }),
    }).catch(e => debugError('REJECT', 'Failed to notify server', e));
  }

  // Update UI - remove buttons, show rejection inline
  const actionsEl = aiMsg.querySelector('.chat-message-actions');
  if (actionsEl) {
    actionsEl.innerHTML = '<span class="chat-action-result chat-action-rejected">✗ Rejected</span>';
    setTimeout(() => actionsEl.remove(), 2000);
  }

  clearPending(ctx);
}

export function addChatMessage(ctx: EditorContext, content: string, sender: string) {
  const view = chatView(ctx);
  if (!view) return;
  if (sender === 'user') view.addUser(content);
  else view.addBot(content);
}

export function addChatMessageWithImage(ctx: EditorContext, content: string, imageData: string) {
  const msg = document.createElement('div');
  msg.className = 'chat-message chat-message-user';
  msg.innerHTML = `
    <div class="chat-message-image">
      <img src="${imageData}" style="max-width: 120px; max-height: 80px; border-radius: 6px; border: 1px solid #dee2e6; margin-bottom: 6px;">
    </div>
    <div class="chat-message-content">${escapeHtml(content)}</div>
  `;
  ctx.dom.chatMessages?.appendChild(msg);
  // The reader's own new turn — anchor it near the top (anchor-and-hold). [4,6]
  chatView(ctx)?.controller.anchorTop(msg);
}

export function applyPatches(ctx: EditorContext, patches: Array<Record<string, unknown>>) {
  debugGroup('Apply Patches');
  debugLog('PATCHES', `Applying ${patches.length} patches`);

  const doc = ctx.dom.canvasFrame?.contentDocument;

  debugLog('DOC_CHECK', 'Document state:', {
    canvasFrame: !!ctx.dom.canvasFrame,
    contentDocument: !!doc,
    readyState: doc?.readyState,
    documentElement: !!doc?.documentElement,
    bodyExists: !!doc?.body,
    bodyHTML: doc?.body?.innerHTML?.substring(0, 500),
  });

  if (!doc) {
    debugError('DOC_CHECK', 'No contentDocument - iframe not loaded');
    return;
  }

  const allElements = doc.querySelectorAll('*');
  const tagNames = Array.from(allElements).map(el => el.tagName.toLowerCase());
  const uniqueTags = [...new Set(tagNames)];
  debugLog('DOC_CHECK', `Found ${allElements.length} elements:`, uniqueTags);

  let applied = 0;
  let failed = 0;

  patches.forEach((patch, index) => {
    debugLog('PATCH', `[${index + 1}/${patches.length}]`, {
      selector: patch.selector,
      selectorType: typeof patch.selector,
      action: patch.action,
      contentLength: patch.content?.length,
      contentPreview: typeof patch.content === 'string' ? patch.content.substring(0, 200) : patch.content,
      attribute: patch.attribute,
      value: patch.value,
      fullPatch: JSON.stringify(patch),
    });

    const selector = patch.selector as string;
    if (!selector || typeof selector !== 'string') {
      debugError('PATCH', `Invalid selector:`, { selector, type: typeof selector });
      failed++;
      return;
    }

    let element: Element | null = null;
    try {
      element = resolveElementBySelector(doc, selector);
    } catch (e) {
      debugError('PATCH', `selector resolution threw for: "${selector}"`, e);
      failed++;
      return;
    }

    if (!element) {
      debugError('PATCH', `Element not found for selector: "${selector}"`, {
        selectorTried: selector,
        allH1s: doc.querySelectorAll('h1').length,
        allH2s: doc.querySelectorAll('h2').length,
        allDivs: doc.querySelectorAll('div').length,
        bodyText: doc.body?.textContent?.substring(0, 200),
      });
      failed++;
      return;
    }

    debugLog('PATCH', `Found element:`, {
      tagName: element.tagName,
      id: element.id,
      className: element.className,
      textContent: element.textContent?.substring(0, 100),
    });

    try {
      switch (patch.action) {
        case 'replace':
          debugLog('APPLY', `Replacing element`, { oldLength: element.outerHTML.length, newLength: patch.content?.length });
          element.outerHTML = patch.content;
          break;
        case 'insert':
          debugLog('APPLY', `Inserting content`, { contentLength: patch.content?.length });
          element.insertAdjacentHTML('beforeend', patch.content);
          break;
        case 'delete':
          debugLog('APPLY', `Deleting element`);
          element.remove();
          break;
        case 'setAttribute':
          debugLog('APPLY', `Setting attribute`, { attribute: patch.attribute, value: patch.value });
          element.setAttribute(patch.attribute, patch.value);
          break;
        case 'setStyle':
          debugLog('APPLY', `Setting style`, { property: patch.attribute, value: patch.value });
          element.style[patch.attribute] = patch.value;
          break;
        default:
          debugError('PATCH', `Unknown action: ${patch.action}`);
          failed++;
          return;
      }
      applied++;
    } catch (e) {
      debugError('PATCH', `Failed to apply patch`, e);
      failed++;
    }
  });

  debugLog('RESULT', `Patches complete`, { applied, failed, total: patches.length });

  // Give freshly inserted/replaced nodes stable ids so later edits, collab
  // locks and follow-up AI patches can target them reliably.
  stampEditorIdsOnBlocks(doc);
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  debugGroupEnd();
}
