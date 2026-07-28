import { readSSE } from '@shareout/chat-core/sse';
import {
  createChatView,
  createLiveAnnouncer,
  renderMarkdown,
  type ChatView,
  type LiveAnnouncer,
  type MessageHandle,
} from '@shareout/chat-core';
import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';
import { createPilot, type Pilot } from './pilot-store';

interface AgentConfig {
  systemPrompt?: string;
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022';
  maxTokens?: number;
  temperature?: number;
  context?: {
    json?: boolean;
    tables?: string[];
    blobs?: boolean;
  };
}

interface ChatMessage {
  message: string;
  conversationId?: string;
  /**
   * Per-message live context — the artifact's current on-screen state (e.g. a
   * warehouse query result, active filters). Sent with the request and injected
   * into the model's view of THIS message as a "Live page data" block, so the
   * agent answers from data that isn't stored in sdk.json/tables. Re-send the
   * freshest snapshot each turn. Keep it reasonably small (server caps ~200KB).
   */
  context?: Record<string, unknown>;
}

interface ChatChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  suggestedEdits?: Array<{ file: string; type: string; search?: string; replace?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

interface Conversation {
  id: string;
  artifact_id: string;
  mode: 'visitor' | 'admin';
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface WidgetOptions {
  position?: 'bottom-right' | 'bottom-left' | 'inline';
  theme?: 'light' | 'dark' | 'auto';
  placeholder?: string;
  welcomeMessage?: string;
  minimized?: boolean;
  /**
   * Default mode. 'auto' reveals an [Ask] [Do] toggle when the owner has enabled
   * Pilot on this artifact; 'ask' pins the widget to streaming chat and never
   * shows the toggle. @default 'auto'
   */
  mode?: 'ask' | 'auto';
  /**
   * Force-disable the Do (Pilot) affordance even when the owner enabled it. Use
   * to keep a widget chat-only regardless of server config. @default true
   */
  pilot?: boolean;
  /** Extra system-level guidance forwarded to each Pilot run's `instructions`. */
  pilotInstructions?: string;
}

export class AgentStore {
  private config: AgentConfig = {};
  private _widget: ChatWidget | null = null;
  private _pilot: Pilot | null = null;

  constructor(private sdk: SdkClient) {}

  /**
   * In-page GUI agent: `await so.agent.pilot('task')` reads the artifact's DOM
   * and clicks/types/scrolls to carry it out (vendored page-agent, MIT). The
   * engine loads lazily from /sdk/page-pilot.js and proxies LLM calls through
   * the worker; the owner must enable it in agent settings. `so.agent.pilot.stop()`
   * aborts the active run.
   */
  get pilot(): Pilot {
    if (!this._pilot) this._pilot = createPilot(this.sdk);
    return this._pilot;
  }

  /**
   * Store client-side agent options. NOTE: in **visitor** mode the system prompt,
   * model, temperature and json/tables context are owner-controlled and read from
   * the server config (set via the publish payload's `agent` block or
   * PUT /v1/data/:id/agent/config) — they are NOT sent from the browser, since
   * this code runs with the visitor's session and must not be able to override
   * the prompt. To feed live, per-message data to the agent, pass `context` to
   * {@link chat} instead. This method is retained for forward-compat and the
   * pre-built widget; for visitor chat it has no effect on the model.
   */
  configure(config: AgentConfig): void {
    this.config = { ...this.config, ...config };
  }

