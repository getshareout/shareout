// @shareout/chat-core — shared browser primitives for ShareOut chat UIs
// (home workspace assistant, create builder, visual-editor agent). Each chat keeps
// its own markup/CSS and control flow; this package owns the parts they all
// reimplemented: the SSE read loop, message-list DOM, composer wiring, and the
// streaming-reply extractor.
export type { SSEEvent } from './types';
export { readSSE, streamSSE, type StreamSSEOptions } from './sse';
export { escapeHtml } from './util';
export { extractStreamingReply } from './stream-reply';
export { renderMarkdown } from './markdown';
export {
  createChatView,
  type ChatView,
  type ChatViewTheme,
  type ChatViewOptions,
  type MessageHandle,
  type TypingHandle,
} from './view';
export {
  createScrollController,
  type ScrollController,
  type ScrollControllerOptions,
  type ScrollMode,
} from './scroll-controller';
export { createUnreadTracker, type UnreadTracker, type UnreadTrackerOptions } from './unread';
export { createLiveAnnouncer, type LiveAnnouncer, type LiveAnnouncerOptions } from './announce';
export { createChatSearch, type ChatSearch, type ChatSearchOptions } from './search';
export { wireComposer, type ComposerOptions } from './composer';
export {
  createChatController,
  type ChatController,
  type ChatControllerOptions,
  type ChatRequest,
  type ChatTurnContext,
} from './controller';
export { baseChatStyles, DEFAULT_CHAT_THEME } from './styles';
