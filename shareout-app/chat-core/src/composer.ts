/**
 * Wire a chat composer (input + send button + optional form) to a submit handler.
 * Covers the shared behaviour all three ShareOut chats hand-rolled: send on button
 * click, send on Enter (Shift+Enter for newline in a textarea), trim + clear, a
 * busy/disabled guard, and optional textarea auto-resize.
 */
export interface ComposerOptions {
  input: HTMLInputElement | HTMLTextAreaElement | null;
  button?: HTMLElement | null;
  form?: HTMLFormElement | null;
  /** Submit when Enter is pressed in the input. Default true. */
  submitOnEnter?: boolean;
  /** Grow a textarea with its content up to `maxHeight`. Default false. */
  autoResize?: boolean;
  /** Max auto-resize height in px. Default 120. */
  maxHeight?: number;
  /** Clear the input after a successful submit. Default true. */
  clearOnSubmit?: boolean;
  /** Return false to block submission (e.g. while busy). */
  guard?: () => boolean;
  onSubmit: (text: string) => void;
}

export function wireComposer(opts: ComposerOptions): void {
  const {
    input,
    button,
    form,
    submitOnEnter = true,
    autoResize = false,
    maxHeight = 120,
    clearOnSubmit = true,
    guard,
    onSubmit,
  } = opts;

  function resize(): void {
    if (!autoResize || !input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, maxHeight) + 'px';
  }

  function submit(): void {
    if (!input) return;
    if (guard && !guard()) return;
    const text = (input.value || '').trim();
    if (!text) return;
    if (clearOnSubmit) {
      input.value = '';
      resize();
    }
    onSubmit(text);
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  }

  if (button) {
    button.addEventListener('click', () => submit());
  }

  if (input) {
    if (autoResize) input.addEventListener('input', resize);
    if (submitOnEnter) {
      input.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' && !ke.shiftKey) {
          e.preventDefault();
          submit();
        }
      });
    }
  }
}
