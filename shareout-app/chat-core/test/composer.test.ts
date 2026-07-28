import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireComposer } from '../src/composer';

describe('wireComposer', () => {
  let input: HTMLInputElement;
  let button: HTMLButtonElement;
  beforeEach(() => {
    document.body.innerHTML = '<input id="i"><button id="b"></button>';
    input = document.getElementById('i') as HTMLInputElement;
    button = document.getElementById('b') as HTMLButtonElement;
  });

  it('submits trimmed text on button click and clears the input', () => {
    const onSubmit = vi.fn();
    wireComposer({ input, button, onSubmit });
    input.value = '  hi  ';
    button.click();
    expect(onSubmit).toHaveBeenCalledWith('hi');
    expect(input.value).toBe('');
  });

  it('submits on Enter, ignores empty input', () => {
    const onSubmit = vi.fn();
    wireComposer({ input, button, onSubmit });
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSubmit).not.toHaveBeenCalled();
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSubmit).toHaveBeenCalledWith('x');
  });

  it('blocks submission when guard returns false', () => {
    const onSubmit = vi.fn();
    wireComposer({ input, button, guard: () => false, onSubmit });
    input.value = 'x';
    button.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
