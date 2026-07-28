import type { RealtimeDoc } from '../../realtime-doc';
import type { DashboardMeta } from '../types';

/** Reads and writes dashboard-level metadata in the realtime doc `meta` map. */
export class DashboardMetaManager {
  constructor(private doc: RealtimeDoc) {}

  get(): DashboardMeta {
    const meta = this.doc.map<DashboardMeta>('meta');
    return meta.toJSON() as unknown as DashboardMeta;
  }

  set(changes: Partial<DashboardMeta>): void {
    const meta = this.doc.map<DashboardMeta>('meta');
    for (const [key, value] of Object.entries(changes)) {
      meta.set(key as keyof DashboardMeta, value);
    }
  }

  observe(handler: (meta: DashboardMeta) => void): () => void {
    const meta = this.doc.map<DashboardMeta>('meta');
    const callback = () => handler(meta.toJSON() as unknown as DashboardMeta);
    meta.observe(callback);
    return () => meta.unobserve(callback);
  }
}
