import type { RealtimeDoc } from '../../realtime-doc';
import type { FilterPreset, FilterValue } from '../types';

/** Saved filter presets (bookmarks) with default/pin support. */
export class PresetsManager {
  constructor(private doc: RealtimeDoc) {}

  list(): FilterPreset[] {
    const presets = this.doc.map<FilterPreset>('filterPresets');
    return Object.values(presets.toJSON() as unknown as Record<string, FilterPreset>);
  }

  create(preset: Omit<FilterPreset, 'id' | 'createdAt'>): FilterPreset {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const full: FilterPreset = {
      id,
      createdAt: new Date().toISOString(),
      ...preset,
    };
    const presets = this.doc.map<FilterPreset>('filterPresets');
    presets.set(id, full as unknown as FilterPreset);
    return full;
  }

  update(id: string, changes: Partial<FilterPreset>): void {
    const presets = this.doc.map<FilterPreset>('filterPresets');
    const existing = presets.get(id) as unknown as FilterPreset;
    if (existing) {
      presets.set(id, { ...existing, ...changes } as unknown as FilterPreset);
    }
  }

  delete(id: string): boolean {
    const presets = this.doc.map<FilterPreset>('filterPresets');
    const existed = presets.has(id);
    if (existed) presets.delete(id);
    return existed;
  }

  apply(id: string): void {
    const preset = this.list().find(p => p.id === id);
    if (!preset) return;
    const state = this.doc.map<FilterValue>('filters');
    this.doc.transact(() => {
      for (const [key, value] of Object.entries(preset.filters)) {
        state.set(key, value as unknown as FilterValue);
      }
    });
  }

  setDefault(id: string | null): void {
    const presets = this.list();
    this.doc.transact(() => {
      for (const preset of presets) {
        this.update(preset.id, { isDefault: preset.id === id });
      }
    });
  }

  getDefault(): FilterPreset | null {
    return this.list().find(p => p.isDefault) || null;
  }

  pin(id: string): void {
    this.update(id, { isPinned: true });
  }

  unpin(id: string): void {
    this.update(id, { isPinned: false });
  }

  getPinned(): FilterPreset[] {
    return this.list().filter(p => p.isPinned);
  }

  observe(handler: (presets: FilterPreset[]) => void): () => void {
    const presets = this.doc.map<FilterPreset>('filterPresets');
    const callback = () => handler(this.list());
    presets.observe(callback);
    return () => presets.unobserve(callback);
  }
}
