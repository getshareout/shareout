import { EDITOR_ID_ATTR, ensureEditorId } from './editor-ids';

export type MutationOp =
  | { type: 'attr'; id: string; name: string; value: string | null }
  | { type: 'text'; id: string; value: string }
  | { type: 'insert'; parentId: string; html: string; index: number }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; parentId: string; index: number };

export interface MutationBatch {
  ops: MutationOp[];
  timestamp: number;
}

type MutationCallback = (batch: MutationBatch) => void;

export class CanvasMutationObserver {
  private observer: MutationObserver | null = null;
  private pendingOps: MutationOp[] = [];
  private frameId: number | null = null;
  private paused = false;
  private callback: MutationCallback;
  private root: Node | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  observe(root: Node): void {
    this.root = root;
    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations));
    this.observer.observe(root, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });
  }

  disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.root = null;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  withPaused<T>(fn: () => T): T {
    this.pause();
    try {
      return fn();
    } finally {
      this.resume();
    }
  }

  /**
   * Apply a DOM change (remote/AI/undo) without echoing it back as ops. The native
   * MutationObserver delivers records on a microtask *after* fn returns, so a plain
   * synchronous pause/resume wouldn't suppress them — here we also drain the queued
   * records and defer resume() to a microtask, so the pending callback fires while
   * still paused (and finds nothing to emit).
   */
  suppressDuring<T>(fn: () => T): T {
    this.pause();
    try {
      return fn();
    } finally {
      this.observer?.takeRecords();
      this.pendingOps = [];
      queueMicrotask(() => this.resume());
    }
  }

  private handleMutations(mutations: MutationRecord[]): void {
    if (this.paused) return;

    for (const mutation of mutations) {
      this.processMutation(mutation);
    }

    this.scheduleBatch();
  }

  private processMutation(mutation: MutationRecord): void {
    const target = mutation.target;

    switch (mutation.type) {
      case 'attributes': {
        if (!(target instanceof Element)) break;
        if (mutation.attributeName === EDITOR_ID_ATTR) break;
        if (mutation.attributeName === 'data-editor-hover') break;
        if (mutation.attributeName === 'data-editor-selected') break;
        if (mutation.attributeName === 'data-locked-by') break;

        const id = target.getAttribute(EDITOR_ID_ATTR);
        if (!id) break;

        this.pendingOps.push({
          type: 'attr',
          id,
          name: mutation.attributeName!,
          value: target.getAttribute(mutation.attributeName!),
        });
        break;
      }

      case 'characterData': {
        const parent = target.parentElement;
        if (!parent) break;

        const id = parent.getAttribute(EDITOR_ID_ATTR);
        if (!id) break;

        this.pendingOps.push({
          type: 'text',
          id,
          value: target.textContent || '',
        });
        break;
      }

      case 'childList': {
        for (const node of mutation.removedNodes) {
          if (!(node instanceof Element)) continue;
          const id = node.getAttribute(EDITOR_ID_ATTR);
          if (!id) continue;

          this.pendingOps.push({ type: 'remove', id });
        }

        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (!(node instanceof Element)) continue;

          const parentEl = mutation.target instanceof Element ? mutation.target : null;
          if (!parentEl) continue;

          const parentId = parentEl.getAttribute(EDITOR_ID_ATTR) || ensureEditorId(parentEl);
          ensureEditorId(node);

          const index = Array.from(parentEl.children).indexOf(node);

          this.pendingOps.push({
            type: 'insert',
            parentId,
            html: node.outerHTML,
            index,
          });
        }
        break;
      }
    }
  }

  private scheduleBatch(): void {
    if (this.frameId !== null) return;

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.flushBatch();
    });
  }

  private flushBatch(): void {
    if (this.pendingOps.length === 0) return;

    const ops = this.deduplicateOps(this.pendingOps);
    this.pendingOps = [];

    this.callback({
      ops,
      timestamp: Date.now(),
    });
  }

  private deduplicateOps(ops: MutationOp[]): MutationOp[] {
    const attrMap = new Map<string, MutationOp>();
    const textMap = new Map<string, MutationOp>();
    const removes = new Set<string>();
    const inserts: MutationOp[] = [];

    for (const op of ops) {
      if (op.type === 'attr') {
        attrMap.set(`${op.id}:${op.name}`, op);
      } else if (op.type === 'text') {
        textMap.set(op.id, op);
      } else if (op.type === 'remove') {
        removes.add(op.id);
        attrMap.forEach((v, k) => {
          if (k.startsWith(op.id + ':')) attrMap.delete(k);
        });
        textMap.delete(op.id);
      } else if (op.type === 'insert') {
        inserts.push(op);
      }
    }

    const result: MutationOp[] = [];
    result.push(...attrMap.values());
    result.push(...textMap.values());
    for (const id of removes) {
      result.push({ type: 'remove', id });
    }
    result.push(...inserts);

    return result;
  }
}
