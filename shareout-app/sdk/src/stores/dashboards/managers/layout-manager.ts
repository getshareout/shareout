import type { RealtimeDoc } from '../../realtime-doc';
import type { LayoutItem } from '../types';

/** Grid layout positions for widgets in the realtime doc `layout` array. */
export class LayoutManager {
  constructor(private doc: RealtimeDoc) {}

  get(): LayoutItem[] {
    const layout = this.doc.array<LayoutItem>('layout');
    return layout.toArray() as unknown as LayoutItem[];
  }

  update(widgetId: string, position: Partial<LayoutItem>): void {
    const layout = this.doc.array<LayoutItem>('layout');
    const items = layout.toArray() as unknown as LayoutItem[];
    const idx = items.findIndex(item => item.widgetId === widgetId);
    if (idx >= 0) {
      const updated = { ...items[idx], ...position };
      layout.delete(idx, 1);
      layout.insert(idx, [updated as unknown as LayoutItem]);
    }
  }

  move(widgetId: string, x: number, y: number): void {
    this.update(widgetId, { x, y });
  }

  resize(widgetId: string, w: number, h: number): void {
    this.update(widgetId, { w, h });
  }

  observe(handler: (layout: LayoutItem[]) => void): () => void {
    const layout = this.doc.array<LayoutItem>('layout');
    const callback = () => handler(this.get());
    layout.observe(callback);
    return () => layout.unobserve(callback);
  }
}
