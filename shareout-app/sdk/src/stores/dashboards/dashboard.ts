import type { SdkClient } from '../../core/sdk-client';
import type { RealtimeDoc } from '../realtime-doc';
import { DataSourcesManager } from './managers/data-sources-manager';
import { DashboardMetaManager } from './managers/meta-manager';
import { FiltersManager } from './managers/filters-manager';
import { InteractionsManager } from './managers/interactions-manager';
import { LayoutManager } from './managers/layout-manager';
import { PresetsManager } from './managers/presets-manager';
import { PresenceManager } from './managers/presence-manager';
import { DashboardPresenterManager } from './managers/presenter-manager';
import { PublishManager } from './managers/publish-manager';
import { VersionsManager } from './managers/versions-manager';
import { WidgetsManager } from './managers/widgets-manager';

/**
 * A live dashboard session backed by a Yjs realtime doc.
 * Returned by {@link DashboardsStore.open} (edit) or {@link DashboardsStore.view} (read-only).
 *
 * Sub-managers are exposed as getters — each owns a slice of the shared doc:
 * meta, widgets, layout, dataSources, filters, presets, interactions,
 * presenter, versions, publish, presence.
 */
export class Dashboard {
  private doc: RealtimeDoc;
  private connected = false;
  private _meta: DashboardMetaManager;
  private _widgets: WidgetsManager;
  private _layout: LayoutManager;
  private _dataSources: DataSourcesManager;
  private _filters: FiltersManager;
  private _presets: PresetsManager;
  private _interactions: InteractionsManager;
  private _presenter: DashboardPresenterManager;
  private _versions: VersionsManager;
  private _publish: PublishManager;
  private _presence: PresenceManager;

  constructor(
    private sdk: SdkClient,
    private id: string,
    private accessMode: 'edit' | 'view',
  ) {
    this.doc = sdk.realtime(`dashboard-${id}`);
    this._meta = new DashboardMetaManager(this.doc);
    this._widgets = new WidgetsManager(this.doc);
    this._layout = new LayoutManager(this.doc);
    this._dataSources = new DataSourcesManager(this.doc, sdk, id);
    this._filters = new FiltersManager(this.doc);
    this._presets = new PresetsManager(this.doc);
    this._interactions = new InteractionsManager(this.doc);
    this._interactions.setFiltersManager(this._filters);
    this._presenter = new DashboardPresenterManager(this.doc);
    this._versions = new VersionsManager(sdk, id);
    this._publish = new PublishManager(sdk, id);
    this._presence = new PresenceManager(this.doc);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.doc.connect();
    this.connected = true;

    const defaultPreset = this._presets.getDefault();
    if (defaultPreset) {
      this._presets.apply(defaultPreset.id);
    }
  }

  disconnect(): void {
    this._dataSources.destroy();
    this.doc.disconnect();
    this.connected = false;
  }

  destroy(): void {
    this.disconnect();
  }

  get meta() { return this._meta; }
  get widgets() { return this._widgets; }
  get layout() { return this._layout; }
  get dataSources() { return this._dataSources; }
  get filters() { return this._filters; }
  get presets() { return this._presets; }
  get interactions() { return this._interactions; }
  get presenter() { return this._presenter; }
  get versions() { return this._versions; }
  get publish() { return this._publish; }
  get presence() { return this._presence; }

  get undo() {
    const widgets = this.doc.map('widgets');
    const layout = this.doc.array('layout');
    return this.doc.undoManager([widgets, layout]);
  }

  transact(fn: () => void): void {
    this.doc.transact(fn);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.doc.on(event as 'sync' | 'status', handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.doc.off(event as 'sync' | 'status', handler);
  }
}
