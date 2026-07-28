import type { RealtimeDoc } from '../../realtime-doc';
import type { FilterDefinition, FilterState, FilterValue } from '../types';

/** Filter definitions and live filter state stored in the realtime doc. */
export class FiltersManager {
  constructor(private doc: RealtimeDoc) {}

  getDefinitions(): FilterDefinition[] {
    const defs = this.doc.array<FilterDefinition>('filterDefs');
    return defs.toArray() as unknown as FilterDefinition[];
  }

  addDefinition(def: Omit<FilterDefinition, 'id'>): FilterDefinition {
    const id = `filter-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const definition: FilterDefinition = { id, ...def };
    const defs = this.doc.array<FilterDefinition>('filterDefs');
    defs.push([definition as unknown as FilterDefinition]);
    return definition;
  }

  updateDefinition(id: string, changes: Partial<FilterDefinition>): void {
    const defs = this.doc.array<FilterDefinition>('filterDefs');
    const items = defs.toArray() as unknown as FilterDefinition[];
    const idx = items.findIndex(d => d.id === id);
    if (idx >= 0) {
      const updated = { ...items[idx], ...changes };
      defs.delete(idx, 1);
      defs.insert(idx, [updated as unknown as FilterDefinition]);
    }
  }

  deleteDefinition(id: string): boolean {
    const defs = this.doc.array<FilterDefinition>('filterDefs');
    const items = defs.toArray() as unknown as FilterDefinition[];
    const idx = items.findIndex(d => d.id === id);
    if (idx >= 0) {
      defs.delete(idx, 1);
      return true;
    }
    return false;
  }

  getState(): FilterState {
    const state = this.doc.map<FilterValue>('filters');
    return state.toJSON() as unknown as FilterState;
  }

  setValue(filterId: string, value: FilterValue): void {
    const state = this.doc.map<FilterValue>('filters');
    state.set(filterId, value as unknown as FilterValue);
  }

  reset(): void {
    const state = this.doc.map<FilterValue>('filters');
    const defs = this.getDefinitions();
    this.doc.transact(() => {
      for (const def of defs) {
        if (def.defaultValue !== undefined) {
          state.set(def.id, def.defaultValue as unknown as FilterValue);
        } else {
          state.delete(def.id);
        }
      }
    });
  }

  observe(handler: (state: FilterState) => void): () => void {
    const state = this.doc.map<FilterValue>('filters');
    const callback = () => handler(this.getState());
    state.observe(callback);
    return () => state.unobserve(callback);
  }
}
