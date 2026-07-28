// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { CanvasMutationObserver } from '../src/dom/mutation-observer';

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe('CanvasMutationObserver.suppressDuring', () => {
  it('does not emit ops for a DOM change applied inside suppressDuring (no echo)', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const batches: unknown[] = [];
    const obs = new CanvasMutationObserver((b) => batches.push(b));
    obs.observe(root);

    obs.suppressDuring(() => {
      const el = document.createElement('p');
      el.setAttribute('data-editor-id', 'sup-1');
      el.textContent = 'remote change';
      root.appendChild(el);
    });

    await tick();
    expect(batches).toHaveLength(0);
    obs.disconnect();
  });

  it('still emits ops for a normal (unsuppressed) DOM change', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const batches: { ops: unknown[] }[] = [];
    const obs = new CanvasMutationObserver((b) => batches.push(b));
    obs.observe(root);

    const el = document.createElement('p');
    el.setAttribute('data-editor-id', 'norm-1');
    root.appendChild(el);

    await tick();
    expect(batches.length).toBeGreaterThan(0);
    obs.disconnect();
  });

  it('resumes after suppression so later local edits are still observed', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const batches: unknown[] = [];
    const obs = new CanvasMutationObserver((b) => batches.push(b));
    obs.observe(root);

    obs.suppressDuring(() => {
      const el = document.createElement('p');
      el.setAttribute('data-editor-id', 'sup-2');
      root.appendChild(el);
    });
    await tick();
    expect(batches).toHaveLength(0);

    // A subsequent local edit (outside suppression) must be observed again.
    const local = document.createElement('p');
    local.setAttribute('data-editor-id', 'local-1');
    root.appendChild(local);

    await tick();
    expect(batches.length).toBeGreaterThan(0);
    obs.disconnect();
  });
});
