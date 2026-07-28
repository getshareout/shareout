import * as Y from 'yjs';
import { EDITOR_ID_ATTR, resolveElementBySelector, ensureEditorId } from '../dom/editor-ids';
import type { MutationOp, MutationBatch } from '../dom/mutation-observer';

export interface ElementSyncConfig {
  userId: string;
  doc: Y.Doc;
  getCanvasDocument: () => Document | null;
  onRemoteUpdate?: (ops: MutationOp[]) => void;
}

export class ElementSyncManager {
  private config: ElementSyncConfig;
  private elements: Y.Map<Y.Map<unknown>>;
  private applying = false;

  constructor(config: ElementSyncConfig) {
    this.config = config;
    this.elements = config.doc.getMap('elements');
    this.setupObservers();
  }

  private setupObservers(): void {
    this.elements.observeDeep((events) => {
      if (this.applying) return;

      const ops: MutationOp[] = [];

      for (const event of events) {
        if (event.transaction.origin === this.config.userId) continue;

        ops.push(...this.translateYjsEvent(event));
      }

      if (ops.length > 0 && this.config.onRemoteUpdate) {
        this.config.onRemoteUpdate(ops);
      }
    });
  }

  private translateYjsEvent(event: Y.YEvent<Y.AbstractType<unknown>>): MutationOp[] {
    const ops: MutationOp[] = [];
    const path = event.path;

    if (event instanceof Y.YMapEvent) {
      if (path.length === 0) {
        for (const [key, change] of event.changes.keys) {
          if (change.action === 'delete') {
            ops.push({ type: 'remove', id: key });
          } else if (change.action === 'add') {
            const elMap = this.elements.get(key);
            if (elMap) {
              const parentId = elMap.get('parentId') as string;
              const html = elMap.get('html') as string;
              const index = elMap.get('index') as number;
              if (parentId && html !== undefined) {
                ops.push({ type: 'insert', parentId, html, index: index ?? 0 });
              }
            }
          }
        }
      } else if (path.length >= 1) {
        const elementId = path[0] as string;

        if (path.length === 1) {
          for (const [key, change] of event.changes.keys) {
            if (key === 'attrs') continue;
            if (key === 'textContent') {
              const elMap = this.elements.get(elementId);
              const text = elMap?.get('textContent');
              if (typeof text === 'string') {
                ops.push({ type: 'text', id: elementId, value: text });
              }
            }
          }
        } else if (path.length === 2 && path[1] === 'attrs') {
          for (const [attrName, change] of event.changes.keys) {
            const elMap = this.elements.get(elementId);
            const attrs = elMap?.get('attrs') as Y.Map<string> | undefined;
            const value = attrs?.get(attrName) ?? null;
            ops.push({ type: 'attr', id: elementId, name: attrName, value });
          }
        }
      }
    }

    return ops;
  }

  applyLocalMutations(batch: MutationBatch): void {
    this.applying = true;

    this.config.doc.transact(() => {
      for (const op of batch.ops) {
        this.applyOp(op);
      }
    }, this.config.userId);

    this.applying = false;
  }

  private applyOp(op: MutationOp): void {
    switch (op.type) {
      case 'attr': {
        let elMap = this.elements.get(op.id);
        if (!elMap) {
          elMap = new Y.Map();
          this.elements.set(op.id, elMap);
        }
        let attrs = elMap.get('attrs') as Y.Map<string> | undefined;
        if (!attrs) {
          attrs = new Y.Map();
          elMap.set('attrs', attrs);
        }
        if (op.value === null) {
          attrs.delete(op.name);
        } else {
          attrs.set(op.name, op.value);
        }
        break;
      }

      case 'text': {
        let elMap = this.elements.get(op.id);
        if (!elMap) {
          elMap = new Y.Map();
          this.elements.set(op.id, elMap);
        }
        elMap.set('textContent', op.value);
        break;
      }

      case 'insert': {
        const doc = this.config.getCanvasDocument();
        if (!doc) break;

        const temp = doc.createElement('div');
        temp.innerHTML = op.html;
        const el = temp.firstElementChild;
        if (!el) break;

        const id = el.getAttribute(EDITOR_ID_ATTR) || ensureEditorId(el);

        const elMap = new Y.Map();
        elMap.set('tag', el.tagName.toLowerCase());
        elMap.set('parentId', op.parentId);
        elMap.set('index', op.index);
        elMap.set('html', op.html);
        elMap.set('textContent', el.textContent || '');

        const attrs = new Y.Map<string>();
        for (const attr of el.attributes) {
          if (attr.name !== EDITOR_ID_ATTR) {
            attrs.set(attr.name, attr.value);
          }
        }
        elMap.set('attrs', attrs);

        this.elements.set(id, elMap);
        break;
      }

      case 'remove': {
        this.elements.delete(op.id);
        break;
      }

      case 'move': {
        const elMap = this.elements.get(op.id);
        if (elMap) {
          elMap.set('parentId', op.parentId);
          elMap.set('index', op.index);
        }
        break;
      }
    }
  }

  applyRemoteOps(ops: MutationOp[]): void {
    const doc = this.config.getCanvasDocument();
    if (!doc) return;

    for (const op of ops) {
      this.applyRemoteOp(doc, op);
    }
  }

  private applyRemoteOp(doc: Document, op: MutationOp): void {
    switch (op.type) {
      case 'attr': {
        const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
        if (!el) return;

        if (op.value === null) {
          el.removeAttribute(op.name);
        } else {
          el.setAttribute(op.name, op.value);
        }
        break;
      }

      case 'text': {
        const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
        if (!el) return;
        el.textContent = op.value;
        break;
      }

      case 'insert': {
        const parent = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.parentId}"]`);
        if (!parent) return;

        const temp = doc.createElement('div');
        temp.innerHTML = op.html;
        const el = temp.firstElementChild;
        if (!el) return;

        const refChild = parent.children[op.index] || null;
        parent.insertBefore(el, refChild);
        break;
      }

      case 'remove': {
        const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
        if (!el) return;
        el.remove();
        break;
      }

      case 'move': {
        const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
        const parent = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.parentId}"]`);
        if (!el || !parent) return;

        const refChild = parent.children[op.index] || null;
        parent.insertBefore(el, refChild);
        break;
      }
    }
  }

  getUserId(): string {
    return this.config.userId;
  }

  getDoc(): Y.Doc {
    return this.config.doc;
  }
}