  async *chat(options: ChatMessage): AsyncGenerator<ChatChunk> {
    const url = `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/agent/chat`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.sdk._sessionToken) {
      headers.Authorization = `Bearer ${this.sdk._sessionToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: options.message,
        conversationId: options.conversationId,
        context: options.context,
      }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      yield { type: 'error', error: error.error || 'Request failed' };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    for await (const ev of readSSE(response)) {
      yield ev as ChatChunk;
    }
  }

  get conversations() {
    return {
      list: async (options?: { limit?: number; offset?: number }): Promise<{ conversations: Conversation[]; total: number }> => {
        const params = new URLSearchParams();
        if (options?.limit) params.set('limit', String(options.limit));
        if (options?.offset) params.set('offset', String(options.offset));
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.sdk._internalFetch(`/agent/conversations${query}`);
      },

      get: async (id: string): Promise<{ conversation: Conversation; messages: unknown[] }> => {
        return this.sdk._internalFetch(`/agent/conversations/${id}`);
      },

      delete: async (id: string): Promise<{ deleted: boolean }> => {
        return this.sdk._internalFetch(`/agent/conversations/${id}`, { method: 'DELETE' });
      },
    };
  }

  get widget(): ChatWidget {
    if (!this._widget) {
      this._widget = new ChatWidget(this.sdk, this);
    }
    return this._widget;
  }

  async _pilotEnabled(): Promise<boolean> {
    const config = await this.sdk._internalFetch<{ pilot_enabled?: boolean }>('/agent/config');
    return !!config.pilot_enabled;
  }
}

export class ChatWidget {
  private container: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private currentConversationId: string | null = null;
  private options: WidgetOptions = {};
  private view: ChatView | null = null;
  private announcer: LiveAnnouncer | null = null;
  private jumpEl: HTMLElement | null = null;
  private pilotAvailable = false;
  private activeMode: 'ask' | 'auto' = 'auto';
  private pilotRunning = false;
  private pendingAsk: ((answer: string) => void) | null = null;
  private toggleEl: HTMLElement | null = null;

  constructor(private sdk: SdkClient, private agent: AgentStore) {}

  mount(selector: string, options: WidgetOptions = {}): void {
    if (typeof document === 'undefined') return;

    this.options = options;
    this.container = document.querySelector(selector);
    if (!this.container) {
      throw new ShareOutError(`Element not found: ${selector}`, 'WIDGET_ERROR', 400);
    }

    this.activeMode = options.mode || 'auto';

    this.shadow = this.container.attachShadow({ mode: 'closed' });
    this.render();
    this.bindEvents();
    this.detectPilot();
  }

  private detectPilot(): void {
    if (this.options.pilot === false || this.options.mode === 'ask') return;
    void this.agent
      ._pilotEnabled()
      .then((enabled) => {
        if (!enabled) return;
        this.pilotAvailable = true;
        this.renderToggle();
      })
      .catch(() => {});
  }

  unmount(): void {
    if (this.pilotRunning) void this.agent.pilot.stop();
    this.pendingAsk = null;
    this.pilotRunning = false;
    this.view?.controller.destroy();
    this.announcer?.destroy();
    if (this.shadow) {
      this.shadow.innerHTML = '';
    }
    this.container = null;
    this.shadow = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.view = null;
    this.announcer = null;
    this.jumpEl = null;
  }

  toggle(): void {
    if (!this.shadow) return;
    const chat = this.shadow.querySelector('.shareout-chat');
    if (chat) {
      chat.classList.toggle('minimized');
    }
  }

  setTheme(theme: 'light' | 'dark' | 'auto'): void {
    if (!this.shadow) return;
    const chat = this.shadow.querySelector('.shareout-chat');
    if (chat) {
      chat.setAttribute('data-theme', theme);
    }
  }

  private render(): void {
    if (!this.shadow) return;

    const position = this.options.position || 'bottom-right';
    const theme = this.options.theme || 'auto';

    this.shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="shareout-chat ${position} ${this.options.minimized ? 'minimized' : ''}" data-theme="${theme}">
        <div class="chat-header">
          <span class="title">Chat</span>
          <button class="minimize-btn" type="button" aria-label="Close chat">×</button>
        </div>
        <div class="chat-messages"></div>
        <button class="chat-jump" type="button" hidden aria-label="Jump to latest message">↓<span class="chat-jump-count"></span></button>
        <div class="chat-input">
          <div class="chat-mode" role="group" aria-label="Chat mode" hidden></div>
          <div class="chat-compose">
            <textarea placeholder="${this.options.placeholder || 'Type a message...'}" rows="1"></textarea>
            <button class="send-btn" type="button">Send</button>
          </div>
        </div>
      </div>
    `;

    this.messagesEl = this.shadow.querySelector('.chat-messages');
    this.inputEl = this.shadow.querySelector('textarea');
    this.jumpEl = this.shadow.querySelector('.chat-jump');
    this.toggleEl = this.shadow.querySelector('.chat-mode');
    const jumpCount = this.shadow.querySelector('.chat-jump-count');
    const chatEl = this.shadow.querySelector('.shareout-chat') as HTMLElement;

    // Shared reading behaviour: follow only at the edge, anchor a new question near
    // the top, show "N new" instead of yanking a reader who scrolled up. [1-9]
    if (this.messagesEl) {
      this.view = createChatView(
        this.messagesEl,
        { userClass: 'message user', botClass: 'message assistant' },
        {
          // Safe markdown (escape-first) so pilot/chat replies render bold/lists/links.
          renderBot: renderMarkdown,
          onEdgeChange: (atEdge) => {
            if (this.jumpEl) this.jumpEl.hidden = atEdge;
          },
          onUnread: (n) => {
            if (jumpCount) jumpCount.textContent = n > 0 ? String(n) : '';
          },
        }
      );
      this.announcer = createLiveAnnouncer({ mount: chatEl || this.messagesEl });
      this.jumpEl?.addEventListener('click', () => this.view?.controller.jumpToLatest());
    }

    if (this.options.welcomeMessage) {
      this.addMessage('assistant', this.options.welcomeMessage);
    }
  }

