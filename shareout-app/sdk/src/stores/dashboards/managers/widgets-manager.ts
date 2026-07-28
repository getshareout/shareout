import type { RealtimeDoc } from '../../realtime-doc';
import type { LayoutItem, Widget, WidgetConfig, WidgetType } from '../types';

/** CRUD for dashboard widgets and their rich-text content in the realtime doc. */
export class WidgetsManager {
  constructor(private doc: RealtimeDoc) {}

  list(): Widget[] {
    const widgets = this.doc.map<Widget>('widgets');
    return Object.values(widgets.toJSON() as unknown as Record<string, Widget>);
  }

  get(id: string): Widget | null {
    const widgets = this.doc.map<Widget>('widgets');
    return (widgets.get(id) as unknown as Widget) || null;
  }

  add(type: WidgetType, config: WidgetConfig, position?: Partial<LayoutItem>): Widget {
    const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const widget: Widget = {
      id,
      type,
      title: '',
      dataSource: null,
      config,
      owner: null,
      locked: false,
    };

    this.doc.transact(() => {
      const widgets = this.doc.map<Widget>('widgets');
      widgets.set(id, widget as unknown as Widget);

      if (position) {
        const layout = this.doc.array<LayoutItem>('layout');
        layout.push([{
          widgetId: id,
          x: position.x ?? 0,
          y: position.y ?? 0,
          w: position.w ?? 4,
          h: position.h ?? 3,
          ...position,
        }]);
      }
    });

    return widget;
  }

  update(id: string, changes: Partial<Widget>): void {
    const widgets = this.doc.map<Widget>('widgets');
    const existing = widgets.get(id) as unknown as Widget;
    if (existing) {
      widgets.set(id, { ...existing, ...changes } as unknown as Widget);
    }
  }

  delete(id: string): boolean {
    const widgets = this.doc.map<Widget>('widgets');
    const existed = widgets.has(id);
    if (existed) {
      this.doc.transact(() => {
        widgets.delete(id);
        const layout = this.doc.array<LayoutItem>('layout');
        const items = layout.toArray() as unknown as LayoutItem[];
        const idx = items.findIndex(item => item.widgetId === id);
        if (idx >= 0) layout.delete(idx, 1);
      });
    }
    return existed;
  }

  duplicate(id: string): Widget | null {
    const existing = this.get(id);
    if (!existing) return null;
    return this.add(existing.type, { ...existing.config });
  }

  observe(handler: (widgets: Widget[]) => void): () => void {
    const widgets = this.doc.map<Widget>('widgets');
    const callback = () => handler(this.list());
    widgets.observe(callback);
    return () => widgets.unobserve(callback);
  }

  getContent(id: string) {
    return this.doc.text(`widget-content-${id}`);
  }

  setContent(id: string, html: string): void {
    const text = this.doc.text(`widget-content-${id}`);
    this.doc.transact(() => {
      if (text.length > 0) text.delete(0, text.length);
      text.insert(0, html);
    });
  }

  setOwner(id: string, userId: string | null): void {
    this.update(id, { owner: userId });
  }

  lock(id: string): void {
    this.update(id, { locked: true });
  }

  unlock(id: string): void {
    this.update(id, { locked: false });
  }
}
