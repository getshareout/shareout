import type { ChatViewTheme } from './view';

/**
 * Turnkey theme matching `baseChatStyles` below. A new chat can do:
 *   const view = createChatView(el, DEFAULT_CHAT_THEME);
 * and inject `baseChatStyles` once, instead of authoring its own bubble CSS.
 * The three existing ShareOut chats keep their own classes and ignore these.
 */
export const DEFAULT_CHAT_THEME: ChatViewTheme = {
  userClass: 'cc-msg cc-msg-user',
  botClass: 'cc-msg cc-msg-bot',
  typingClass: 'cc-typing',
  typingHtml: '<span></span><span></span><span></span>',
};

/**
 * Opt-in base stylesheet for a chat-core view + composer. Themeable via CSS custom
 * properties (`--cc-*`) with sensible fallbacks. Inject once (e.g. into a <style>).
 */
export const baseChatStyles = `
.cc-msgs { display: flex; flex-direction: column; gap: var(--cc-gap, 12px); overflow-y: auto; padding: var(--cc-pad, 16px); }
.cc-msg { max-width: 86%; padding: 10px 14px; border-radius: var(--cc-radius, 16px); line-height: 1.5;
  font-size: var(--cc-font-size, 14px); white-space: pre-wrap; word-wrap: break-word;
  content-visibility: auto; contain-intrinsic-size: auto 60px; }
.cc-msg-user { align-self: flex-end; background: var(--cc-user-bg, #2563eb); color: var(--cc-user-fg, #fff);
  border-bottom-right-radius: 6px; }
.cc-msg-bot { align-self: flex-start; background: var(--cc-bot-bg, #fff); color: var(--cc-bot-fg, #1c1917);
  border: 1px solid var(--cc-bot-border, #e7e5e4); border-bottom-left-radius: 6px; }
.cc-msg-bot a { color: var(--cc-link, #2563eb); }
.cc-msg-bot code { font-family: ui-monospace, monospace; font-size: 0.9em;
  background: var(--cc-code-bg, rgba(0,0,0,.05)); padding: 1px 5px; border-radius: 5px; }
.cc-typing { align-self: flex-start; display: flex; gap: 4px; padding: 12px 14px;
  background: var(--cc-bot-bg, #fff); border: 1px solid var(--cc-bot-border, #e7e5e4);
  border-radius: var(--cc-radius, 16px); border-bottom-left-radius: 6px; }
.cc-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--cc-typing-dot, #a8a29e);
  animation: cc-bounce 1.2s infinite ease-in-out; }
.cc-typing span:nth-child(2) { animation-delay: .15s; }
.cc-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes cc-bounce { 0%,60%,100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
.cc-hit { background: var(--cc-hit-bg, #fde68a); border-radius: 2px; }
.cc-hit-active { background: var(--cc-hit-active-bg, #f59e0b); color: #1c1917; }
.cc-unread-divider { align-self: stretch; text-align: center; font-size: 12px; color: var(--cc-unread-fg, #b45309);
  margin: 4px 0; position: relative; }
.cc-unread-divider::before, .cc-unread-divider::after { content: ''; position: absolute; top: 50%; width: 38%;
  border-top: 1px solid var(--cc-unread-line, #fcd34d); }
.cc-unread-divider::before { left: 0; } .cc-unread-divider::after { right: 0; }
`;
