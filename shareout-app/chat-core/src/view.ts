import { escapeHtml } from './util';
import {
  createScrollController,
  type ScrollController,
  type ScrollControllerOptions,
} from './scroll-controller';
import { createUnreadTracker, type UnreadTracker } from './unread';

/**
 * Class names + structure for a chat's message list. Each ShareOut chat keeps its
 * own CSS, so the core stays look-agnostic: callers pass the classes their stylesheet
 * already defines. When `contentClass` is set, message text is written into an inner
 * `<div class="contentClass">` (the editor's structure); otherwise it is written
 * straight onto the bubble element (home / create).
 */
export interface ChatViewTheme {
  userClass: string;
  botClass: string;
  /** Optional inner content wrapper class. */
  contentClass?: string;
  /** Class for the standalone typing indicator node. */
  typingClass?: string;
  /** Inner HTML for the typing indicator (e.g. animated dots). */
  typingHtml?: string;
}

/** A handle to one rendered message, letting callers update it as a stream arrives. */
export interface MessageHandle {
  /** The outer bubble element. */
  el: HTMLElement;
  /** The element that holds the message body (inner content div, or `el`). */
  contentEl: HTMLElement;
  /** Replace the body with plain text (escaped). */
  text(value: string): MessageHandle;
  /** Replace the body with raw HTML. */
  html(value: string): MessageHandle;
}

export interface TypingHandle {
  el: HTMLElement;
  remove(): void;
}

export interface ChatView {
  readonly container: HTMLElement;
  /** Shared reading-behaviour engine (follow/hold/away, jump, anchor). */
  readonly controller: ScrollController;
  /** Unread tracker — present only when `onUnread` was supplied. */
  readonly unread?: UnreadTracker;
  addUser(text: string): MessageHandle;
  addBot(text?: string): MessageHandle;
  /** Append an arbitrary node (rich cards, widgets) and stick to the edge if following. */
  add<T extends Node>(node: T): T;
  /** Append a standalone typing indicator; call `.remove()` when the reply starts. */
  typing(): TypingHandle;
  /** Force a return to the live edge (jump-to-latest). */
  scrollToBottom(): void;
}

function makeHandle(
  el: HTMLElement,
  contentEl: HTMLElement,
  view: ChatView,
  /** When set, `.text()` routes through this (safe markdown) instead of textContent. */
  formatText?: (text: string) => string,
): MessageHandle {
  const handle: MessageHandle = {
    el,
    contentEl,
    text(value: string) {
      if (formatText) contentEl.innerHTML = formatText(value);
      else contentEl.textContent = value;
      view.controller.stickToBottom();
      return handle;
    },
    html(value: string) {
      contentEl.innerHTML = value;
      view.controller.stickToBottom();
      return handle;
    },
  };
  return handle;
}

export interface ChatViewOptions {
  /**
   * Render bot message text to HTML (e.g. markdown). Applied to addBot(text) and
   * to streamed handle.text() updates for bot messages. User messages stay plain
   * textContent. Opt-in — defaults to plain text.
   */
  renderBot?: (text: string) => string;
  /** Tuning for the scroll controller (edge threshold, anchor offset). */
  scroll?: Pick<ScrollControllerOptions, 'threshold' | 'anchorOffset'>;
  /**
   * The element that actually scrolls, when it differs from the message container
   * (e.g. the editor appends to an inner list inside a scrolling `.rail-body`).
   * Defaults to `container`.
   */
  scrollViewport?: HTMLElement;
  /** Drive a jump-to-latest control: fired when the at-edge state changes. */
  onEdgeChange?: (atEdge: boolean) => void;
  /** Enable unread tracking: fired with the count of messages that arrived while away. */
  onUnread?: (count: number) => void;
  /** Build a "new messages" divider node inserted before the first unread message. */
  makeUnreadDivider?: () => HTMLElement;
}

/**
 * Wrap a messages container with the shared add/typing/scroll primitives every
 * ShareOut chat reimplemented, backed by the shared {@link ScrollController} so all
 * of them obey the reading-first rules (follow only at the edge, anchor a new turn
 * near the top, never yank a reader who scrolled away). Pure DOM, no framework.
 */
export function createChatView(
  container: HTMLElement,
  theme: ChatViewTheme,
  options: ChatViewOptions = {}
): ChatView {
  let unread: UnreadTracker | undefined;

  const controller = createScrollController(options.scrollViewport ?? container, {
    threshold: options.scroll?.threshold,
    anchorOffset: options.scroll?.anchorOffset,
    onEdgeChange: (atEdge) => {
      if (atEdge) unread?.reset();
      options.onEdgeChange?.(atEdge);
    },
  });

  if (options.onUnread) {
    unread = createUnreadTracker(controller, {
      onCount: options.onUnread,
      makeDivider: options.makeUnreadDivider,
    });
  }

  const view: ChatView = {
    container,
    controller,
    get unread() {
      return unread;
    },
    scrollToBottom() {
      controller.jumpToLatest();
    },
    add(node) {
      container.appendChild(node);
      controller.stickToBottom();
      if (node instanceof HTMLElement) unread?.onAppend(node);
      return node;
    },
    addUser(text: string) {
      return addMessage(theme.userClass, text, 'user');
    },
    addBot(text?: string) {
      return addMessage(theme.botClass, text, 'bot');
    },
    typing() {
      const el = document.createElement('div');
      if (theme.typingClass) el.className = theme.typingClass;
      el.innerHTML = theme.typingHtml ?? '';
      container.appendChild(el);
      controller.stickToBottom();
      return {
        el,
        remove() {
          el.remove();
        },
      };
    },
  };

  function addMessage(
    className: string,
    text: string | undefined,
    role: 'user' | 'bot'
  ): MessageHandle {
    const el = document.createElement('div');
    el.className = className;
    let contentEl = el;
    if (theme.contentClass) {
      contentEl = document.createElement('div');
      contentEl.className = theme.contentClass;
      el.appendChild(contentEl);
    }
    if (text != null) {
      if (role === 'bot' && options.renderBot) contentEl.innerHTML = options.renderBot(text);
      else contentEl.textContent = text;
    }
    container.appendChild(el);
    if (role === 'user') {
      // The reader's own new turn: anchor near the top so the answer streams into the
      // space below it and the question stays readable. [4,6]
      controller.anchorTop(el);
    } else {
      controller.stickToBottom();
      unread?.onAppend(el);
    }
    return makeHandle(el, contentEl, view, role === 'bot' ? options.renderBot : undefined);
  }

  return view;
}

export { escapeHtml };