  private renderToggle(): void {
    if (!this.toggleEl) return;
    this.toggleEl.hidden = false;
    this.toggleEl.innerHTML = `
      <button class="mode-btn" type="button" data-mode="ask" aria-pressed="true">Ask</button>
      <button class="mode-btn" type="button" data-mode="auto" aria-pressed="false">Do</button>
    `;
    this.activeMode = 'ask';
    this.toggleEl.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode as 'ask' | 'auto'));
    });
  }

  private hideToggle(): void {
    if (!this.toggleEl) return;
    this.toggleEl.hidden = true;
    this.toggleEl.innerHTML = '';
  }

  private setMode(mode: 'ask' | 'auto'): void {
    this.activeMode = mode;
    this.toggleEl?.querySelectorAll<HTMLButtonElement>('.mode-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false');
    });
  }

  private getStyles(): string {
    return `
      :host { display: block; }
      .shareout-chat {
        position: fixed;
        width: 360px;
        height: 500px;
        display: flex;
        flex-direction: column;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        overflow: hidden;
        transition: height 0.2s ease;
        z-index: 10000;
        pointer-events: auto;
      }
      .shareout-chat[data-theme="light"], .shareout-chat[data-theme="auto"] {
        background: #fff;
        color: #1a1a1a;
        border: 1px solid #e0e0e0;
      }
      .shareout-chat[data-theme="dark"] {
        background: #1a1a1a;
        color: #fff;
        border: 1px solid #333;
      }
      @media (prefers-color-scheme: dark) {
        .shareout-chat[data-theme="auto"] {
          background: #1a1a1a;
          color: #fff;
          border: 1px solid #333;
        }
      }
      /* Clear ShareOut serve toolbar (44px + 20px inset) at bottom-right */
      .bottom-right { bottom: 76px; right: 20px; }
      .bottom-left { bottom: 20px; left: 20px; }
      .inline { position: relative; width: 100%; height: 100%; }
      .shareout-chat.minimized { height: 48px; }
      .shareout-chat.minimized .chat-messages,
      .shareout-chat.minimized .chat-input { display: none; }
      .chat-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid #e0e0e0;
        cursor: pointer;
        flex-shrink: 0;
      }
      [data-theme="dark"] .chat-header { border-bottom-color: #333; }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .chat-header { border-bottom-color: #333; }
      }
      .chat-header .title { font-weight: 600; }
      .chat-header button {
        background: none;
        border: none;
        font-size: 18px;
        cursor: pointer;
        color: inherit;
        padding: 0 4px;
      }
      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .message {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .chat-jump {
        position: absolute;
        right: 16px;
        bottom: 64px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        border-radius: 14px;
        border: 1px solid #e0e0e0;
        background: #fff;
        color: #444;
        font-size: 13px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      [data-theme="dark"] .chat-jump { background: #2a2a2a; color: #fff; border-color: #444; }
      .chat-jump[hidden] { display: none; }
      .chat-jump-count:empty { display: none; }
      .message.user {
        align-self: flex-end;
        background: #007aff;
        color: #fff;
        content-visibility: auto;
        contain-intrinsic-size: auto 44px;
      }
      .message.assistant {
        align-self: flex-start;
        background: #f0f0f0;
        color: #1a1a1a;
        white-space: normal;
      }
      .message.assistant code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.9em;
        padding: 1px 4px;
        border-radius: 4px;
        background: rgba(0,0,0,0.06);
      }
      [data-theme="dark"] .message.assistant code { background: rgba(255,255,255,0.1); }
      .message.assistant a { color: inherit; text-decoration: underline; }
      .message.assistant strong { font-weight: 600; }
      [data-theme="dark"] .message.assistant {
        background: #2a2a2a;
        color: #fff;
      }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .message.assistant {
          background: #2a2a2a;
          color: #fff;
        }
      }
      .chat-input {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-top: 1px solid #e0e0e0;
        flex-shrink: 0;
      }
      [data-theme="dark"] .chat-input { border-top-color: #333; }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .chat-input { border-top-color: #333; }
      }
      .chat-compose { display: flex; gap: 8px; }
      .chat-mode {
        display: inline-flex;
        align-self: flex-start;
        gap: 2px;
        padding: 2px;
        border-radius: 8px;
        background: #f0f0f0;
      }
      .chat-mode[hidden] { display: none; }
      [data-theme="dark"] .chat-mode { background: #2a2a2a; }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .chat-mode { background: #2a2a2a; }
      }
      .chat-mode .mode-btn {
        padding: 4px 12px;
        border: none;
        border-radius: 6px;
        background: none;
        color: inherit;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        opacity: 0.6;
      }
      .chat-mode .mode-btn[aria-pressed="true"] {
        background: #007aff;
        color: #fff;
        opacity: 1;
      }
      .message.activity {
        align-self: flex-start;
        background: #f0f0f0;
        color: #666;
        font-size: 13px;
        font-style: italic;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      [data-theme="dark"] .message.activity { background: #2a2a2a; color: #aaa; }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .message.activity { background: #2a2a2a; color: #aaa; }
      }
      .message.activity::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #007aff;
        animation: so-pulse 1s ease-in-out infinite;
      }
      @keyframes so-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }
      .chat-input textarea {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid #ddd;
        border-radius: 8px;
        resize: none;
        font-family: inherit;
        font-size: inherit;
        outline: none;
      }
      [data-theme="dark"] .chat-input textarea {
        background: #2a2a2a;
        border-color: #444;
        color: #fff;
      }
      @media (prefers-color-scheme: dark) {
        [data-theme="auto"] .chat-input textarea {
          background: #2a2a2a;
          border-color: #444;
          color: #fff;
        }
      }
      .chat-input button {
        padding: 10px 16px;
        background: #007aff;
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 500;
      }
      .chat-input button:hover { background: #0066dd; }
      .chat-input button:disabled { background: #999; cursor: not-allowed; }
      /* Phone: bottom sheet (not full-viewport empty slab). Close (×) stays in fold. */
      @media (max-width: 480px) {
        .shareout-chat:not(.inline) {
          width: 100%;
          max-height: min(70vh, 560px);
          height: min(70vh, 560px);
          bottom: 0;
          right: 0;
          left: 0;
          border-radius: 16px 16px 0 0;
          box-shadow: 0 -8px 32px rgba(0,0,0,0.18);
        }
        .shareout-chat:not(.inline).minimized {
          width: auto;
          max-width: calc(100% - 32px);
          height: 48px;
          left: auto;
          right: 16px;
          bottom: 16px;
          border-radius: 24px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        .shareout-chat:not(.inline) .minimize-btn {
          font-size: 22px;
          line-height: 1;
          min-width: 36px;
          min-height: 36px;
        }
      }
    `;
  }

  private bindEvents(): void {
    if (!this.shadow) return;

    const header = this.shadow.querySelector('.chat-header');
    const sendBtn = this.shadow.querySelector('.send-btn');

    header?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.minimize-btn')) return;
      this.toggle();
    });
    this.shadow.querySelector('.minimize-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    sendBtn?.addEventListener('click', () => this.onSendClick());

    this.inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  private onSendClick(): void {
    if (this.pilotRunning && !this.pendingAsk) {
      void this.agent.pilot.stop();
      return;
    }
    void this.sendMessage();
  }

  private async sendMessage(): Promise<void> {
    if (!this.inputEl || !this.messagesEl) return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    if (this.pendingAsk) {
      this.inputEl.value = '';
      this.addMessage('user', text);
      const resolve = this.pendingAsk;
      this.pendingAsk = null;
      resolve(text);
      return;
    }

    if (this.pilotRunning) return;

    if (this.activeMode === 'auto' && this.pilotAvailable) {
      this.inputEl.value = '';
      await this.runPilot(text);
      return;
    }

    this.inputEl.value = '';
    this.addMessage('user', text);

    const handle: MessageHandle | undefined = this.view?.addBot('');
    const assistantEl = handle?.el ?? this.addMessage('assistant', '');
    let acc = '';

    try {
      for await (const chunk of this.agent.chat({
        message: text,
        conversationId: this.currentConversationId || undefined,
      })) {
        if (chunk.type === 'content' && chunk.content) {
          acc += chunk.content;
          if (handle) handle.text(acc);
          else assistantEl.textContent = acc;
        } else if (chunk.type === 'done') {
          if (chunk.conversationId) this.currentConversationId = chunk.conversationId;
          this.announcer?.announce('Reply ready', { now: true });
        } else if (chunk.type === 'error') {
          const err = `Error: ${chunk.error}`;
          if (handle) handle.text(err);
          else assistantEl.textContent = err;
          assistantEl.classList.add('error');
        }
      }
    } catch (e) {
      const err = `Error: ${e instanceof Error ? e.message : 'Unknown error'}`;
      if (handle) handle.text(err);
      else assistantEl.textContent = err;
      assistantEl.classList.add('error');
    }
  }

  private async runPilot(task: string): Promise<void> {
    if (!this.view) return;

    this.pilotRunning = true;
    this.addMessage('user', task);

    const activity = document.createElement('div');
    activity.className = 'message activity';
    activity.textContent = 'Working on it…';
    this.view.add(activity);
    this.view.controller.stickToBottom();

    this.setComposerRunning(true);

    const onEvent = (e: { kind: 'status' | 'activity' | 'history'; detail: unknown }): void => {
      const label = this.activityLabel(e);
      if (label) {
        activity.textContent = label;
        this.view?.controller.stickToBottom();
      }
    };

    try {
      const result = await this.agent.pilot(task, {
        showPanel: false,
        maskContent: true,
        maxSteps: 15,
        instructions: this.options.pilotInstructions,
        onAskUser: (question: string) => this.askUser(question),
        onEvent,
      });
      activity.remove();
      const reply = this.addMessage('assistant', result.data || (result.success ? 'Done.' : "I couldn't complete that."));
      if (!result.success) reply.classList.add('error');
    } catch (e) {
      activity.remove();
      if (e instanceof ShareOutError && e.code === 'PILOT_DISABLED') {
        this.pilotAvailable = false;
        this.hideToggle();
        this.activeMode = 'ask';
        this.addMessage('assistant', "This page doesn't have Pilot enabled.").classList.add('error');
      } else {
        this.addMessage('assistant', `Error: ${e instanceof Error ? e.message : 'Unknown error'}`).classList.add('error');
      }
    } finally {
      this.pendingAsk = null;
      this.pilotRunning = false;
      this.setComposerRunning(false);
    }
  }

  private askUser(question: string): Promise<string> {
    this.addMessage('assistant', question);
    return new Promise<string>((resolve) => {
      this.pendingAsk = resolve;
      this.setComposerRunning(true);
    });
  }

  private activityLabel(e: { kind: string; detail: unknown }): string | null {
    if (e.kind === 'status') {
      return e.detail === 'running' ? 'Working on it…' : null;
    }
    if (e.kind !== 'activity') return null;
    const a = e.detail as { type?: string; tool?: string };
    switch (a?.type) {
      case 'thinking':
        return 'Thinking…';
      case 'retrying':
        return 'Retrying…';
      case 'executing':
        return this.toolLabel(a.tool);
      default:
        return null;
    }
  }

  private toolLabel(tool?: string): string {
    switch (tool) {
      case 'click_element_by_index':
        return 'Clicking…';
      case 'input_text':
        return 'Typing…';
      case 'select_dropdown_option':
        return 'Choosing an option…';
      case 'scroll':
      case 'scroll_horizontally':
        return 'Scrolling…';
      case 'wait':
        return 'Waiting for the page…';
      case 'ask_user':
        return 'Needs your input…';
      case 'done':
        return 'Finishing…';
      default:
        return 'Working…';
    }
  }

  private setComposerRunning(running: boolean): void {
    if (!this.shadow) return;
    const sendBtn = this.shadow.querySelector('.send-btn') as HTMLButtonElement | null;
    const awaitingAnswer = running && !!this.pendingAsk;
    if (this.inputEl) this.inputEl.disabled = running && !awaitingAnswer;
    if (sendBtn) sendBtn.textContent = running && !awaitingAnswer ? 'Stop' : 'Send';
  }

  private addMessage(role: 'user' | 'assistant', content: string): HTMLElement {
    if (!this.view) {
      throw new ShareOutError('Widget not mounted', 'WIDGET_ERROR', 400);
    }
    return role === 'user' ? this.view.addUser(content).el : this.view.addBot(content).el;
  }
}

// ============================================================================
// Dashboard SDK Types & Implementation
// ============================================================================
