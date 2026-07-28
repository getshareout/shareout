import type { RealtimeDoc } from '../../realtime-doc';
import type { FiltersManager } from './filters-manager';
import type { FilterValue, InteractionConfig } from '../types';

export interface InteractionEvent {
  type: 'filter' | 'highlight' | 'navigate' | 'custom';
  value: unknown;
  config: Record<string, unknown>;
}

/**
 * Cross-widget interactions (click → filter, navigate, highlight).
 * Wired to {@link FiltersManager} at dashboard connect time.
 */
export class InteractionsManager {
  private handlers = new Map<string, Set<(event: InteractionEvent) => void>>();
  private filtersManager: FiltersManager | null = null;

  constructor(private doc: RealtimeDoc) {}

  setFiltersManager(filters: FiltersManager): void {
    this.filtersManager = filters;
  }

  define(config: Omit<InteractionConfig, 'id'>): string {
    const id = `interaction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const full: InteractionConfig = { id, ...config };
    const interactions = this.doc.map<InteractionConfig>('interactions');
    interactions.set(id, full as unknown as InteractionConfig);
    return id;
  }

  remove(id: string): void {
    const interactions = this.doc.map<InteractionConfig>('interactions');
    interactions.delete(id);
    this.handlers.delete(id);
  }

  list(): InteractionConfig[] {
    const interactions = this.doc.map<InteractionConfig>('interactions');
    return Object.values(interactions.toJSON() as unknown as Record<string, InteractionConfig>);
  }

  get(id: string): InteractionConfig | null {
    const interactions = this.doc.map<InteractionConfig>('interactions');
    return (interactions.get(id) as unknown as InteractionConfig) || null;
  }

  trigger(widgetId: string, event: 'click' | 'select' | 'hover', data: Record<string, unknown>): void {
    const interactions = this.list();

    for (const interaction of interactions) {
      if (interaction.trigger.widgetId !== widgetId) continue;
      if (interaction.trigger.event !== event) continue;

      const fieldValue = interaction.trigger.field ? data[interaction.trigger.field] : data;
      this.executeAction(interaction, fieldValue);
    }
  }

  private executeAction(interaction: InteractionConfig, value: unknown): void {
    const { action } = interaction;

    switch (action.type) {
      case 'filter':
        if (this.filtersManager && action.config.filterField) {
          this.filtersManager.setValue(
            action.config.filterField as string,
            value as FilterValue,
          );
        }
        break;

      case 'highlight':
        this.notifyTargets(interaction.id, action.target, {
          type: 'highlight',
          value,
          config: action.config,
        });
        break;

      case 'navigate':
        if (action.config.url) {
          window.open(action.config.url as string, action.config.target as string || '_self');
        }
        break;

      case 'custom':
        this.notifyTargets(interaction.id, action.target, {
          type: 'custom',
          value,
          config: action.config,
        });
        break;
    }
  }

  private notifyTargets(interactionId: string, targets: string | string[], event: InteractionEvent): void {
    const handlers = this.handlers.get(interactionId);

    if (handlers) {
      for (const handler of handlers) {
        try { handler(event); } catch (e) { console.error('Interaction handler error:', e); }
      }
    }
  }

  onInteraction(interactionId: string, handler: (event: InteractionEvent) => void): () => void {
    if (!this.handlers.has(interactionId)) {
      this.handlers.set(interactionId, new Set());
    }
    this.handlers.get(interactionId)!.add(handler);
    return () => { this.handlers.get(interactionId)?.delete(handler); };
  }

  onWidgetInteraction(widgetId: string, handler: (event: InteractionEvent) => void): () => void {
    const unsubscribes: (() => void)[] = [];

    for (const interaction of this.list()) {
      const targets = Array.isArray(interaction.action.target)
        ? interaction.action.target
        : [interaction.action.target];

      if (targets.includes(widgetId) || targets.includes('*')) {
        unsubscribes.push(this.onInteraction(interaction.id, handler));
      }
    }

    return () => { unsubscribes.forEach(fn => fn()); };
  }
}
