// ShareOut Visual Editor - HTML shell (chat-first, grandma-friendly UI)

export interface EditorShellOptions {
  slug: string;
}

/** Editor page body markup - minimal, chat-first design */
export function renderEditorShell({ slug }: EditorShellOptions): string {
  return `<!-- Slim Floating Topbar: identity · status · the one action -->
<header class="editor-topbar">
  <div class="topbar-left">
    <div class="artifact-name" contenteditable="true" spellcheck="false">${slug}</div>
  </div>
  <div class="topbar-center">
    <span class="save-status" id="save-status">Saved</span>
    <span class="version-indicator" id="version-indicator" title="Click for version history"></span>
    <button class="validity-chip" id="btn-validation" data-state="ok" aria-label="Validation" hidden>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 9v4"/><path d="M12 17h.01"/>
        <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z"/>
      </svg>
      <span class="validity-chip-text"></span>
    </button>
  </div>
  <div class="topbar-right">
    <div class="collaborators" id="collaborators"></div>
    <button class="so-c-btn so-c-btn--primary" id="btn-publish">Publish</button>
  </div>
</header>

<!-- Full-Width Canvas -->
<main class="editor-canvas">
  <!-- Canvas Scroll Area -->
  <div class="canvas-scroll" id="canvas-scroll">
    <div class="canvas" id="canvas">
      <iframe
        id="canvas-frame"
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
        title="Editor Canvas"
      ></iframe>
      <div class="canvas-loading" id="canvas-loading">
        <div class="canvas-loading-spinner"></div>
      </div>
      <div class="selection-overlay" id="selection-overlay"></div>
      <div class="cursor-overlay" id="cursor-overlay"></div>
    </div>
  </div>
</main>

<!-- Floating canvas tools (select · lasso · undo/redo · viewport) -->
<div class="canvas-tools" id="canvas-tools">
  <button class="toolbar-btn active" data-tool="select" data-label="Select" title="Select (V)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4l16 8.5L12 15l-2 7L4 4z"/>
    </svg>
  </button>
  <button class="toolbar-btn" data-tool="lasso" data-label="Lasso" title="Lasso (L)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="8" stroke-dasharray="4 3"/>
    </svg>
  </button>
  <span class="toolbar-divider"></span>
  <button class="toolbar-btn" id="btn-undo" data-label="Undo" title="Undo (⌘Z)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 10h10a5 5 0 0 1 5 5v2"/>
      <path d="M7 6L3 10l4 4"/>
    </svg>
  </button>
  <button class="toolbar-btn" id="btn-redo" data-label="Redo" title="Redo (⌘⇧Z)">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10H11a5 5 0 0 0-5 5v2"/>
      <path d="M17 6l4 4-4 4"/>
    </svg>
  </button>
  <span class="toolbar-divider"></span>
  <button class="toolbar-btn" id="btn-assets" data-label="Insert asset" title="Insert an asset from your library">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>
  </button>
  <span class="toolbar-divider"></span>
  <button class="toolbar-btn" id="btn-viewport" data-viewport="desktop" data-label="Viewport" title="Toggle mobile/desktop preview">
    <svg class="viewport-icon-desktop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </svg>
    <svg class="viewport-icon-mobile" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="5" y="2" width="14" height="20" rx="2"/>
      <path d="M12 18h.01"/>
    </svg>
  </button>
</div>

<!-- Studio Rail (unified glass hub: Agent · Inspect · Data + artifact actions) -->
<aside class="studio-rail" id="studio-rail" data-mode="agent" data-collapsed="false">
  <button class="rail-collapse" id="rail-collapse" title="Hide panel" aria-label="Hide panel">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  </button>

  <nav class="rail-tabs" role="tablist">
    <button class="rail-tab active" data-mode="agent" id="tab-agent" role="tab" aria-selected="true">Agent</button>
    <button class="rail-tab" data-mode="inspect" id="tab-inspect" role="tab" aria-selected="false" disabled>Inspect</button>
    <button class="rail-tab" data-mode="data" id="tab-data" role="tab" aria-selected="false">Data</button>
  </nav>

  <div class="rail-body">
    <!-- AGENT -->
    <section class="rail-pane" data-pane="agent">
      <div class="rail-suggestions" id="rail-suggestions"></div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-welcome">
          <div class="welcome-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
            </svg>
          </div>
          <p class="welcome-text">Ask me to edit your page</p>
          <p class="welcome-hint">Try: "Add a blue button" or "Make the heading bigger"</p>
          <p class="welcome-draft-note" style="margin-top:12px;font-size:12px;opacity:0.75;line-height:1.4;">Autosave is <strong>your</strong> draft. Collaborators see live edits while you are both connected; each person keeps their own draft on reload.</p>
        </div>
      </div>
    </section>

    <!-- INSPECT -->
    <section class="rail-pane" data-pane="inspect" hidden>
      <div class="property-panel" id="property-panel">
        <div class="rail-empty">
          <p class="rail-empty-title">Nothing selected</p>
          <p class="rail-empty-hint">Click an element on the page to edit it.</p>
        </div>
      </div>
    </section>

    <!-- DATA (JSON · Files · Tables · Connectors) -->
    <section class="rail-pane" data-pane="data" hidden>
      <div class="data-browser" id="data-browser"></div>
    </section>

    <!-- PANEL (transient: outline / details / validation / history / share / metrics / inbox) -->
    <section class="rail-pane" data-pane="panel" hidden>
      <div class="rail-panel-head">
        <button class="rail-panel-back" id="rail-panel-back" aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span class="rail-panel-title" id="rail-panel-title"></span>
      </div>
      <div class="rail-panel-body" id="rail-panel-content"></div>
    </section>
  </div>

  <!-- Jump to latest (shown when the reader scrolls away from a streaming reply) -->
  <button class="chat-jump" id="chat-jump" type="button" hidden aria-label="Jump to latest reply">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6"/>
    </svg>
    <span class="chat-jump-count" id="chat-jump-count"></span>
  </button>

  <!-- Persistent agent input strip (all modes) -->
  <div class="rail-input-bar">
    <div class="chat-context-chips" id="chat-context-chips"></div>
    <div class="chat-input-row">
      <textarea
        id="chat-input"
        placeholder="Ask AI to edit your page..."
        rows="1"
      ></textarea>
      <button class="chat-send" id="chat-send" title="Send">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Artifact actions footer — Ship (share · metrics · inbox · favorite) · Doc (versions · details · outline) -->
  <div class="rail-actions" id="rail-actions">
    <div class="rail-actions-group" aria-label="Share and engage">
      <button class="rail-action" id="btn-share" data-label="Share" aria-label="Share artifact">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
      <button class="rail-action" id="btn-metrics" data-label="Metrics" aria-label="Metrics &amp; alerts">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v18h18"/>
          <path d="m19 9-5 5-4-4-3 3"/>
        </svg>
      </button>
      <button class="rail-action" id="btn-inbox" data-label="Inbox" aria-label="Inbound email inbox">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <path d="m3 7 9 6 9-6"/>
        </svg>
      </button>
      <button class="rail-action fav-btn" id="btn-favorite" data-label="Favorite" aria-label="Add to favorites" aria-pressed="false" data-fav="0">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </button>
    </div>
    <div class="rail-actions-spacer"></div>
    <div class="rail-actions-group" aria-label="Document">
      <button class="rail-action" id="btn-history" data-label="Versions" aria-label="Version history">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v5h5"/>
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
          <path d="M12 7v5l3 2"/>
        </svg>
      </button>
      <button class="rail-action" id="btn-info" data-label="Details" aria-label="Artifact details">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2"/>
          <line x1="8" y1="8" x2="16" y2="8"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
          <line x1="8" y1="16" x2="12" y2="16"/>
        </svg>
      </button>
      <button class="rail-action" id="btn-outline" data-label="Outline" aria-label="Page outline">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none"/>
          <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/>
          <circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/>
          <line x1="10" y1="6" x2="20" y2="6"/>
          <line x1="10" y1="12" x2="18" y2="12"/>
          <line x1="10" y1="18" x2="16" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</aside>

<!-- Rail peek tab (shown when collapsed) -->
<button class="rail-peek" id="rail-peek" hidden title="Show panel" aria-label="Show panel">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z"/>
  </svg>
</button>

<!-- Lasso Overlay (hidden by default) -->
<div class="lasso-overlay" id="lasso-overlay" hidden>
  <canvas id="lasso-canvas"></canvas>
  <div class="lasso-popup" id="lasso-popup" hidden>
    <img id="lasso-preview" alt="Selection preview"/>
    <textarea id="lasso-prompt" placeholder="What would you like to change?"></textarea>
    <div class="lasso-actions">
      <button class="so-c-btn so-c-btn--secondary" id="lasso-cancel">Cancel</button>
      <button class="so-c-btn so-c-btn--primary" id="lasso-submit">Apply</button>
    </div>
  </div>
</div>
`;
}
