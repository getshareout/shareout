import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChatView } from '../src/view';

function stubMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  let st = 0;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => st,
    set: (v: number) => {
      st = Math.max(0, Math.min(v, scrollHeight - clientHeight));
    },
  });
}

describe('createChatView', () => {
  let container: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="c"></div>';
    container = document.getElementById('c') as HTMLElement;
  });

  it('renders flat bubbles when no contentClass is set', () => {
    const view = createChatView(container, { userClass: 'msg user', botClass: 'msg ai' });
    const u = view.addUser('hello');
    expect(u.el.className).toBe('msg user');
    expect(u.el.textContent).toBe('hello');
    expect(u.contentEl).toBe(u.el);
  });

  it('wraps body in a content element when contentClass is set', () => {
    const view = createChatView(container, {
      userClass: 'chat-message chat-message-user',
      botClass: 'chat-message chat-message-ai',
      contentClass: 'chat-message-content',
    });
    const bot = view.addBot();
    expect(bot.el.className).toBe('chat-message chat-message-ai');
    expect(bot.contentEl.className).toBe('chat-message-content');
    bot.text('streaming…');
    expect(bot.contentEl.textContent).toBe('streaming…');
    expect(bot.el.querySelector('.chat-message-content')).toBe(bot.contentEl);
  });

  it('text() escapes via textContent; html() sets markup', () => {
    const view = createChatView(container, { userClass: 'u', botClass: 'b' });
    const m = view.addBot();
    m.text('<b>x</b>');
    expect(m.contentEl.innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
    m.html('<i>ok</i>');
    expect(m.contentEl.querySelector('i')?.textContent).toBe('ok');
  });

  it('applies renderBot to bot text but not to user text', () => {
    const view = createChatView(
      container,
      { userClass: 'u', botClass: 'b' },
      { renderBot: (t) => `<em>${t}</em>` }
    );
    const bot = view.addBot('hi');
    expect(bot.contentEl.innerHTML).toBe('<em>hi</em>');
    const user = view.addUser('<x>');
    expect(user.contentEl.textContent).toBe('<x>');
    expect(user.contentEl.querySelector('em')).toBeNull();
  });

  it('applies renderBot on streamed handle.text() for bot messages', () => {
    const view = createChatView(
      container,
      { userClass: 'u', botClass: 'b' },
      { renderBot: (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }
    );
    const bot = view.addBot('');
    bot.text('**bold**');
    expect(bot.contentEl.innerHTML).toBe('<strong>bold</strong>');
  });

  it('exposes the scroll controller and anchors a new user turn into hold', () => {
    const view = createChatView(container, { userClass: 'u', botClass: 'b' });
    expect(view.controller).toBeTruthy();
    view.addUser('a question');
    expect(view.controller.mode).toBe('hold');
  });

  it('counts bot messages that arrive while the reader is away (onUnread)', () => {
    stubMetrics(container, 1000, 200);
    const onUnread = vi.fn();
    const view = createChatView(container, { userClass: 'u', botClass: 'b' }, { onUnread });
    container.scrollTop = 0;
    container.dispatchEvent(new Event('scroll')); // reader scrolled away
    view.addBot('reply');
    expect(view.unread?.count).toBe(1);
    expect(onUnread).toHaveBeenLastCalledWith(1);
  });

  it('does not count while following at the edge', () => {
    stubMetrics(container, 1000, 200);
    const onUnread = vi.fn();
    const view = createChatView(container, { userClass: 'u', botClass: 'b' }, { onUnread });
    view.addBot('reply'); // follows by default
    expect(view.unread?.count).toBe(0);
  });

  it('typing() appends and removes a node', () => {
    const view = createChatView(container, {
      userClass: 'u',
      botClass: 'b',
      typingClass: 'wsa-typing',
      typingHtml: '<span></span>',
    });
    const t = view.typing();
    expect(container.querySelector('.wsa-typing')).toBe(t.el);
    t.remove();
    expect(container.querySelector('.wsa-typing')).toBeNull();
  });
});
