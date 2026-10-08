import { describe, expect, it, vi } from 'vitest';
import { createTextStream, STREAM_EDIT_INTERVAL_MS } from '../../../src/chat-platforms/text-stream';

function setup(over: Partial<{ post: unknown; edit: boolean | Error }> = {}) {
  let t = 0;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const post = vi.fn(async (_text: string) => ('post' in over ? over.post : 'ref1'));
  const edit = vi.fn(async (_ref: unknown, _text: string) => {
    if (over.edit instanceof Error) throw over.edit;
    return over.edit ?? true;
  });
  const send = vi.fn(async (_text: string) => {});
  return { stream: createTextStream({ post, edit, send }, clock.now), post, edit, send, clock };
}

describe('createTextStream', () => {
  it('posts a placeholder on the first delta and throttles edits to the interval', async () => {
    const { stream, post, edit, clock } = setup();
    await stream.delta('Hel');
    expect(post).toHaveBeenCalledWith('Hel');
    await stream.delta('lo');
    expect(edit).not.toHaveBeenCalled();
    clock.advance(STREAM_EDIT_INTERVAL_MS);
    await stream.delta(' world');
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith('ref1', 'Hello world');
    await stream.delta('!');
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('ignores leading whitespace-only deltas', async () => {
    const { stream, post } = setup();
    await stream.delta('  ');
    expect(post).not.toHaveBeenCalled();
    await stream.delta('Hi');
    expect(post).toHaveBeenCalledWith('  Hi');
  });

  it('finishes with a final edit of the full reply', async () => {
    const { stream, edit, send } = setup();
    await stream.delta('Looking');
    await stream.finish('Here is the answer.');
    expect(edit).toHaveBeenLastCalledWith('ref1', 'Here is the answer.');
    expect(send).not.toHaveBeenCalled();
  });

  it('skips the final edit when the message already shows the final text', async () => {
    const { stream, edit, send } = setup();
    await stream.delta('Done.');
    await stream.finish('Done.');
    expect(edit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the final text when nothing was streamed', async () => {
    const { stream, send, post } = setup();
    await stream.finish('Whole reply');
    expect(post).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('Whole reply');
  });

  it('does nothing for an empty final reply', async () => {
    const { stream, send, edit } = setup();
    await stream.finish('');
    await stream.delta('x');
    await stream.finish('');
    expect(send).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('settles a throttled message to the full streamed text when the final reply is empty', async () => {
    const { stream, edit, send } = setup();
    await stream.delta('Let me ');
    await stream.delta('share that.');
    await stream.finish('');
    expect(edit).toHaveBeenCalledWith('ref1', 'Let me share that.');
    expect(send).not.toHaveBeenCalled();
  });

  it('falls back to sending the final text once when the final edit fails', async () => {
    const { stream, send } = setup({ edit: false });
    await stream.delta('partial');
    await stream.finish('full reply');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('full reply');
  });

  it('stops editing after a failed mid-stream edit and sends the final once', async () => {
    const { stream, edit, send, clock } = setup({ edit: new Error('429') });
    await stream.delta('a');
    clock.advance(STREAM_EDIT_INTERVAL_MS);
    await stream.delta('b');
    clock.advance(STREAM_EDIT_INTERVAL_MS);
    await stream.delta('c');
    expect(edit).toHaveBeenCalledTimes(1);
    await stream.finish('abc!');
    expect(edit).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('abc!');
  });

  it('sends the final text when the placeholder could not be posted', async () => {
    const { stream, edit, send } = setup({ post: null });
    await stream.delta('hi');
    await stream.delta(' there');
    await stream.finish('hi there');
    expect(edit).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('hi there');
  });
});
